/** OFFLINE ONLY. Never register these simulations in managedSnapshot or an order-price provider. */
import { createHash } from 'crypto';
import { open, readFile, unlink } from 'fs/promises';
import { parseListingConfig, listingSimulationConfig, scenarioControlsSchema, type ListingConfig } from './listingConfig';
import { z } from 'zod';
import { validateScenarioControls, type ScenarioControlsProgram } from '../../shared/listingScenarioControls';
import { TestMarketSimulation, aggregateCandles, SIM_INTERVALS, type SimCandle } from '../testMarkets/testMarketSimulation';

export interface ScenarioRevision {
  scope: 'ISOLATED_MODEL_ONLY'; revision: number; effectiveAt: number; createdAt: number;
  author: string; reason: string; previousHash: string; program: ScenarioControlsProgram; hash: string;
}
export interface ScenarioPrincipal { id: string; role: 'ADMIN' | 'USER'; }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hashRevision = ({ hash: _hash, ...entry }: ScenarioRevision) => digest(entry);
// Local DTO extends only stage granularity. Public schema/history guards stay intact.
const offlineProgramSchema = scenarioControlsSchema.extend({ stages: z.array(scenarioControlsSchema.shape.stages.element.extend({
  durationHours: z.number().positive().max(720).refine(h => Number.isSafeInteger(h * 360)),
})).min(1).max(24), afterGrowth: z.literal('range'), historical: z.never().optional(), growth: z.never().optional(), historicalGrowth: z.never().optional() });
function validateProgram(program: ScenarioControlsProgram, initialPrice: string) {
  offlineProgramSchema.parse(program);
  validateScenarioControls(program, initialPrice);
}
/** Presentation aggregation only. The frozen public helper assumes 5m input.
 * This adapter folds the existing canonical 1m OHLCV; it generates no prices.
 */
export function aggregateIsolatedMinutes(minutes: readonly SimCandle[], intervalMs: number): SimCandle[] {
  if (intervalMs !== 300000) return aggregateCandles(minutes, intervalMs);
  const out: SimCandle[] = [];
  for (const candle of minutes) {
    const bucket = Math.floor(candle.openTime / intervalMs) * intervalMs, last = out[out.length - 1];
    if (!last || last.openTime !== bucket) out.push({ ...candle, openTime: bucket });
    else {
      last.high = Math.max(last.high, candle.high); last.low = Math.min(last.low, candle.low); last.close = candle.close;
      last.volume = Number((last.volume + candle.volume).toFixed(4));
      last.quoteVolume = Number((last.quoteVolume + candle.quoteVolume).toFixed(2));
    }
  }
  return out;
}

/** Caller supplies a server-authenticated principal, never request-body identity.
 * Filesystem permissions are the boundary of this local tool; no public API is installed.
 * wx lock + compare-and-swap + fsync serialize concurrent local operators.
 */
export class IsolatedScenarioJournal {
  private readonly source: ListingConfig;
  constructor(private readonly path: string, source: ListingConfig, private readonly clock = Date.now) {
    if (source.tradable) throw Error('ISOLATED_NON_TRADABLE_ONLY');
    this.source = parseListingConfig(clone(source));
    if (this.source.tradable || this.source.simulationProgram?.kind !== 'scenario-controls-v2') throw Error('ISOLATED_NON_TRADABLE_ONLY');
  }
  private simulation(program = this.source.simulationProgram!) {
    return new TestMarketSimulation(listingSimulationConfig({ ...this.source, simulationProgram: program }));
  }
  private async rows(): Promise<ScenarioRevision[]> {
    let text: string;
    try { text = await readFile(this.path, 'utf8'); } catch (e: any) { if (e.code === 'ENOENT') return []; throw e; }
    if (text && !text.endsWith('\n')) throw Error('INCOMPLETE_JOURNAL');
    const rows: ScenarioRevision[] = text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : [];
    let previousHash = digest(this.source), effectiveAt = Date.parse(this.source.listingAt);
    for (const [i, row] of rows.entries()) {
      if (row.scope !== 'ISOLATED_MODEL_ONLY' || row.revision !== i + 1 || row.previousHash !== previousHash
          || row.hash !== hashRevision(row) || row.effectiveAt <= effectiveAt
          || !Number.isSafeInteger(row.effectiveAt) || !Number.isSafeInteger(row.createdAt)
          || row.effectiveAt % 300000 !== 0 || row.createdAt >= row.effectiveAt
          || !row.author?.trim() || !row.reason?.trim()) throw Error('INVALID_JOURNAL');
      validateProgram(row.program, this.source.initialPrice);
      const prior = this.simulation(i ? rows[i - 1].program : this.source.simulationProgram!);
      if (this.simulation(row.program).priceAt(row.effectiveAt) !== prior.priceAt(row.effectiveAt)) throw Error('ANCHOR_MISMATCH');
      if (row.program.maxPrice !== (this.source.simulationProgram as ScenarioControlsProgram).maxPrice) throw Error('CAP_LOCKED');
      previousHash = row.hash; effectiveAt = row.effectiveAt;
    }
    return rows;
  }
  async history() { return clone(await this.rows()); }
  async append(principal: ScenarioPrincipal, expectedRevision: number, effectiveAt: number, program: ScenarioControlsProgram, reason: string) {
    if (principal.role !== 'ADMIN' || !principal.id.trim()) throw Error('ADMIN_REQUIRED');
    const lock = await open(this.path + '.lock', 'wx');
    try {
      const rows = await this.rows(), now = this.clock();
      if (rows.length !== expectedRevision) throw Error('REVISION_CONFLICT');
      if (rows.length >= 64) throw Error('JOURNAL_LIMIT');
      if (!Number.isSafeInteger(effectiveAt) || effectiveAt % 300000 || effectiveAt < now + 60000
          || effectiveAt <= (rows[rows.length - 1]?.effectiveAt ?? Date.parse(this.source.listingAt))) throw Error('FUTURE_BOUNDARY_REQUIRED');
      const copy = clone(program);
      validateProgram(copy, this.source.initialPrice);
      if (copy.maxPrice !== (this.source.simulationProgram as ScenarioControlsProgram).maxPrice) throw Error('CAP_LOCKED');
      const prior = this.simulation(rows[rows.length - 1]?.program ?? this.source.simulationProgram!);
      if (this.simulation(copy).priceAt(effectiveAt) !== prior.priceAt(effectiveAt)) throw Error('ANCHOR_MISMATCH');
      if (!reason.trim() || reason.length > 1000) throw Error('REASON_REQUIRED');
      const row: ScenarioRevision = { scope: 'ISOLATED_MODEL_ONLY', revision: rows.length + 1, effectiveAt,
        createdAt: now, author: principal.id, reason: reason.trim(), previousHash: rows[rows.length - 1]?.hash ?? digest(this.source), program: copy, hash: '' };
      row.hash = hashRevision(row);
      const file = await open(this.path, 'a', 0o600);
      try { await file.writeFile(JSON.stringify(row) + '\n'); await file.sync(); } finally { await file.close(); }
      return clone(row);
    } finally { await lock.close(); await unlink(this.path + '.lock'); }
  }
  async preview(now: number, from: number, interval: keyof typeof SIM_INTERVALS = '5m', proposal?: { effectiveAt: number; program: ScenarioControlsProgram }) {
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(from) || from > now || now - from > 32 * 86400000) throw Error('INVALID_PREVIEW_WINDOW');
    if (!['1m','5m','15m','1h'].includes(interval)) throw Error('INVALID_INTERVAL');
    const rows: Array<{ effectiveAt: number; program: ScenarioControlsProgram }> = await this.rows();
    if (proposal) {
      validateProgram(proposal.program, this.source.initialPrice);
      const previous = rows[rows.length - 1];
      if (proposal.effectiveAt % 300000 || proposal.effectiveAt < this.clock() + 60000
          || proposal.effectiveAt <= (previous?.effectiveAt ?? Date.parse(this.source.listingAt))) throw Error('FUTURE_BOUNDARY_REQUIRED');
      if (proposal.program.maxPrice !== (this.source.simulationProgram as ScenarioControlsProgram).maxPrice) throw Error('CAP_LOCKED');
      if (this.simulation(proposal.program).priceAt(proposal.effectiveAt) !== this.simulation(previous?.program).priceAt(proposal.effectiveAt)) throw Error('ANCHOR_MISMATCH');
      rows.push(clone(proposal));
    }
    const sources = [this.simulation(), ...rows.map(row => this.simulation(row.program))];
    const candles: SimCandle[] = [];
    const start = Math.max(Date.parse(this.source.listingAt), Math.floor(from / 3600000) * 3600000);
    for (let i = 0; i < sources.length; i++) {
      const first = Math.max(start, i ? rows[i - 1].effectiveAt : start);
      const next = i < rows.length ? rows[i].effectiveAt : Infinity;
      const end = Math.min(now, next);
      if (first <= end) candles.push(...sources[i].candles1m(end, first).filter(c => c.openTime < next));
    }
    const boundary = rows[0]?.effectiveAt ?? Infinity;
    const original = interval === '1m' ? sources[0].candles1m(Math.min(now, boundary), start)
      : aggregateCandles(sources[0].candles5m(Math.min(now, boundary), start), SIM_INTERVALS[interval]);
    const immutable = new Map(original.filter(c => c.openTime + SIM_INTERVALS[interval] <= boundary).map(c => [c.openTime,c]));
    return { source: 'ISOLATED_MODEL_ONLY' as const, executable: false as const, interval,
      candles: aggregateIsolatedMinutes(candles, SIM_INTERVALS[interval]).map(c => immutable.get(c.openTime) ?? c)
        .filter(c => c.openTime >= Math.floor(from / SIM_INTERVALS[interval]) * SIM_INTERVALS[interval]) };
  }
}

