import { Router } from 'express';
import { CfdMarketDataService, ExternalCfdDataError } from '../../services/CfdMarketDataService';

/**
 * Read-only CFD reference prices — see CfdMarketDataService's doc comment.
 * `configured: false` (empty tickers, still a 200) means no
 * TWELVE_DATA_API_KEY is set yet, distinct from a genuine upstream failure
 * (502) — the frontend uses that to show an honest "coming soon" state
 * instead of an error banner.
 */
export function cfdRouter(cfdDataService: CfdMarketDataService): Router {
  const router = Router();

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

  return router;
}
