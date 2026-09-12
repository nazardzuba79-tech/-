import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { optionQuerySchema, OptionsRequestError } from '../../services/marketData/bybit/BybitOptions';
import type { MarketDataCollectorClient } from '../../services/marketData/live/MarketDataCollectorClient';

export function marketOptionsRouter(collector: Pick<MarketDataCollectorClient,'optionsSnapshot'> | null) {
  const router = Router();
  router.use('/market/options', rateLimit({ windowMs:60_000, max:120, standardHeaders:true, legacyHeaders:false }));
  for (const kind of ['instruments','tickers'] as const) router.get(`/market/options/${kind}`, async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    const query = optionQuerySchema.safeParse(req.query);
    if (!query.success || (kind === 'tickers' && !query.data.baseCoin)) { res.status(400).json({error:'invalid_options_query'}); return; }
    if (!collector) { res.status(503).json({error:'options_unavailable'}); return; }
    try { res.json(await collector.optionsSnapshot(kind,query.data)); }
    catch (error) { res.status(error instanceof OptionsRequestError ? error.status : 503).json({error:error instanceof OptionsRequestError ? error.code : 'options_unavailable'}); }
  });
  return router;
}
