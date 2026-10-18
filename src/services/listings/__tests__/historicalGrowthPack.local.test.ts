/**
 * The owner's History20 pack, checked against this implementation. The pack
 * is NOT in the repository (non-commercial source licences, redistribution
 * not cleared), so this suite runs only where HISTORY20_PACK_DIR points to
 * the extracted «VOLTEX_History20_Claude_20261018» folder; elsewhere it is
 * skipped and must be reported as skipped, not as passed.
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  buildHistoricalGrowthProgram, historicalGrowthAlpha, historicalGrowthCap, historicalGrowthElapsedSeconds, historicalGrowthMaxPrice,
  type HistoricalGrowthSourceRow,
} from '../../../shared/listingHistoricalGrowth';
import { historicalSerializedBytes } from '../../../shared/listingHistoricalReplay';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { listingSimulationConfig, parseListingConfig } from '../listingConfig';
import { listingScenarioPreview } from '../listingPreview';
import { controlledScenarioHour } from '../../testMarkets/simulationScenarioControls';
import { HISTORY20_CATALOG, HISTORY20_PACK, HISTORY20_ROTATION } from '../../../../frontend/src/pages/admin/historicalGrowthCatalog';

const DIR = process.env.HISTORY20_PACK_DIR ?? '';
const run = DIR && existsSync(join(DIR, 'catalog.json')) ? describe : describe.skip;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function rows(id: string): HistoricalGrowthSourceRow[] {
  const [head, ...lines] = readFileSync(join(DIR, 'data/source', id + '.csv'), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map(line => {
    const v = Object.fromEntries(line.split(',').map((x, i) => [cols[i], x]));
    return cols.includes('open') ? { date: v.date, open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close) } : { date: v.date, close: Number(v.close) };
  });
}
const build = (item: typeof HISTORY20_CATALOG[number]) => buildHistoricalGrowthProgram({ scenarioId: item.id, targetPeakGrowthPercent: item.targetPeakGrowthPercent, rows: rows(item.id),
  source: { provider: item.provider, asset: item.asset, quote: item.quote, metric: item.metric, dataKind: item.dataKind, timeframe: '1d', sliceSha256: item.sourceSliceSha256, license: item.license } });
const listing = (program: ReturnType<typeof build>, initialPrice = '2') => parseListingConfig({
  schemaVersion: 1, symbol: 'VHX01', name: 'VOLTEX BotLab 01', logo: null, initialPrice, listingAt: '2026-11-02T00:00:00Z', displayTimeZone: 'UTC',
  ownerAllocation: '0', seedMode: 'manual', seed: 'vhx01-botlab-local-check', tradable: false,
  simulationProgram: { ...defaultScenarioControls(initialPrice), stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window',
    historicalGrowth: program, maxPrice: historicalGrowthMaxPrice(initialPrice, program.targetPeakGrowthPercent) },
});

run('History20 pack (local only)', () => {
  test('the committed metadata identifies exactly the pack files', () => {
    expect(sha(readFileSync(join(DIR, 'catalog.json')))).toBe(HISTORY20_PACK.catalogSha256);
    expect(sha(readFileSync(join(DIR, 'ROTATION_20.json')))).toBe(HISTORY20_PACK.rotationSha256);
    const catalog = JSON.parse(readFileSync(join(DIR, 'catalog.json'), 'utf8'));
    expect(catalog.scenarios.map((s: { id: string }) => s.id)).toEqual(HISTORY20_CATALOG.map(i => i.id));
    expect(JSON.parse(readFileSync(join(DIR, 'ROTATION_20.json'), 'utf8')).order).toEqual(HISTORY20_ROTATION);
    for (const item of HISTORY20_CATALOG) {
      expect(sha(readFileSync(join(DIR, 'data/source', item.id + '.csv')))).toBe(item.sourceSliceSha256);
      expect(sha(readFileSync(join(DIR, 'data/scenarios', item.id + '.json')))).toBe(item.scenarioFileSha256);
    }
  });

  test('all 20 rebuild from their source slice and reproduce normalized_path; each fits a listing draft', () => {
    const report: Record<string, unknown>[] = [];
    for (const item of HISTORY20_CATALOG) {
      const program = build(item);
      const path = JSON.parse(readFileSync(join(DIR, 'data/scenarios', item.id + '.json'), 'utf8')).normalized_path as Record<string, number>[];
      const alpha = historicalGrowthAlpha(program), fields = item.dataKind === 'exchange_ohlcv' ? ['open', 'high', 'low', 'close'] : ['close'];
      let worst = 0;
      program.logs.forEach((row, i) => fields.forEach((field, c) => { worst = Math.max(worst, Math.abs(Math.exp(alpha * row[c] / 1e8) / path[i][field] - 1)); }));
      expect({ id: item.id, parityBelow2e8: worst < 2e-8 }).toEqual({ id: item.id, parityBelow2e8: true });
      expect(Math.abs(alpha / item.alpha - 1)).toBeLessThan(1e-8);
      const config = listing(program);
      report.push({ id: item.id, rows: program.logs.length, days: historicalGrowthElapsedSeconds(program) / 86400, parity: worst, draftBytes: historicalSerializedBytes(config) });
      expect(historicalSerializedBytes(config)).toBeLessThan(80 * 1024);
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report));
  });

  test('BotLab 01: P0 = 2 on VHX-01-BTC peaks at exactly 239.449 over every tick of 861 real days', () => {
    const program = build(HISTORY20_CATALOG[0]);
    const config = listing(program);
    expect(config.simulationProgram).toMatchObject({ maxPrice: '239.449' });
    const scheduled = listingSimulationConfig(config).scheduledScenario as Parameters<typeof controlledScenarioHour>[0];
    const cap = historicalGrowthCap('2', program.targetPeakGrowthPercent);
    const hours = historicalGrowthElapsedSeconds(program) / 3600;
    const started = Date.now();
    let top = 0;
    for (let hour = 0; hour < hours; hour++) for (const tick of controlledScenarioHour(scheduled, config.seed, hour).ticks) top = Math.max(top, tick.high);
    const generateMs = Date.now() - started;
    expect(top).toBeLessThanOrEqual(cap);
    expect(top / 239.449).toBeCloseTo(1, 12);
    const previewStarted = Date.now();
    const fragment = listingScenarioPreview(config, '4h', 'window', { fromDay: 830 });
    const previewMs = Date.now() - previewStarted;
    expect(fragment.candles.length).toBeLessThanOrEqual(181);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ hours, ticks: hours * 360, generateMs, previewMs, fragmentCandles: fragment.candles.length, observedHigh: fragment.scenarioSummary.observedHigh }));
  });
});
