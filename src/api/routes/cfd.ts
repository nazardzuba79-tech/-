import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { CfdMarketDataService } from '../../services/CfdMarketDataService';
import { PublicReferenceFeed } from '../../services/marketData/cfd/PublicReferenceFeed';
import { publicReferenceDisplay, waitForReferenceWork } from '../../services/marketData/cfd/PublicReferenceDisplay';
import { CfdDisplayQuoteRouter } from '../../services/marketData/cfd/CfdDisplayQuoteRouter';
import { CFD_REFERENCE_CATALOG } from '../../services/marketData/cfd/catalog';
import { assertCfdFreshQuote, CfdQuoteUnavailable, type CfdQuote, type CfdQuoteSource } from '../../services/marketData/cfd/CfdQuote';
import { CfdPositionService } from '../../cfd/CfdPositionService';
import { computeUnrealizedPnl, computeROE, PositionSide } from '../../futures/marginMath';
import { MIN_LEVERAGE, MAX_LEVERAGE, HIGH_LEVERAGE_WARNING_THRESHOLD, LEVERAGE_TIERS } from '../../config/futuresConfig';
import { NEW_ACCOUNT_MAX_LEVERAGE, NEW_ACCOUNT_PERIOD_DAYS } from '../../config/cfdConfig';
import { requireAuthOrApiKey, requireTradePermission, ApiAuthedRequest } from '../middleware/apiKeyAuth';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const CFD_SYMBOLS = CFD_REFERENCE_CATALOG.map((i) => i.symbol) as [string, ...string[]];
const publicReferences = new PublicReferenceFeed({ enabled: process.env.CFD_PUBLIC_REFERENCES_ENABLED === 'true' });

const openSchema = z.object({
  symbol: z.enum(CFD_SYMBOLS),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'quantity must be > 0'),
  leverage: z.number().int().min(MIN_LEVERAGE).max(MAX_LEVERAGE),
});

function blankQuote(symbol: string): CfdQuote {
  const row = CFD_REFERENCE_CATALOG.find(i => i.symbol === symbol)!;
  return { provider:'multi-provider', symbol, providerSymbol:row.providerSymbol, bid:null, ask:null, mid:null, last:null,
    providerTimestamp:null, fetchedAt:null, stale:false, status:'unavailable', referenceStatus:'unavailable',
    entitlementVerified:false, executionAllowed:false };
}

async function boundedQuoteBatch(source: Pick<CfdQuoteSource,'getQuotes'>, maxWaitMs = 1300): Promise<CfdQuote[]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      source.getQuotes().catch(() => []),
      new Promise<CfdQuote[]>(resolve => { timer = setTimeout(() => resolve([]), maxWaitMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

function sourceCatalog(cfdDataService: CfdMarketDataService, riskSource: CfdQuoteSource): any[] {
  const source = riskSource as CfdQuoteSource & { catalog?: () => any[] };
  try { return typeof source.catalog === 'function' ? source.catalog() : cfdDataService.catalog(); }
  catch { return cfdDataService.catalog(); }
}

/** Public display resilience plus the authenticated dealer model.
 * displaySource can only feed GET /cfd/tickers; it is structurally separate
 * from riskSource, which remains the sole input to open/close/PnL/liquidation. */
export function cfdRouter(prisma: PrismaClient, cfdDataService: CfdMarketDataService, positionService: CfdPositionService,
  references: PublicReferenceFeed = publicReferences, riskSource: CfdQuoteSource = cfdDataService,
  shadowDiagnostics?: () => unknown | Promise<unknown>, displaySource?: CfdDisplayQuoteRouter): Router {
  const router = Router();

  router.get('/admin/cfd/diagnostics', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const routed = riskSource as CfdQuoteSource & { diagnostics?: () => unknown | Promise<unknown> };
      let shadow: unknown = null;
      if (shadowDiagnostics) {
        try { shadow = await shadowDiagnostics(); }
        catch { shadow = { unavailable:true }; }
      }
      res.json({
        ...await cfdDataService.diagnostics(),
        executionRouting: riskSource === cfdDataService ? { mode:'single-provider', provider:'twelvedata' }
          : typeof routed.diagnostics === 'function' ? await routed.diagnostics() : { mode:'multi-provider', diagnostics:'unavailable' },
        shadowProviders: shadow,
        publicDisplayRouting: displaySource ? await displaySource.diagnostics() : { mode:'disabled' },
        publicReferences: { enabled: references.isEnabled(), refreshing: references.isRefreshing(), sources: references.diagnostics() },
      });
    } catch { res.status(503).json({error:'cfd_diagnostics_unavailable'}); }
  });

  router.get('/cfd/config', (_req, res) => {
    res.json({
      symbols: CFD_SYMBOLS,
      catalog: sourceCatalog(cfdDataService, riskSource),
      maxQuoteAgeMs: riskSource.maxQuoteAgeMs,
      minLeverage: MIN_LEVERAGE,
      maxLeverage: MAX_LEVERAGE,
      newAccountMaxLeverage: NEW_ACCOUNT_MAX_LEVERAGE,
      newAccountPeriodDays: NEW_ACCOUNT_PERIOD_DAYS,
      highLeverageWarningThreshold: HIGH_LEVERAGE_WARNING_THRESHOLD,
      leverageTiers: LEVERAGE_TIERS,
    });
  });

  router.get('/cfd/catalog', (_req, res) => res.json({ instruments: sourceCatalog(cfdDataService, riskSource) }));

  router.get('/cfd/tickers', async (_req, res) => {
    try {
      const referenceWork = references.refreshDue();
      const [liveQuotes, publicDisplayQuotes] = await Promise.all([
        boundedQuoteBatch(riskSource),
        displaySource ? boundedQuoteBatch(displaySource) : Promise.resolve([]),
        references.isEnabled() ? waitForReferenceWork(referenceWork, 1300) : Promise.resolve(),
      ]);
      const fallback = new Map(references.snapshot().map(q => [q.symbol, q]));
      const catalog = sourceCatalog(cfdDataService, riskSource);
      const liveBySymbol = new Map(liveQuotes.map(q => [q.symbol, q]));
      const displayBySymbol = new Map(publicDisplayQuotes.map(q => [q.symbol, q]));
      const usePublicSerializer = references.isEnabled() || Boolean(displaySource);
      const tickers = CFD_REFERENCE_CATALOG.map(base => {
        const financial = liveBySymbol.get(base.symbol) ?? blankQuote(base.symbol);
        const q = displaySource ? displaySource.choose(financial, displayBySymbol.get(base.symbol)) : financial;
        const name = catalog.find(i => i.symbol === base.symbol)?.name ?? base.name;
        return usePublicSerializer ? publicReferenceDisplay(q, name, fallback.get(base.symbol), riskSource.maxQuoteAgeMs)
          : { ...q, name, price: q.last === null ? null : q.lastDecimal ?? String(q.last), maxQuoteAgeMs: riskSource.maxQuoteAgeMs };
      });
      res.setHeader('Cache-Control', 'no-store');
      const financialMode = riskSource === cfdDataService ? 'twelvedata' : 'multi-provider';
      res.json({
        source: `${financialMode}${displaySource ? '+public-display' : ''}${references.isEnabled() ? '+public-reference' : ''}`,
        configured: riskSource.isConfigured() || cfdDataService.isConfigured() || Boolean(displaySource) || references.isEnabled(),
        tickers,
      });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/cfd/positions', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
    const parsed = openSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }
    try {
      const position = await positionService.open({
        userId: req.userId!,
        symbol: parsed.data.symbol,
        side: parsed.data.side,
        quantity: new BigNumber(parsed.data.quantity),
        leverage: parsed.data.leverage,
      });
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
      const quotes = await boundedQuoteBatch(riskSource);
      tickers = quotes.flatMap(q => {
        try { return [{symbol:q.symbol,price:String(assertCfdFreshQuote(q,q.symbol,riskSource.maxQuoteAgeMs))}]; }
        catch { return []; }
      });
    } catch {
      // Public display quotes are intentionally NOT used for financial marks.
    }
    const priceBySymbol = new Map(tickers.map((t) => [t.symbol, new BigNumber(t.price)]));

    res.json(
      positions.map((p) => {
        const markPrice = priceBySymbol.get(p.symbol) ?? null;
        const size = new BigNumber(p.size.toString());
        const entryPrice = new BigNumber(p.entryPrice.toString());
        const initialMargin = new BigNumber(p.initialMargin.toString());
        const unrealizedPnl = markPrice ? computeUnrealizedPnl(p.side as PositionSide, size, entryPrice, markPrice) : null;
        const roe = unrealizedPnl ? computeROE(unrealizedPnl, initialMargin) : null;
        return {
          ...serializePosition(p),
          markPrice: markPrice?.toString() ?? null,
          unrealizedPnl: unrealizedPnl?.toString() ?? null,
          roe: roe ? roe.times(100).toString() : null,
        };
      })
    );
  });

  router.get('/cfd/positions/history', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    const positions = await positionService.listHistory(req.userId!);
    res.json(positions.map(serializePosition));
  });

  router.post('/cfd/positions/:positionId/close', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
    try {
      const position = await positionService.close({ userId: req.userId!, positionId: req.params.positionId });
      res.json({ position: serializePosition(position) });
    } catch (err: any) {
      if (err instanceof CfdQuoteUnavailable) return res.status(503).json({ error: err.message, code: err.code });
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

function serializePosition(p: any) {
  return {
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    size: p.size.toString(),
    entryPrice: p.entryPrice.toString(),
    leverage: p.leverage,
    initialMargin: p.initialMargin.toString(),
    liquidationPrice: p.liquidationPrice.toString(),
    status: p.status,
    realizedPnl: p.realizedPnl.toString(),
    openedAt: p.openedAt,
    closedAt: p.closedAt,
  };
}
