import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NEURIX } from '../neurix';

const { fingerprintFor, checkRelease } = require('../../../../scripts/check-nrx-scenario-release.cjs');

// Recorded from the serving legacy engine, not generated from the candidate.
const INSTALLED = '63610d3e181b31f67934f94436a2072a03ed13d4727060e83d80655a03a25961';
const MINUTE = 60_000;
const PAST = NEURIX.scheduledScenario!.from + 60 * MINUTE;
const SIMULATION = 'testMarketSimulation.ts';
const SCHEDULE = 'simulationSchedule.ts';
const CONTROLS = 'simulationScenarioControls.ts';
const SHARED_CONTROLS = '../../shared/listingScenarioControls.ts';
const source = (file: string): string => readFileSync(resolve(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

function withSource(file: string, changed: string) {
  return (name: string): string => name === file ? changed : source(name);
}

function replaceSource(file: string, from: string, to: string, occurrences = 1) {
  const original = source(file);
  // A changed fixture must never accidentally turn a negative test into the baseline.
  expect(original.split(from)).toHaveLength(occurrences + 1);
  return withSource(file, original.split(from).join(to));
}

function expectBlocked(readSource: (file: string) => string) {
  expect(() => checkRelease(NEURIX, PAST, INSTALLED, readSource)).toThrow();
}

describe('installed NRX release identity', () => {
  test('the unchanged legacy trajectory retains its recorded installed identity after activation', () => {
    expect(fingerprintFor(NEURIX, source)).toBe(INSTALLED);
    expect(checkRelease(NEURIX, PAST, INSTALLED, source)).toEqual({ fingerprint: INSTALLED, unchanged: true });
  });

  test.each([undefined, '', '0'.repeat(64)])('an elapsed activation requires the exact installed identity (%s)', installed => {
    expect(() => checkRelease(NEURIX, PAST, installed, source)).toThrow();
  });

  test('a changed prospective scenario still uses the ordinary future-activation gate', () => {
    const old = NEURIX.scheduledScenario!;
    const shift = PAST + 10 * MINUTE - old.from;
    const scenario = Object.fromEntries(Object.entries(old).map(([key, value]) => [
      key, (key === 'from' || key.endsWith('At')) && typeof value === 'number' ? value + shift : value,
    ]));
    const asset = { ...NEURIX, scheduledScenario: scenario };
    const result = checkRelease(asset, PAST, INSTALLED, source);
    expect(result.unchanged).toBe(false);
    expect(result.fingerprint).not.toBe(INSTALLED);
    expect(result.fingerprint).toBe(fingerprintFor(asset, source));
  });

  test.each([
    ['seed', { seed: NEURIX.seed + '-changed' }],
    ['initial price', { initialPrice: NEURIX.initialPrice + 0.01 }],
    ['listing time', { listingAt: NEURIX.listingAt + MINUTE }],
    ['schedule parameter', { scheduledScenario: { ...NEURIX.scheduledScenario, selloffFraction: 0.61 } }],
  ] as [string, Record<string, unknown>][])('a real legacy %s change cannot reuse the installed identity', (_label, change) => {
    expect(() => checkRelease({ ...NEURIX, ...change }, PAST, INSTALLED, source)).toThrow();
  });

  test.each([
    [SIMULATION, 'return Number(price.toPrecision(8));', 'return Number(price.toPrecision(7));'],
    [SCHEDULE, 'const centre = c.rangeFraction * .20 * noise(', 'const centre = c.rangeFraction * .21 * noise('],
    ['simulationRandom.ts', '0x6d2b79f5', '0x6d2b79f6'],
  ])('reachable trajectory changes remain covered: %s', (file, from, to) => {
    const changed = replaceSource(file, from, to);
    expect(fingerprintFor(NEURIX, changed)).not.toBe(INSTALLED);
    expectBlocked(changed);
  });

  test('line-ending differences do not change the installed identity', () => {
    expect(fingerprintFor(NEURIX, (file: string) => source(file).replace(/\n/g, '\r\n'))).toBe(INSTALLED);
  });
});

describe('only unreachable scenario-controls-v2 code is omitted', () => {
  test('an unreviewed inline formatter cap arm fails closed', () => {
    const changed = replaceSource(SIMULATION,
      'Math.min(Number(program.controls.maxPrice), Number(price.toFixed(10)))',
      'Math.min(Number(program.controls.maxPrice) * 0.99, Number(price.toFixed(9)))');
    expectBlocked(changed);
  });

  test('an unreviewed inline v2 dispatcher argument fails closed', () => {
    const changed = replaceSource(SCHEDULE,
      'return controlledScenarioHour(c, seed, hour);',
      'return controlledScenarioHour(c, seed, hour + 1);');
    expectBlocked(changed);
  });

  test('an inert v2 implementation-body change leaves legacy NRX identity unchanged', () => {
    const changed = replaceSource(CONTROLS,
      'const start = config.from + hour * HOUR, cap = Number(config.controls.maxPrice);',
      'const start = config.from + hour * HOUR, cap = Number(config.controls.maxPrice) * 0.99;');
    expect(fingerprintFor(NEURIX, changed)).toBe(INSTALLED);
  });

  test('the inline v2 validator cannot mutate globals later used by legacy markets', () => {
    expectBlocked(replaceSource(SCHEDULE,
      '    validateScenarioControls(c.controls, c.initialPrice);',
      '    Math.min = () => 0;\n    validateScenarioControls(c.controls, c.initialPrice);'));
  });

  test('the inline v2 dispatcher cannot mutate globals later used by legacy markets', () => {
    expectBlocked(replaceSource(SCHEDULE,
      '    return controlledScenarioHour(c, seed, hour);',
      '    Math.min = () => 0;\n    return controlledScenarioHour(c, seed, hour);'));
  });

  test('an inline formatter IIFE cannot hide a global mutation behind the v2 guard', () => {
    expectBlocked(replaceSource(SIMULATION,
      'Math.min(Number(program.controls.maxPrice), Number(price.toFixed(10)))',
      '(() => { Math.min = () => 0; return Math.min(Number(program.controls.maxPrice), Number(price.toFixed(10))); })()'));
  });

  test.each([
    [SCHEDULE, "if (c.mode === 'scenario-controls-v2') {", "if (c.mode !== 'scenario-controls-v2') {", 2],
    [SIMULATION, "!this.asset.isTradable && program?.mode === 'scenario-controls-v2'", "this.asset.isTradable || program?.mode === 'scenario-controls-v2'", 1],
    [SIMULATION, ': round(price);', ': Math.round(price);', 1],
    [SIMULATION, 'ticks: Tick[], format = round', 'ticks: Tick[], format = Math.round', 1],
  ] as [string, string, string, number][])('a changed guard or legacy formatter cannot be erased: %s / %s', (file, from, to, count) => {
    expectBlocked(replaceSource(file, from, to, count));
  });

  test('an imported v2 function newly called on the legacy path cannot be erased', () => {
    const changed = replaceSource(SCHEDULE,
      'const ctx = context(c, seed, listingAt, initialPrice, anchorPrice);',
      'controlledScenarioHour(c as any, seed, hour);\n  const ctx = context(c, seed, listingAt, initialPrice, anchorPrice);');
    expectBlocked(changed);
  });

  test('removing a formatter line cannot also remove an earlier effectful class field', () => {
    expectBlocked(replaceSource(SIMULATION,
      '  private formatPrice = (price: number): number => {',
      '  private releaseProbe = Math.random(); private formatPrice = (price: number): number => {'));
  });

  test('an async formatter cannot masquerade as the synchronous legacy formatter', () => {
    expectBlocked(replaceSource(SIMULATION,
      '  private formatPrice = (price: number): number => {',
      '  private formatPrice = async (price: number): Promise<number> => {'));
  });

  test('removing a dispatcher line cannot also remove an earlier executable statement', () => {
    const guard = "  if (!Number.isSafeInteger(hour) || hour < 0 || original.length !== 360) throw new RangeError('A scenario needs one complete canonical hour');";
    const block = "  if (c.mode === 'scenario-controls-v2') {\n    validateScheduledScenario(c, listingAt);\n    return controlledScenarioHour(c, seed, hour);\n  }";
    const changed = replaceSource(SCHEDULE, guard + '\n' + block,
      '  Math.random(); ' + block.trimStart() + '\n' + guard);
    expectBlocked(changed);
  });

  test.each([
    'var context;',
    'var context = () => undefined;',
    'enum context { VALUE }',
    'namespace context { export const value = 1; }',
  ])('a supposedly dead branch must not hide hoisted bindings: %s', declaration => {
    const changed = replaceSource(SCHEDULE,
      'return controlledScenarioHour(c, seed, hour);',
      `${declaration}\n    return controlledScenarioHour(c, seed, hour);`);
    expectBlocked(changed);
  });
});

describe('omitted v2 imports have no untracked import-time effects', () => {
  test.each([
    ['call', 'const releaseProbe = Math.random();'],
    ['IIFE', 'const releaseProbe = (() => { Math.random(); return 0; })();'],
    ['class initialization', 'class ReleaseProbe { static value = Math.random(); }'],
    ['getter initializer', 'const releaseProbe = { get value() { return Math.random(); } }.value;'],
    ['computed property', 'const releaseProbe = { [Math.random()]: 1 };'],
    ['array spread', 'const releaseProbe = [...{ [Symbol.iterator]: function* () { Math.random(); yield 1; } }];'],
    ['coercive object initializer', 'const releaseProbe = +{ valueOf: () => { Math.random(); return 1; } };'],
    ['coercive array initializer', 'const releaseProbe = -[{ toString: () => { Math.random(); return "1"; } }];'],
    ['side-effect import', "import './untracked-release-probe';"],
    ['new runtime dependency', "import { readFileSync } from 'node:fs';"],
    ['runtime re-export', "export { seededRandom } from './untracked-release-probe';"],
  ])('rejects %s in the omitted simulation module', (_label, statement) => {
    expectBlocked(withSource(CONTROLS, source(CONTROLS) + '\n' + statement + '\n'));
  });

  test('the shared controls module is also checked for import-time effects', () => {
    expectBlocked(withSource(SHARED_CONTROLS, source(SHARED_CONTROLS) + '\nMath.random();\n'));
  });

  test('malformed omitted dependency source fails closed', () => {
    expectBlocked(withSource(CONTROLS, source(CONTROLS) + '\nconst broken = ;\n'));
  });
});
