import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import {
  LAB_SCENARIOS, LAB_STORAGE_KEY, addLabRun, aggregateLabBars, emptyLabState,
  restoreLabState, scenarioAt, simulateLabMinutes, validateLabRun, type LabRun,
} from '../../pages/admin/listingScenarioModel';
const sample: LabRun = { version: 1, source: 'admin-simulation', tradable: false, id: 'sample-1',
  scenario: 'calm', seed: 'unit-test-01', initialPrice: 1, start: 1767225600, hours: 48 };
const input = (id: string) => ({ id, seed: sample.seed, initialPrice: sample.initialPrice, start: sample.start, hours: sample.hours });

describe('isolated scenario laboratory', () => {
  test('ten unique scenarios, Russian labels and a repeating automatic sequence', () => {
    expect(LAB_SCENARIOS).toHaveLength(10);
    expect(new Set(LAB_SCENARIOS.map(s => s.id)).size).toBe(10);
    for (const s of LAB_SCENARIOS) expect(s.name).toMatch(/[А-Яа-яЁё]/);
    for (let n = 0; n < 30; n++) expect(scenarioAt(n)).toBe(LAB_SCENARIOS[n % 10].id);
    expect(() => scenarioAt(-1)).toThrow();
    expect(() => scenarioAt(NaN)).toThrow();
  });
  test('assignment persists; manual selection does not consume the automatic queue', () => {
    let s = addLabRun(emptyLabState(), input('a'), 'auto');
    expect(s.runs[0].scenario).toBe('calm');
    s = addLabRun(s, input('b'), 'stress');
    expect(s.next).toBe(1);
    const restored = restoreLabState(JSON.stringify(s));
    expect(restored).toEqual(s);
    s = addLabRun(restored, input('c'), 'auto');
    expect(s.runs[0].scenario).toBe('impulse');
    expect(s.runs[1].scenario).toBe('stress');
    expect(s.runs[2].scenario).toBe('calm');
  });
  test('only the latest twenty examples are retained without resetting the ordinal', () => {
    let s = emptyLabState();
    for (let n = 0; n < 23; n++) s = addLabRun(s, input(`id-${n}`), 'auto');
    expect(s.runs).toHaveLength(20); expect(s.next).toBe(23);
    expect(s.runs[0].id).toBe('id-22');
  });
  test.each([0, -1, NaN, Infinity, 1000001])('invalid initial price %s is rejected', initialPrice => {
    expect(() => validateLabRun({ ...sample, initialPrice })).toThrow();
  });
  test('untrusted storage cannot enable trading or inject an unknown scenario/version', () => {
    for (const change of [{ tradable: true }, { source: 'live' }, { scenario: 'constructor' }, { version: 2 }, { start: 1 }, { hours: 100000 }, { seed: '' }])
      expect(() => validateLabRun({ ...sample, ...change })).toThrow();
    expect(() => restoreLabState('{bad')).toThrow();
    expect(() => restoreLabState(JSON.stringify({ version: 1, next: -1, runs: [] }))).toThrow();
    expect(() => restoreLabState(JSON.stringify({ version: 1, next: 1, runs: [sample, sample] }))).toThrow();
    expect(() => addLabRun({ version: 1, next: 1, runs: [sample] }, input(sample.id), 'auto')).toThrow();
    expect(LAB_STORAGE_KEY).toBe('voltex.admin.scenario-lab.v1');
  });
  test.each(LAB_SCENARIOS.map(s => s.id))('%s: stable prefix, finite OHLC, mixed bodies and exact timeframe aggregation', scenario => {
    const run = { ...sample, scenario };
    const bars = simulateLabMinutes(run);
    expect(bars).toHaveLength(2880);
    expect(simulateLabMinutes(run, 67)).toEqual(bars.slice(0, 67));
    expect(simulateLabMinutes(restoreLabState(JSON.stringify({ version: 1, next: 0, runs: [run] })).runs[0])).toEqual(bars);
    expect(bars.some(b => b.close > b.open)).toBe(true);
    expect(bars.some(b => b.close < b.open)).toBe(true);
    expect(bars.some(b => b.high > Math.max(b.open, b.close) || b.low < Math.min(b.open, b.close))).toBe(true);
    expect(new Set(bars.map(b => (b.close / b.open).toFixed(7))).size).toBeGreaterThan(100);
    bars.forEach((b, i) => {
      expect([b.open, b.close, b.low, b.high, b.volume].every(Number.isFinite)).toBe(true);
      expect(b.low).toBeGreaterThan(0);
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.volume).toBeGreaterThan(0);
      if (i) expect(b.open).toBe(bars[i - 1].close);
    });
    for (const tf of [15, 60, 240] as const) {
      const combined = aggregateLabBars(bars, tf);
      expect(combined).toHaveLength(2880 / tf);
      const first = bars.slice(0, tf);
      expect(combined[0]).toEqual({ time: sample.start, open: first[0].open,
        high: Math.max(...first.map(b => b.high)), low: Math.min(...first.map(b => b.low)),
        close: first[first.length - 1].close, volume: first.reduce((s, b) => s + b.volume, 0) });
    }
    const direct = aggregateLabBars(bars, 240), via15 = aggregateLabBars(aggregateLabBars(bars, 15), 240);
    direct.forEach((b, i) => { expect(via15[i].open).toBe(b.open); expect(via15[i].high).toBe(b.high);
      expect(via15[i].low).toBe(b.low); expect(via15[i].close).toBe(b.close); expect(via15[i].volume).toBeCloseTo(b.volume, 5); });
    expect(aggregateLabBars(simulateLabMinutes(run, 75), 60)[1].close).toBe(bars[74].close);
  });
  test('time horizon never changes previously generated candles', () => {
    expect(simulateLabMinutes({ ...sample, hours: 24 })).toEqual(simulateLabMinutes({ ...sample, hours: 168 }, 1440));
    expect(() => simulateLabMinutes(sample, -1)).toThrow();
    expect(() => simulateLabMinutes(sample, 2881)).toThrow();
    expect(() => aggregateLabBars([{ time: 0, open: 1, high: 0.5, low: 1, close: 1, volume: 1 }], 15)).toThrow();
  });
  test('scenario changes are genuinely different paths, not one shared closing target', () => {
    const closes = LAB_SCENARIOS.map(s => simulateLabMinutes({ ...sample, scenario: s.id }, 120).pop()!.close);
    expect(new Set(closes).size).toBe(10);
  });
  test('laboratory has no transport or financial imports and no consumer outside the admin/tests', () => {
    const src = resolve(__dirname, '../..');
    const model = readFileSync(resolve(src, 'pages/admin/listingScenarioModel.ts'), 'utf8');
    const ui = readFileSync(resolve(src, 'pages/admin/ListingScenarioLab.tsx'), 'utf8');
    expect(model).not.toMatch(/\bimport\s|\bfetch\s*\(|WebSocket|Math\.random|Date\.now/);
    expect(ui).not.toMatch(/\bfetch\s*\(|WebSocket|setInterval|adminListingsApi|\.publish\(/);
    expect(ui).toContain('onSessionChange');
    expect(ui).toContain('СИМУЛЯЦИЯ');
    expect(ui).toContain('sessionStorage');
    expect(ui).toContain('не обращается к балансам');
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = join(dir, name);
        if (statSync(file).isDirectory()) { if (name !== '__tests__') scan(file); }
        else if (/\.tsx?$/.test(name) && !file.includes(`${join('pages', 'admin')}`)
          && /(?:from\s+|import\()['"][^'"]*(?:listingScenarioModel|ListingScenarioLab)/.test(readFileSync(file, 'utf8'))) offenders.push(file);
      }
    };
    scan(src); expect(offenders).toEqual([]);
  });
});
