import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createContext, Script } from 'vm';
import ts from 'typescript';
import type { CashflowReviewState } from '../reviewEconomicsTypes';
import approvedHashes from './canonicalSourceHashes.json';
import transitionFixture from './fixtures/canonicalTransition183.json';

// Captured from origin/claude/review-ready 0a9c9022b8cf0cac757328606eaf9c7b52fa3a86,
// not from a refitted/new generator. Only CRLF/LF transport is normalized.
const text = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const canonical = (file: string) => text(resolve(__dirname, '..', file));
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const fixtureHash = '4055754d233d4d430028542c5fc4cb52df8cfd1e3a77deb8f01e189147f54750';
type Transition = { originalHash: string; blocks: { startLine: number; lineCount: number; current: string; original: string }[] };
const transitions: Record<string, Transition> = transitionFixture.transitions;
const pins: Record<string, string> = approvedHashes;
const demand = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

function verifyFixture() {
  demand(hash(text(resolve(__dirname, 'fixtures/canonicalTransition183.json'))) === fixtureHash, 'Transition fixture changed');
  demand(transitionFixture.pinnedSource === '0a9c9022b8cf0cac757328606eaf9c7b52fa3a86', 'Original source changed');
  for (const module of Object.values(transitionFixture.originalModules)) {
    demand(hash(module.source) === module.sha256 && module.sha256 === pins[module.file], 'Original dependency pin mismatch');
  }
}

function verifyCanonical(file: string, original: string, helper = canonical('dailyProgression.ts')) {
  verifyFixture();
  let source = original;
  if (file === 'reviewFollowerLedger.ts') {
    // The approved quantity integration exception retains exact exported quantity
    // tokens after historic JSONB transport. No financial formula is changed.
    const importLine = "import { retainPublishedQuantityTail } from '../publishedQuantityCompatibility';\n";
    const hook = ' && !retainPublishedQuantityTail(existing, record)';
    demand(source.split(importLine).length === 2, 'Quantity import changed');
    demand(source.split(hook).length === 2, 'Quantity hook changed');
    source = source.replace(importLine, '').replace(hook, '');
  }
  if (file === 'reviewPerformanceV8.ts') {
    // The synthetic presentation revision adds one opt-in constructor AFTER
    // the original file; every original default/append/math byte stays frozen.
    const marker = '\n// BEGIN OPT-IN NAZAR PRESENTATION REPLAY\n';
    demand(source.split(marker).length === 2, 'Presentation marker changed');
    demand(source.endsWith('// END OPT-IN NAZAR PRESENTATION REPLAY\n'), 'Presentation suffix changed');
    source = source.slice(0, source.indexOf(marker));
  }

  // PR183's exact merged transition is an explicit exception, not a new pin.
  // Reverse only its reviewed literal spans, at their original callsites, then
  // require every remaining byte to match the ORIGINAL approved hash.
  const transition = transitions[file];
  if (transition) {
    demand(helper === transitionFixture.dailyHelper.source && hash(helper) === transitionFixture.dailyHelper.sha256, 'Cadence dependency changed');
    demand(transition.originalHash === pins[file], 'Original pin changed');
    for (const block of [...transition.blocks].sort((a, b) => b.startLine - a.startLine)) {
      const lines = source.split('\n');
      demand(lines.slice(block.startLine - 1, block.startLine - 1 + block.lineCount).join('\n') + '\n' === block.current,
        'Transition callsite changed');
      demand(source.split(block.current).length === 2, 'Transition span changed or duplicated');
      source = source.replace(block.current, block.original);
    }
  }
  demand(hash(source) === pins[file], 'Original canonical pin mismatch');
  return source;
}

test.each(Object.entries(approvedHashes))('%s preserves original approved bytes outside exact reviewed exceptions', (file, sha) => {
  expect(hash(verifyCanonical(file, canonical(file)))).toBe(sha);
});

test('the exact merged cadence dependency keeps the September 21/22 boundary', () => {
  const helper = canonical('dailyProgression.ts');
  expect(helper).toBe(transitionFixture.dailyHelper.source);
  expect(hash(helper)).toBe(transitionFixture.dailyHelper.sha256);
  const vm = generatorVm({ './dailyProgression': helper });
  expect(vm.call<boolean>('./dailyProgression', 'dailyProgressionApplies', ['2026-09-21'])).toBe(false);
  expect(vm.call<boolean>('./dailyProgression', 'dailyProgressionApplies', ['2026-09-22'])).toBe(true);
});

test.each(['kseniaReview.ts', 'reviewPerformanceV8.ts'])('%s rejects altered, duplicated and moved transition spans', file => {
  const source = canonical(file);
  for (const block of transitions[file].blocks) {
    expect(() => verifyCanonical(file, source.replace(block.current, block.current + block.current))).toThrow();
    expect(() => verifyCanonical(file, source.replace(block.current, '\n' + block.current))).toThrow();
    expect(() => verifyCanonical(file, source.replace(block.current, block.current.replace(/\S/, '!')))).toThrow();
  }
  const importBlock = transitions[file].blocks[0].current;
  expect(() => verifyCanonical(file, source.replace(importBlock, '') + importBlock)).toThrow();
});

test('the exceptions cannot admit changed money math, return, leverage, or an earlier cadence', () => {
  const ksenia = canonical('kseniaReview.ts'), nazar = canonical('reviewPerformanceV8.ts');
  expect(() => verifyCanonical('kseniaReview.ts', ksenia.replace('requiredLeverage > 6', 'requiredLeverage > 60'))).toThrow();
  expect(() => verifyCanonical('kseniaReview.ts', ksenia.replace('return: dailyReturn,', 'return: dailyReturn + .01,'))).toThrow();
  expect(() => verifyCanonical('reviewPerformanceV8.ts', nazar.replace('Math.round(value * MONEY_SCALE)', 'Math.floor(value * MONEY_SCALE)'))).toThrow();
  expect(() => verifyCanonical('reviewPerformanceV8.ts', nazar.replace('count: 1,', 'count: 2,'))).toThrow();
  for (const helper of [canonical('dailyProgression.ts').replace('2026-09-22', '2026-09-21'),
    canonical('dailyProgression.ts').replace('date >= DAILY_PROGRESSION_EFFECTIVE_FROM', 'true'),
    canonical('dailyProgression.ts').replace('date >= DAILY_PROGRESSION_EFFECTIVE_FROM', 'date > DAILY_PROGRESSION_EFFECTIVE_FROM')]) {
    expect(() => verifyCanonical('reviewPerformanceV8.ts', nazar, helper)).toThrow();
  }
});

// The original version and its ENTIRE runtime dependency closure are literal
// authenticated 0a9c9022 sources, not Git reads or current-derived snapshots.
// Both versions execute in a bounded VM with no host require/process/network.
function generatorVm(sources: Record<string, string>) {
  const allowed = new Set(['./reviewPerformanceV8', './reviewPerformanceV8Config', './reviewEconomicsConfig', './dailyProgression']);
  demand(Object.keys(sources).every(id => allowed.has(id)), 'Unapproved VM module');
  const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  const load = (id: string): Record<string, unknown> => {
    demand(allowed.has(id) && Object.prototype.hasOwnProperty.call(sources, id), 'Unapproved VM import');
    const existing = modules.get(id);
    if (existing) return existing.exports;
    const module = { exports: Object.create(null) as Record<string, unknown> };
    modules.set(id, module);
    const compiled = ts.transpileModule(sources[id], { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    context.__module = module;
    context.__require = load;
    new Script(`(function(exports, require, module) { ${compiled}\n })(__module.exports, __require, __module);`, { filename: id })
      .runInContext(context, { timeout: 1000 });
    return module.exports;
  };
  return {
    call<T>(id: string, method: string, args: unknown[] = []): T {
      demand(['createSimpleReturnMasterState', 'advanceSimpleReturnMasterState', 'dailyProgressionApplies'].includes(method), 'Unapproved VM export');
      context.__target = load(id);
      context.__method = method;
      context.__args = JSON.parse(JSON.stringify(args));
      const value = new Script('__target[__method](...__args)').runInContext(context, { timeout: 5000 });
      return JSON.parse(JSON.stringify(value)) as T;
    },
  };
}

const generatorId = './reviewPerformanceV8';
const daysTo = (state: CashflowReviewState, date: string) => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(state.simulatedAt.slice(0, 10) + 'T00:00:00Z')) / 86_400_000);
const originalSources = () => Object.fromEntries(Object.entries(transitionFixture.originalModules).map(([id, module]) => [id, module.source]));
function currentSources() {
  const sources = originalSources();
  // No silently current helper: both old dependencies must still be exact.
  for (const module of Object.values(transitionFixture.originalModules)) {
    if (module.file !== 'reviewPerformanceV8.ts') demand(canonical(module.file) === module.source, 'Old-version dependency changed');
  }
  verifyCanonical('reviewPerformanceV8.ts', canonical('reviewPerformanceV8.ts'));
  return { ...sources, [generatorId]: canonical('reviewPerformanceV8.ts'), './dailyProgression': canonical('dailyProgression.ts') };
}
const advance = (vm: ReturnType<typeof generatorVm>, state: CashflowReviewState, days: number) =>
  vm.call<CashflowReviewState>(generatorId, 'advanceSimpleReturnMasterState', [state, days]);
let oldVm: ReturnType<typeof generatorVm>, currentVm: ReturnType<typeof generatorVm>;
let oldBase: CashflowReviewState, currentBase: CashflowReviewState, oldSeptember21: CashflowReviewState, currentSeptember21: CashflowReviewState;
beforeAll(() => {
  verifyFixture();
  oldVm = generatorVm(originalSources()); currentVm = generatorVm(currentSources());
  oldBase = oldVm.call<CashflowReviewState>(generatorId, 'createSimpleReturnMasterState');
  currentBase = currentVm.call<CashflowReviewState>(generatorId, 'createSimpleReturnMasterState');
  oldSeptember21 = advance(oldVm, oldBase, daysTo(oldBase, '2026-09-21'));
  currentSeptember21 = advance(currentVm, currentBase, daysTo(currentBase, '2026-09-21'));
});

test('actual 0a9c9022 Nazar and current code produce byte-equal COMPLETE states through September 21', () => {
  expect(JSON.stringify(currentBase)).toBe(JSON.stringify(oldBase));
  expect(JSON.stringify(currentSeptember21)).toBe(JSON.stringify(oldSeptember21));
  expect(currentSeptember21.simulatedAt.slice(0, 10)).toBe('2026-09-21');
  console.info('canonical-pre-cutover-proof', JSON.stringify({ source: transitionFixture.pinnedSource,
    baselineOld: hash(JSON.stringify(oldBase)), baselineCurrent: hash(JSON.stringify(currentBase)),
    through: '2026-09-21', completeOld: hash(JSON.stringify(oldSeptember21)), completeCurrent: hash(JSON.stringify(currentSeptember21)) }));
});

function expectHistoricalPrefix(before: CashflowReviewState, after: CashflowReviewState) {
  for (const key of ['trades', 'dailyResults', 'equityHistory', 'aumHistory'] as const) {
    expect(JSON.stringify(after[key].slice(0, before[key].length))).toBe(JSON.stringify(before[key]));
  }
  for (const key of ['masterDays', 'masterCashFlows', 'copiedTrades', 'performanceFeeEvents'] as const) {
    expect(JSON.stringify(after.cashflow[key].slice(0, before.cashflow[key].length))).toBe(JSON.stringify(before.cashflow[key]));
  }
}

test('September 22 changes only new-day cadence and retains complete old history, split/restart and leverage bounds', () => {
  const beforeBytes = JSON.stringify(currentSeptember21);
  const day22 = advance(currentVm, currentSeptember21, 1);
  expect(day22.simulatedAt.slice(0, 10)).toBe('2026-09-22');
  expect(day22.trades.length - currentSeptember21.trades.length).toBe(1);
  expect(day22.trades[day22.trades.length - 1].closedAt.slice(0, 10)).toBe('2026-09-22');
  expectHistoricalPrefix(oldSeptember21, day22);
  const batch = advance(currentVm, currentSeptember21, 4);
  const restart = JSON.parse(JSON.stringify(day22)) as CashflowReviewState;
  expect(JSON.stringify(advance(currentVm, restart, 3))).toBe(JSON.stringify(batch));
  expect(JSON.stringify(advance(currentVm, currentSeptember21, 0))).toBe(beforeBytes);
  expect(JSON.stringify(currentSeptember21)).toBe(beforeBytes);
  for (const trade of batch.trades.slice(currentSeptember21.trades.length)) {
    expect(trade.leverage).toBeGreaterThanOrEqual(2);
    expect(trade.leverage).toBeLessThanOrEqual(8);
    const capital = batch.cashflow.masterDays.find(day => day.date === trade.closedAt.slice(0, 10))!.capitalAtRisk;
    expect(trade.entryPrice * trade.quantity / trade.leverage).toBeLessThanOrEqual(capital);
  }
});

test('an original zero-return Nazar day remains zero after the cadence adds a breakeven row', () => {
  const date = '2027-01-17';
  const old = advance(oldVm, oldSeptember21, daysTo(oldSeptember21, date));
  const current = advance(currentVm, currentSeptember21, daysTo(currentSeptember21, date));
  expect(old.dailyResults[old.dailyResults.length - 1].dailyReturn).toBe(0);
  expect(current.dailyResults[current.dailyResults.length - 1].dailyReturn).toBe(0);
  expect(current.dailyResults[current.dailyResults.length - 1].realizedPnl).toBe(0);
  const trades = current.trades.filter(trade => trade.closedAt.startsWith(date));
  expect(trades).toHaveLength(1);
  expect(trades[0]).toMatchObject({ result: 'BREAKEVEN', netPnl: 0 });
  expectHistoricalPrefix(oldSeptember21, current);
});

test.each(['node:fs', 'node:http', 'child_process', '../reviewPerformanceV8'])('old-version VM rejects unapproved import %s', dependency => {
  const sources = originalSources();
  sources[generatorId] += `\nrequire(${JSON.stringify(dependency)});\n`;
  expect(() => generatorVm(sources).call(generatorId, 'createSimpleReturnMasterState')).toThrow('Unapproved VM import');
});
