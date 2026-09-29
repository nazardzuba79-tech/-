#!/usr/bin/env node
/**
 * Deterministic, offline preview of the actual VTA generator in this tree.
 * Node >=24; Python 3 + matplotlib to render. No database, HTTP or live clock.
 *
 *   node scripts/qa-vta-cycles.mjs
 *   node scripts/qa-vta-cycles.mjs --json-only
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootUrl = pathToFileURL(`${root}/`).href;
const output = join(root, 'docs/qa/vta-cycles');
const sourceFiles = [
  'src/services/testMarkets/testAssetConfig.ts',
  'src/services/testMarkets/testMarketSimulation.ts',
  'src/services/testMarkets/simulationCycles.ts',
  'src/services/testMarkets/simulationRealism.ts',
  'src/services/testMarkets/simulationRandom.ts',
];
const digestSources = () => Object.fromEntries(sourceFiles.map((file) => [file,
  createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]));
const before = digestSources();

// Compile the checked-out TypeScript modules with Node's bundled TypeScript
// transformer, including parameter properties. Resolve their extensionless
// relative imports without changing the backend's files or package settings.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(rootUrl)) {
      const url = new URL(specifier, context.parentURL);
      if (!extname(url.pathname) && existsSync(fileURLToPath(`${url.href}.ts`))) {
        return nextResolve(`${url.href}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(rootUrl) && url.endsWith('.ts')) {
      return {
        format: 'module', shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), {
          mode: 'transform', sourceUrl: url,
        }),
      };
    }
    return nextLoad(url, context);
  },
});

const { VOLTORA } = await import(pathToFileURL(join(root, sourceFiles[0])).href);
const { TestMarketSimulation, aggregateCandles, HOUR_MS } = await import(pathToFileURL(join(root, sourceFiles[1])).href);
const { CYCLIC_IMPULSE_PRESETS, cycleForHour } = await import(pathToFileURL(join(root, sourceFiles[2])).href);
if (!VOLTORA.cyclicImpulse) throw new Error('VTA cyclicImpulse must be configured; preview does not invent a config.');
const cycleConfig = VOLTORA.cyclicImpulse;
const count = CYCLIC_IMPULSE_PRESETS.length;
const simulation = new TestMarketSimulation(VOLTORA);
const noCycle = new TestMarketSimulation({ ...VOLTORA, cyclicImpulse: undefined });
const noBoost = new TestMarketSimulation({ ...VOLTORA, wickBoostFrom: undefined });
const iso = (time) => new Date(time).toISOString();
const normalize = (candles, reference) => candles.map((c) => ({
  ...c, open: c.open / reference * 100, high: c.high / reference * 100,
  low: c.low / reference * 100, close: c.close / reference * 100,
}));
const completed5m = (sim, from, end) => sim.candles5m(end, from).filter((c) => c.openTime < end);
const assertCandle = (c) => {
  if (![c.open, c.high, c.low, c.close, c.volume, c.quoteVolume].every(Number.isFinite)
    || c.low <= 0 || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
    throw new Error(`Invalid generator candle: ${JSON.stringify(c)}`);
  }
};
const episodes = Array.from({ length: count }, (_, index) => {
  const from = cycleConfig.anchorAt + index * cycleConfig.periodHours * HOUR_MS;
  const end = from + 2 * HOUR_MS;
  const cycle = cycleForHour(cycleConfig, VOLTORA.listingAt, (from - VOLTORA.listingAt) / HOUR_MS);
  if (!cycle || cycle.phase !== 'shock') throw new Error(`Episode ${index + 1} is inactive at ${iso(from)}.`);
  const candles5m = completed5m(simulation, from, end);
  const candles1h = aggregateCandles(candles5m, HOUR_MS);
  if (candles1h.length !== 2 || candles5m.length !== 24) throw new Error('Episode must contain two complete canonical hours.');
  candles5m.forEach(assertCandle);
  const [shock, recovery] = candles1h;
  const baselineClose = noCycle.priceAt(end);
  return {
    number: index + 1, preset: cycle.preset, startUtc: iso(from), endUtc: iso(end),
    protectedTicksInShockHour: cycle.protectedTicks,
    rawCandles1h: candles1h, rawCandles5m: candles5m,
    normalizedCandles1h: normalize(candles1h, shock.open),
    metrics: {
      shockLowFromOpenPercent: (shock.low / shock.open - 1) * 100,
      shockCloseFromOpenPercent: (shock.close / shock.open - 1) * 100,
      dropRecoveredPercent: (shock.close - shock.low) / (shock.open - shock.low) * 100,
      recoveryCloseFromItsOpenPercent: (recovery.close / recovery.open - 1) * 100,
      recoveryUpperWickBeyondBodyPercent: (recovery.high / Math.max(recovery.open, recovery.close) - 1) * 100,
      baselineClose, baselineRejoinAbsoluteDifference: recovery.close - baselineClose,
    },
  };
});

const sequenceFrom = cycleConfig.anchorAt;
const sequenceEnd = sequenceFrom + 24 * HOUR_MS;
const sequence5m = completed5m(simulation, sequenceFrom, sequenceEnd);
const sequence1h = aggregateCandles(sequence5m, HOUR_MS);
const firstOpen = sequence1h[0].open;
const ordinary5m = sequence5m.filter((c) => !cycleForHour(cycleConfig, VOLTORA.listingAt, Math.floor((c.openTime - VOLTORA.listingAt) / HOUR_MS)));
const noBoost5m = new Map(completed5m(noBoost, sequenceFrom, sequenceEnd).map((c) => [c.openTime, c]));
const wickPercent = (c) => (c.high - Math.max(c.open, c.close) + Math.min(c.open, c.close) - c.low) / c.open * 100;
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const boostedMean = mean(ordinary5m.map(wickPercent));
const withoutBoostMean = mean(ordinary5m.map((c) => wickPercent(noBoost5m.get(c.openTime))));
const after = digestSources();
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Generator files changed while producing QA. Run again on the stable tree.');

const result = {
  schema: 'voltex-vta-cycle-preview-v1',
  evidenceKind: 'offline deterministic simulated preview; not live market observations',
  generation: {
    implementation: 'TestMarketSimulation.candles5m -> aggregateCandles(HOUR_MS)',
    sourceSha256: before,
    sourceFingerprint: createHash('sha256').update(JSON.stringify(before)).digest('hex'),
    configuration: VOLTORA,
    timeConvention: 'All timestamps UTC; preview calls use fixed future simulation instants.',
    normalization: 'Each episode: OHLC / its shock-hour opening price * 100. Sequence: OHLC / first hourly open * 100.',
    metricFormulas: {
      shockLowFromOpenPercent: '(shock.low / shock.open - 1) * 100',
      shockCloseFromOpenPercent: '(shock.close / shock.open - 1) * 100',
      dropRecoveredPercent: '(shock.close - shock.low) / (shock.open - shock.low) * 100',
      recoveryCloseFromItsOpenPercent: '(recovery.close / recovery.open - 1) * 100',
      recoveryUpperWickBeyondBodyPercent: '(recovery.high / max(recovery.open, recovery.close) - 1) * 100',
    },
  },
  episodes,
  sequence24h: {
    startUtc: iso(sequenceFrom), endUtc: iso(sequenceEnd),
    rawCandles1h: sequence1h, rawCandles5m: sequence5m,
    normalizedCandles1h: normalize(sequence1h, firstOpen),
    phaseByHour: sequence1h.map((c) => {
      const cycle = cycleForHour(cycleConfig, VOLTORA.listingAt, (c.openTime - VOLTORA.listingAt) / HOUR_MS);
      return cycle ? { phase: cycle.phase, episodeNumber: cycle.index + 1 } : { phase: 'ordinary' };
    }),
  },
  ordinaryWickComparison: {
    comparison: 'Same new profile and cycles, wickBoostFrom enabled versus absent. Completed ordinary 5m candles in the first 24-hour preview only.',
    count: ordinary5m.length,
    metric: '(upper shadow + lower shadow) / open * 100; arithmetic mean across the sample',
    enabledMeanPercentOfOpen: boostedMean,
    withoutBoostMeanPercentOfOpen: withoutBoostMean,
    relativeIncreasePercent: (boostedMean / withoutBoostMean - 1) * 100,
    allBodiesIdentical: ordinary5m.every((c) => c.open === noBoost5m.get(c.openTime).open && c.close === noBoost5m.get(c.openTime).close),
  },
};
mkdirSync(output, { recursive: true });
const jsonPath = join(output, 'actual-generator-results.json');
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
if (!process.argv.includes('--json-only')) {
  const python = process.env.QA_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
  const rendered = spawnSync(python, [join(root, 'scripts/qa-vta-cycles.py'), jsonPath], { cwd: root, stdio: 'inherit' });
  if (rendered.error) throw rendered.error;
  if (rendered.status !== 0) throw new Error(`Preview renderer exited ${rendered.status}`);
}
console.log(JSON.stringify({
  evidence: jsonPath,
  sourceFingerprint: result.generation.sourceFingerprint,
  episodes: episodes.map((e) => ({ number: e.number, startUtc: e.startUtc, ...e.metrics })),
  ordinaryWickComparison: result.ordinaryWickComparison,
}, null, 2));
