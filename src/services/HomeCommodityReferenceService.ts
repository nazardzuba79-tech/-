import { ProviderCache } from './marketData/ProviderCache';

export interface HomeCommodityReference {
  price: number;
  observedAt: number;
  source: 'gold-api' | 'eia';
  label: string;
}

export interface HomeCommodityReferences {
  gold: HomeCommodityReference | null;
  oil: HomeCommodityReference | null;
}

export class HomeCommodityReferenceError extends Error {}

const GOLD_URL = 'https://api.gold-api.com/price/XAU';
const FRED_BRENT_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU';
const GOLD_TTL_MS = 60_000;
const OIL_TTL_MS = 60 * 60_000;
const GOLD_MAX_SOURCE_AGE_MS = 15 * 60_000;
const OIL_MAX_SOURCE_AGE_MS = 10 * 24 * 60 * 60_000;
const FUTURE_SKEW_MS = 5 * 60_000;

function finitePositive(value: unknown): number | null {
  const n = typeof value === 'number' || typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function sourceFresh(observedAt: number, maxAgeMs: number, now: number): boolean {
  return observedAt <= now + FUTURE_SKEW_MS && now - observedAt <= maxAgeMs;
}

export function parseGoldApiReference(payload: unknown, now = Date.now()): HomeCommodityReference {
  if (!payload || typeof payload !== 'object') throw new HomeCommodityReferenceError('Gold reference returned invalid data');
  const raw = payload as Record<string, unknown>;
  const price = finitePositive(raw.price);
  const observedAt = parseTime(raw.updatedAt ?? raw.updated_at ?? raw.timestamp);
  if (price === null || observedAt === null || !sourceFresh(observedAt, GOLD_MAX_SOURCE_AGE_MS, now)) {
    throw new HomeCommodityReferenceError('Gold reference is unavailable or stale');
  }
  return { price, observedAt, source: 'gold-api', label: 'XAU/USD' };
}

export function parseFredBrentCsv(csv: string, now = Date.now()): HomeCommodityReference {
  if (typeof csv !== 'string' || csv.trim() === '') throw new HomeCommodityReferenceError('Oil reference returned no data');
  const lines = csv.trim().split(/\r?\n/);
  let latest: { observedAt: number; price: number } | null = null;
  for (let index = 1; index < lines.length; index += 1) {
    const [date, rawValue] = lines[index].split(',');
    const price = finitePositive(rawValue);
    if (!date || price === null) continue;
    const observedAt = Date.parse(`${date.trim()}T23:59:59Z`);
    if (!Number.isFinite(observedAt)) continue;
    if (!latest || observedAt > latest.observedAt) latest = { observedAt, price };
  }
  if (!latest || !sourceFresh(latest.observedAt, OIL_MAX_SOURCE_AGE_MS, now)) {
    throw new HomeCommodityReferenceError('Oil reference is unavailable or stale');
  }
  return { price: latest.price, observedAt: latest.observedAt, source: 'eia', label: 'Brent spot · EIA · USD/bbl' };
}

export class HomeCommodityReferenceService {
  private readonly goldCache: ProviderCache<HomeCommodityReference>;
  private readonly oilCache: ProviderCache<HomeCommodityReference>;

  constructor(private readonly fetchFn: typeof fetch = fetch, private readonly now: () => number = () => Date.now()) {
    this.goldCache = new ProviderCache<HomeCommodityReference>({
      ttlMs: GOLD_TTL_MS,
      maxStaleMs: 10 * 60_000,
      maxEntries: 2,
      now: this.now,
    });
    this.oilCache = new ProviderCache<HomeCommodityReference>({
      ttlMs: OIL_TTL_MS,
      maxStaleMs: 24 * 60 * 60_000,
      maxEntries: 2,
      now: this.now,
    });
  }

  async getReferences(): Promise<HomeCommodityReferences> {
    const [gold, oil] = await Promise.allSettled([this.getGold(), this.getOil()]);
    return {
      gold: gold.status === 'fulfilled' ? gold.value : null,
      oil: oil.status === 'fulfilled' ? oil.value : null,
    };
  }

  private async getGold(): Promise<HomeCommodityReference> {
    return (await this.goldCache.fetch('xau', async () => {
      const response = await this.fetchFn(GOLD_URL, {
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new HomeCommodityReferenceError(`Gold reference HTTP ${response.status}`);
      return parseGoldApiReference(await response.json(), this.now());
    })).value;
  }

  private async getOil(): Promise<HomeCommodityReference> {
    return (await this.oilCache.fetch('brent', async () => {
      const cutoff = new Date(this.now() - 21 * 24 * 60 * 60_000).toISOString().slice(0, 10);
      const url = `${FRED_BRENT_URL}&cosd=${cutoff}`;
      const response = await this.fetchFn(url, {
        signal: AbortSignal.timeout(8_000),
        headers: {
          Accept: 'text/csv,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; VOLTEX market-reference/1.0)',
        },
      });
      if (!response.ok) throw new HomeCommodityReferenceError(`Oil reference HTTP ${response.status}`);
      return parseFredBrentCsv(await response.text(), this.now());
    })).value;
  }
}
