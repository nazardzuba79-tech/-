import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { listingInput, ListingError, type ManagedListing } from '../../services/managedListings/schema';
import { listingsStore, type ListingsStore } from '../../services/managedListings/store';
import { allocateManagedListing } from '../../services/managedListings/allocation';

export function adminListingsRouter(db: PrismaClient, existingSymbols: () => Promise<{pair:string}[]>, store: () => ListingsStore = listingsStore) {
  const router = Router();
  router.use('/admin/listings',requireAuth(db),requireAdmin(db));
  const collision = async (ticker: string) => {
    const symbols = await existingSymbols();
    if (!symbols.length) throw new ListingError('market_registry_unavailable',503);
    if (symbols.some(s => s.pair.split('/')[0] === ticker || s.pair === `${ticker}/USDT`)) throw new ListingError('duplicate_ticker_or_pair',409);
  };
  const wrap = (fn: (req:AuthedRequest) => Promise<unknown>) => async (req:AuthedRequest,res:any) => {
    res.set('Cache-Control','no-store');
    try { res.json(await fn(req)); }
    catch(e) { res.status(e instanceof ListingError ? e.status : 503).json({error:e instanceof ListingError ? e.code : 'listings_unavailable'}); }
  };
  router.get('/admin/listings',wrap(() => store().call('/admin/listings')));
  router.post('/admin/listings',wrap(async req => {
    const parsed = listingInput.safeParse(req.body);
    if (!parsed.success) throw new ListingError('invalid_listing');
    await collision(parsed.data.ticker);
    return store().call('/admin/listings','POST',parsed.data,undefined,req.get('Idempotency-Key'),req.userId);
  }));
  router.param('id',(req,res,next,id) => /^[a-zA-Z0-9_-]{16,80}$/.test(id) ? next() : res.status(400).json({error:'invalid_id'}));
  router.get('/admin/listings/:id',wrap(req => store().call(`/admin/listings/${req.params.id}`)));
  router.get('/admin/listings/:id/preview',wrap(req => store().call(`/admin/listings/${req.params.id}/preview`)));
  router.put('/admin/listings/:id',wrap(async req => {
    const parsed = listingInput.safeParse(req.body); if (!parsed.success) throw new ListingError('invalid_listing');
    await collision(parsed.data.ticker);
    return store().call(`/admin/listings/${req.params.id}`,'PUT',parsed.data,req.get('If-Match'));
  }));
  router.post('/admin/listings/:id/publish',wrap(async req => {
    const target = await store().call<ManagedListing>(`/admin/listings/${req.params.id}`);
    await collision(target.ticker);
    return store().call(`/admin/listings/${req.params.id}/publish`,'POST',undefined,req.get('If-Match'),req.get('Idempotency-Key'));
  }));
  router.post('/admin/listings/:id/allocation',wrap(async req => {
    // Separate operational switch, default OFF even after enabling the factory.
    if (process.env.MANAGED_LISTINGS_ALLOCATION_ENABLED !== '1') throw new ListingError('allocation_not_enabled',403);
    const target = await store().call<ManagedListing>(`/admin/listings/${req.params.id}`);
    if (req.body?.confirm !== true || String(target.revision) !== req.get('If-Match')) throw new ListingError('allocation_confirmation_required',409);
    return allocateManagedListing(db,target,req.userId!,req.get('Idempotency-Key') || '');
  }));
  return router;
}
