import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { CfdMarketDataService, ExternalCfdDataError, CFD_INSTRUMENTS } from '../../services/CfdMarketDataService';
import { CfdPositionService } from '../../cfd/CfdPositionService';
import { computeUnrealizedPnl, computeROE, PositionSide } from '../../futures/marginMath';
import { MIN_LEVERAGE, MAX_LEVERAGE, NEW_ACCOUNT_MAX_LEVERAGE, NEW_ACCOUNT_PERIOD_DAYS, HIGH_LEVERAGE_WARNING_THRESHOLD, LEVERAGE_TIERS } from '../../config/futuresConfig';
import { requireAuthOrApiKey, requireTradePermission, ApiAuthedRequest } from '../middleware/apiKeyAuth';

const CFD_SYMBOLS = CFD_INSTRUMENTS.map((i) => i.symbol) as [string, ...string[]];

const openSchema = z.object({
  symbol: z.enum(CFD_SYMBOLS),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'quantity must be > 0'),
  leverage: z.number().int().min(MIN_LEVERAGE).max(MAX_LEVERAGE),
});

/**
 * Read-only CFD reference prices — see CfdMarketDataService's doc comment.
 * `configured: false` (empty tickers, still a 200) means no
 * TWELVE_DATA_API_KEY is set yet, distinct from a genuine upstream failure
 * (502) — the frontend uses that to show an honest "not set up yet" state
 * instead of an error banner. Position endpoints mirror futures.ts's
 * conventions (same auth middleware, same error shape) — see
 * CfdPositionService's doc comment for the dealer-model trading itself.
 */
export function cfdRouter(prisma: PrismaClient, cfdDataService: CfdMarketDataService, positionService: CfdPositionService): Router {
  const router = Router();

  router.get('/cfd/config', (_req, res) => {
    res.json({
      symbols: CFD_SYMBOLS,
      minLeverage: MIN_LEVERAGE,
      maxLeverage: MAX_LEVERAGE,
      newAccountMaxLeverage: NEW_ACCOUNT_MAX_LEVERAGE,
      newAccountPeriodDays: NEW_ACCOUNT_PERIOD_DAYS,
      highLeverageWarningThreshold: HIGH_LEVERAGE_WARNING_THRESHOLD,
      leverageTiers: LEVERAGE_TIERS,
    });
  });

  router.get('/cfd/tickers', async (_req, res) => {
    try {
      const configured = cfdDataService.isConfigured();
      const tickers = configured ? await cfdDataService.getTickers() : [];
      res.json({ source: 'twelvedata', configured, tickers });
    } catch (err) {
      if (err instanceof ExternalCfdDataError) {
        return res.status(502).json({ error: err.message });
      }
      console.error(err);
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
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/cfd/positions', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    const positions = await positionService.listOpen(req.userId!);
    let tickers: { symbol: string; price: string }[] = [];
    try {
      tickers = await cfdDataService.getTickers();
    } catch {
      // Honest fallback below (null markPrice/unrealizedPnl) beats a 500
      // for what's otherwise a perfectly good position list.
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
