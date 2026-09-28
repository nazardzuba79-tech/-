import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { DepositCatalogue } from '../../services/depositCatalogue/service';
import { CatalogueError } from '../../services/depositCatalogue/store';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

export function depositCatalogueRouter(prisma: PrismaClient, catalogue: DepositCatalogue): Router {
  const router = Router();
  const failure = (res: import('express').Response, error: unknown) =>
    res.status(error instanceof CatalogueError ? error.status : 503).json({ error: error instanceof CatalogueError ? error.message : 'Address catalogue unavailable' });
  router.get('/deposit-catalogue', async (req, res) => {
    try {
      const result = await catalogue.publicCatalogue();
      res.set('Cache-Control', 'no-cache').set('ETag', `"${result.version}"`);
      if (req.headers['if-none-match'] === `"${result.version}"`) return res.status(304).end();
      res.json(result);
    } catch (error) { failure(res, error); }
  });
  router.get('/admin/deposit-catalogue', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await catalogue.adminCatalogue(req.query.refresh === 'true')); } catch (error) { failure(res, error); }
  });
  router.put('/admin/deposit-catalogue', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const revision = req.headers['if-match'];
    if (typeof revision !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(revision)) return res.status(428).json({ error: 'Catalogue revision required' });
    try { const saved = await catalogue.save(req.body, revision); res.json({ revision: saved.revision }); }
    catch (error) { failure(res, error); }
  });
  return router;
}
