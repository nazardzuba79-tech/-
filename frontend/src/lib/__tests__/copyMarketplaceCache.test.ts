import { CopyMarketplaceStore } from '../copyMarketplaceStore';
import { cacheKey, readSnapshot, writeSnapshot } from '../copyMarketplaceCache';
import { summarizeStrategy } from '../../../../src/services/copyTrading/marketplaceSummary';
import { withKseniaReportedTrade } from '../../../../src/services/copyTrading/kseniaReportedTrade';
import { advanceKseniaReview, createKseniaReviewState, kseniaReviewResponse }
  from '../../../../src/services/copyTrading/canonical/kseniaReview';

/** A storage double: everything the cache uses, nothing it does not. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

/** A REAL Ksenia section, straight off the production path. */
function kseniaSection() {
  return withKseniaReportedTrade(
    summarizeStrategy(kseniaReviewResponse(advanceKseniaReview(createKseniaReviewState(), 11))) as any,
  );
}
const payload = (ksenia: unknown) => ({
  generatedAt: new Date('2026-09-17T12:00:00Z').toISOString(),
  nazar: null, ksenia, identities: null, errors: { nazar: 'x', identities: 'x' },
});
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Copy Trading paints the last confirmed data instead of a skeleton', () => {
  it('restores a validated snapshot on the next visit, before any response arrives', async () => {
    const storage = memoryStorage();
    const ksenia = kseniaSection();
    const now = () => Date.parse('2026-09-17T12:00:00Z');

    const first = new CopyMarketplaceStore(async () => payload(ksenia), () => 'token-a', now, storage);
    await first.refresh();
    expect(first.getState().ksenia).not.toBeNull();
    expect(storage.map.size).toBe(1);

    // A hard reload: brand new store, same session, no response yet.
    const reloaded = new CopyMarketplaceStore(
      () => new Promise(() => {}), () => 'token-a', now, storage);
    const state = reloaded.getState();
    expect(state.ksenia).not.toBeNull();
    expect(state.ksenia!.analytics.roi7).toBe(ksenia.analytics.roi7);
    // Real figures, but this visit has not heard from the server yet and
    // says so rather than pretending the request already settled.
    expect(state.settled).toBe(false);
  });

  it('never shows one login the snapshot taken under another', async () => {
    const storage = memoryStorage();
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    const first = new CopyMarketplaceStore(async () => payload(kseniaSection()), () => 'token-a', now, storage);
    await first.refresh();
    expect(storage.map.size).toBe(1);

    const other = new CopyMarketplaceStore(() => new Promise(() => {}), () => 'token-b', now, storage);
    expect(other.getState().ksenia).toBeNull();
    expect(cacheKey('token-a')).not.toBe(cacheKey('token-b'));
  });

  it('drops a snapshot that no longer passes the live validator', async () => {
    const storage = memoryStorage();
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    const first = new CopyMarketplaceStore(async () => payload(kseniaSection()), () => 'token-a', now, storage);
    await first.refresh();

    // Exactly what an older build, or a truncated write, leaves behind.
    const stored = readSnapshot('token-a', storage)!;
    delete (stored.ksenia as any).mainMarkets;
    writeSnapshot('token-a', stored, storage);

    const reloaded = new CopyMarketplaceStore(() => new Promise(() => {}), () => 'token-a', now, storage);
    expect(reloaded.getState().ksenia).toBeNull();
  });

  it('a failing section never clears the other section it was cached beside', async () => {
    const storage = memoryStorage();
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    const ksenia = kseniaSection();
    let response: unknown = payload(ksenia);
    const store = new CopyMarketplaceStore(async () => response, () => 'token-a', now, storage);
    await store.refresh();
    expect(store.getState().ksenia).not.toBeNull();

    // Ksenia breaks upstream on the next poll.
    response = { ...payload(null), errors: { nazar: 'x', ksenia: 'down', identities: 'x' } };
    await flush();
    (store as any).lastAttempt = -Infinity;
    await store.refresh();

    const state = store.getState();
    expect(state.ksenia).not.toBeNull();
    expect(state.ksenia!.analytics.roi7).toBe(ksenia.analytics.roi7);
    expect(state.stale.ksenia).toBe(true);
  });

  it('forgets the snapshot when the session ends', async () => {
    const storage = memoryStorage();
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    let session: string | null = 'token-a';
    const store = new CopyMarketplaceStore(async () => payload(kseniaSection()), () => session, now, storage);
    await store.refresh();
    expect(storage.map.size).toBe(1);

    session = null;
    store.getState();
    expect(storage.map.size).toBe(0);
  });

  it('works where the browser refuses storage entirely', async () => {
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    const store = new CopyMarketplaceStore(async () => payload(kseniaSection()), () => 'token-a', now, null);
    await store.refresh();
    expect(store.getState().ksenia).not.toBeNull();
  });
});
