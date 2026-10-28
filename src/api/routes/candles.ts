import { asyncRoute } from '../asyncRoute';
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { CandleService, INTERVALS, IntervalKey } from '../../services/CandleService';
import { isSimulationSettled } from '../../services/testMarkets/testAssetConfig';

export function candlesRouter(prisma: PrismaClient): Router {
  const router = Router();
  const candleService = new CandleService(prisma);

  router.get('/candles/:pair', asyncRoute(async (req, res) => {
    const interval = (req.query.interval as string) ?? '1m';
    if (!(interval in INTERVALS)) {
      return res.status(400).json({ error: `interval must be one of: ${Object.keys(INTERVALS).join(', ')}` });
    }
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    // History20 private test fills are never public market data.
    if (isSimulationSettled(req.params.pair)) return res.status(404).json({ error: 'unknown_pair' });

    const candles = await candleService.getCandles(req.params.pair.toUpperCase(), interval as IntervalKey, limit);
    res.json({ pair: req.params.pair.toUpperCase(), interval, candles });
  }));

  return router;
}
