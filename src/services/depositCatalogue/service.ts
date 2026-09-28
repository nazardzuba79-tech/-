import { createHash } from 'crypto';
import { CoinRanking } from '../CoinGeckoService';
import { DEPOSIT_RAILS, railKey } from './registry';
import { CatalogueError, CatalogueStore, StoredCatalogue, documentSchema, entrySchema } from './store';

export class DepositCatalogue {
  private cached?: { value: StoredCatalogue; until: number };
  private pending?: Promise<StoredCatalogue>;
  private generation = 0;
  constructor(private store: CatalogueStore, private ranking: () => Promise<CoinRanking[]>, private now = Date.now) {}
  private async load(): Promise<StoredCatalogue> {
    if (this.cached && this.cached.until > this.now()) return this.cached.value;
    if (this.pending) return this.pending;
    const generation = this.generation;
    const pending = this.store.read().then(value => {
      const valid = { revision: value.revision, document: documentSchema.parse(value.document) };
      if (generation === this.generation) this.cached = { value: valid, until: this.now() + 30_000 };
      return valid;
    });
    this.pending = pending;
    try { return await pending; } finally { if (this.pending === pending) this.pending = undefined; }
  }
  private resolved(value: StoredCatalogue) {
    const entries = new Map([...value.document.baseline, ...value.document.overrides].map(e => [railKey(e), e]));
    return DEPOSIT_RAILS.map(rail => {
      const entry = entries.get(railKey(rail));
      return { ...rail, address: entry?.address ?? '', memo: entry?.memo ?? '', memoLabel: entry?.memoLabel || (rail.memoAllowed ? rail.memoLabel : ''),
        enabled: entry?.enabled ?? false, status: !entry?.address ? 'unconfigured' : entry.enabled ? 'configured' : 'disabled' };
    });
  }
  async publicCatalogue() {
    const stored = await this.load();
    const entries = this.resolved(stored).filter(e => e.status === 'configured').map(({ status, ...entry }) => entry);
    return { version: createHash('sha256').update(JSON.stringify(entries)).digest('hex'), entries };
  }
  async adminCatalogue(refresh = false) {
    if (refresh) { this.cached = undefined; this.pending = undefined; this.generation++; }
    const stored = await this.load();
    const entries = this.resolved(stored);
    let rankings: CoinRanking[] = [], rankingAvailable = true;
    try { rankings = await this.ranking(); } catch { rankingAvailable = false; }
    const seen = new Set<string>();
    const top = rankings.filter(r => r.symbol.toUpperCase() !== 'VTA' && r.id !== 'voltora' && r.rank > 0)
      .sort((a, b) => a.rank - b.rank).filter(r => !seen.has(r.id) && !!seen.add(r.id)).slice(0, 20);
    const assets = top.map(r => ({ assetId: r.id, asset: r.symbol.toUpperCase(), name: r.name, rank: r.rank, top: true }));
    for (const entry of entries) if (entry.address && !assets.some(a => a.assetId === entry.assetId))
      assets.push({ assetId: entry.assetId, asset: entry.asset, name: entry.asset, rank: 0, top: false });
    // When rankings are unavailable, retain the explicit registry as unranked
    // choices. Never manufacture ranks or remove saved destinations.
    if (!rankingAvailable) for (const entry of entries) if (!assets.some(a => a.assetId === entry.assetId))
      assets.push({ assetId: entry.assetId, asset: entry.asset, name: entry.asset, rank: 0, top: false });
    return { revision: stored.revision, rankingAvailable, assets, entries };
  }
  async save(input: unknown, revision: string) {
    const parsed = entrySchema.safeParse(input);
    if (!parsed.success) throw new CatalogueError(400, 'Invalid asset, network, address or memo');
    // Never use a potentially stale cached snapshot as the base of a write.
    const stored = await this.store.read();
    if (stored.revision !== revision) throw new CatalogueError(409, 'Catalogue changed; refresh before saving');
    const document = documentSchema.parse(stored.document);
    const overrides = document.overrides.filter(e => railKey(e) !== railKey(parsed.data));
    overrides.push(parsed.data); // Empty/disabled is an explicit tombstone, not fallback to baseline.
    try { return await this.store.replace({ ...document, overrides }, revision); }
    finally { this.generation++; this.cached = undefined; this.pending = undefined; }
  }
}
