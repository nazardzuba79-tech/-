import { Router } from 'express';
import { SpotPeriodReferenceService, parseSpotReferencePairs } from './SpotPeriodReferenceService';

/** Backend HTTP wiring is separate from the dependency-free history reader
 * used by the frontend-only review preview build. */
export function spotPeriodReferenceRouter(service: SpotPeriodReferenceService): Router {
  const router = Router();
  router.get('/market/external/period-references', async (req, res) => {
    const pairs = parseSpotReferencePairs(req.query);
    if (!pairs) {
      res.status(400).json({ error: 'Invalid market history pairs' }); return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.references(pairs));
  });
  return router;
}
