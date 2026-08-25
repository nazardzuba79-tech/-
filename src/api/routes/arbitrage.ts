import { Router } from 'express';
import { ArbitrageService, ExternalArbitrageError } from '../../services/ArbitrageService';

/**
 * Read-only cross-exchange spread monitor — see ArbitrageService's doc
 * comment for what this is (and, importantly, isn't: nothing here places
 * or moves real orders/funds on any exchange).
 */
export function arbitrageRouter(arbitrageService: ArbitrageService): Router {
  const router = Router();

  router.get('/arbitrage/opportunities', async (_req, res) => {
    try {
      const opportunities = await arbitrageService.getOpportunities();
      res.json({ opportunities });
    } catch (err) {
      if (err instanceof ExternalArbitrageError) {
        return res.status(502).json({ error: err.message });
      }
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
