import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { CfdMarketDataService } from '../../services/CfdMarketDataService';
import { CFD_REFERENCE_CATALOG } from '../../services/marketData/cfd/catalog';
import { assertCfdFreshQuote, CfdQuoteUnavailable, type CfdQuote } from '../../services/marketData/cfd/CfdQuote';
import { CfdDisplayQuoteRouter } from '../../services/marketData/cfd/CfdDisplayQuoteRouter';
import { CfdPositionService } from '../../cfd/CfdPositionService';
import { computeUnrealizedPnl, computeROE, PositionSide } from '../../futures/marginMath';
import { MIN_LEVERAGE, MAX_LEVERAGE, HIGH_LEVERAGE_WARNING_THRESHOLD, LEVERAGE_TIERS } from '../../config/futuresConfig';
import { NEW_ACCOUNT_MAX_LEVERAGE, NEW_ACCOUNT_PERIOD_DAYS } from '../../config/cfdConfig';
import { requireAuthOrApiKey, requireTradePermission, ApiAuthedRequest } from '../middleware/apiKeyAuth';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const CFD_SYMBOLS = CFD_REFERENCE_CATALOG.map((i) => i.symbol) as [string, ...string[]];

const openSchema = z.object({
  symbol: z.enum(CFD_SYMBOLS),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'quantity must be > 0'),
  leverage: z.number().int().min(MIN_LEVERAGE).max(MAX_LEVERAGE),
});

function blankQuote(symbol: string): CfdQuote {
  const row = CFD_REFERENCE_CATALOG.find(i => i.symbol === symbol)!;
  return { provider:'display-router', symbol, providerSymbol:row.providerSymbol, bid:null, ask:null, mid:null, last:null,
    providerTimestamp:null, fetchedAt:null, stale:false, status:'unavailable', referenceStatus:'unavailable',
    entitlementVerified:false, executionAllowed:false };
}

async function bounded<T>(work: Promise<T>, fallback: T, maxWaitMs = 1400): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work.catch(() => fallback), new Promise<T>(resolve => { timer=setTimeout(()=>resolve(fallback),maxWaitMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

function displayStatus(q: CfdQuote): 'live'|'market_closed'|'stale'|'unavailable' {
  if (q.last === null || !Number.isFinite(q.last) || q.last <= 0) return 'unavailable';
  if (q.referenceStatus === 'market_closed' || q.status === 'market_closed') return 'market_closed';
  if (q.stale || q.referenceStatus === 'stale' || q.status === 'stale') return 'stale';
  return 'live';
}

/** Public tickers are presentation data. The display router is deliberately
 * separate from position/PnL/liquidation services, which continue to use the
 * original CFD financial source unchanged. */
export function cfdRouter(prisma: PrismaClient, cfdDataService: CfdMarketDataService, positionService: CfdPositionService,
  displaySource?: CfdDisplayQuoteRouter): Router {
  const router = Router();

  router.get('/admin/cfd/diagnostics', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json({ financial: await cfdDataService.diagnostics(), display: displaySource ? await displaySource.diagnostics() : null });
    } catch { res.status(503).json({error:'cfd_diagnostics_unavailable'}); }
  });

  router.get('/cfd/config', (_req, res) => {
    res.json({
      symbols: CFD_SYMBOLS,
      catalog: cfdDataService.catalog(),
      maxQuoteAgeMs: cfdDataService.maxQuoteAgeMs,
      minLeverage: MIN_LEVERAGE,
      maxLeverage: MAX_LEVERAGE,
      newAccountMaxLeverage: NEW_ACCOUNT_MAX_LEVERAGE,
      newAccountPeriodDays: NEW_ACCOUNT_PERIOD_DAYS,
      highLeverageWarningThreshold: HIGH_LEVERAGE_WARNING_THRESHOLD,
      leverageTiers: LEVERAGE_TIERS,
    });
  });

  router.get('/cfd/catalog', (_req, res) => res.json({ instruments: cfdDataService.catalog() }));

  router.get('/cfd/tickers', async (_req, res) => {
    try {
      const [primaryRows, displayRows] = await Promise.all([
        bounded(cfdDataService.getQuotes(), [] as CfdQuote[]),
        displaySource ? displaySource.getQuotes() : Promise.resolve([] as CfdQuote[]),
      ]);
      const primary = new Map(primaryRows.map(q => [q.symbol, q]));
      const alternatives = new Map(displayRows.map(q => [q.symbol, q]));
      const catalog = cfdDataService.catalog();
      const tickers = CFD_REFERENCE_CATALOG.map(base => {
        const financial = primary.get(base.symbol) ?? blankQuote(base.symbol);
        const q = displaySource ? displaySource.choose(financial, alternatives.get(base.symbol)) : financial;
        const status = displayStatus(q);
        const asOf = q.providerTimestamp ?? q.fetchedAt;
        return {
          symbol: q.symbol,
          name: catalog.find(i => i.symbol === q.symbol)?.name ?? base.name,
          price: q.last === null ? null : q.lastDecimal ?? String(q.last),
          changePercent24h: q.changePercent24h,
          status,
          stale: status === 'stale',
          marketClosed: status === 'market_closed',
          displayOnly: true,
          executionAllowed: false,
          entitlementVerified: false,
          provider: q.provider,
          providerSymbol: q.providerSymbol,
          providerTimestamp: q.providerTimestamp,
          fetchedAt: q.fetchedAt,
          asOf: typeof asOf === 'number' && Number.isFinite(asOf) ? asOf : null,
          maxQuoteAgeMs: displaySource?.freshAgeMs ?? cfdDataService.maxQuoteAgeMs,
        };
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ source: displaySource ? 'voltex-multi-source-display' : 'twelvedata', configured: cfdDataService.isConfigured() || Boolean(displaySource), tickers });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/cfd/positions', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
    const parsed = openSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    try {
      const position = await positionService.open({ userId: req.userId!, symbol: parsed.data.symbol, side: parsed.data.side,
        quantity: new BigNumber(parsed.data.quantity), leverage: parsed.data.leverage });
      res.json({ position: serializePosition(position) });
    } catch (err: any) {
      if (err instanceof CfdQuoteUnavailable) return res.status(503).json({ error: err.message, code: err.code });
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/cfd/positions', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    const positions = await positionService.listOpen(req.userId!);
    let tickers: { symbol: string; price: string }[] = [];
    try {
      const quotes = await cfdDataService.getQuotes();
      tickers = quotes.flatMap(q => { try { return [{symbol:q.symbol,price:String(assertCfdFreshQuote(q,q.symbol,cfdDataService.maxQuoteAgeMs))}]; } catch { return []; } });
    } catch {}
    const priceBySymbol = new Map(tickers.map((t) => [t.symbol, new BigNumber(t.price)]));
    res.json(positions.map((p) => {
      const markPrice = priceBySymbol.get(p.symbol) ?? null;
      const size = new BigNumber(p.size.toString()), entryPrice = new BigNumber(p.entryPrice.toString()), initialMargin = new BigNumber(p.initialMargin.toString());
      const unrealizedPnl = markPrice ? computeUnrealizedPnl(p.side as PositionSide, size, entryPrice, markPrice) : null;
      const roe = unrealizedPnl ? computeROE(unrealizedPnl, initialMargin) : null;
      return { ...serializePosition(p), markPrice: markPrice?.toString() ?? null, unrealizedPnl: unrealizedPnl?.toString() ?? null, roe: roe ? roe.times(100).toString() : null };
    }));
  });

  router.get('/cfd/positions/history', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    const positions = await positionService.listHistory(req.userId!); res.json(positions.map(serializePosition));
  });

  router.post('/cfd/positions/:positionId/close', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
    try { const position = await positionService.close({ userId: req.userId!, positionId: req.params.positionId }); res.json({ position: serializePosition(position) }); }
    catch (err: any) { if (err instanceof CfdQuoteUnavailable) return res.status(503).json({ error: err.message, code: err.code }); res.status(400).json({ error: err.message }); }
  });

  return router;
}

function serializePosition(p: any) {
  return { id:p.id, symbol:p.symbol, side:p.side, size:p.size.toString(), entryPrice:p.entryPrice.toString(), leverage:p.leverage,
    initialMargin:p.initialMargin.toString(), liquidationPrice:p.liquidationPrice.toString(), status:p.status,
    realizedPnl:p.realizedPnl.toString(), openedAt:p.openedAt, closedAt:p.closedAt };
}
