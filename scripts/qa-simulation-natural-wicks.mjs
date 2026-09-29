#!/usr/bin/env node
/**
 * Capture actual deterministic generator output; never fetches or writes a
 * market. Node >=24. Before/after comparison is rendered by the sibling Python.
 *
 * node scripts/qa-simulation-natural-wicks.mjs --stage before --source-root /path/to/baseline --revision <sha>
 * node scripts/qa-simulation-natural-wicks.mjs --stage after --revision <sha-or-worktree-label>
 * python3 scripts/qa-simulation-natural-wicks.py
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const stage = arg('--stage', 'after');
if (!['before', 'after'].includes(stage)) throw new Error('--stage must be before or after');
const sourceRoot = resolve(arg('--source-root', repoRoot));
const sourceUrl = pathToFileURL(`${sourceRoot}/`).href;
const output = resolve(arg('--out', join(repoRoot, 'docs/qa/simulation-natural-wicks')));
const revision = arg('--revision', 'working-tree; source fingerprints are authoritative');
const loadedSources = new Map();
const sha = (value) => createHash('sha256').update(value).digest('hex');

// Transform the actual source files, including parameter properties, without
// copying generator formulas or changing its package settings.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceUrl)) {
      const url = new URL(specifier, context.parentURL);
      if (!extname(url.pathname) && existsSync(fileURLToPath(`${url.href}.ts`))) return nextResolve(`${url.href}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceUrl) && url.endsWith('.ts')) {
      const file = fileURLToPath(url), source = readFileSync(file, 'utf8');
      loadedSources.set(relative(sourceRoot, file), sha(source));
      return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: url }) };
    }
    return nextLoad(url, context);
  },
});

const source = (file) => pathToFileURL(join(sourceRoot, file)).href;
const { VOLTORA } = await import(source('src/services/testMarkets/testAssetConfig.ts'));
const { TestMarketSimulation, aggregateCandles, MINUTE_MS, HOUR_MS } = await import(source('src/services/testMarkets/testMarketSimulation.ts'));
const { SIMULATION_PROFILES } = await import(source('src/services/testMarkets/simulationRealism.ts'));
const { listingSimulationConfig } = await import(source('src/services/listings/listingConfig.ts'));
const { CYCLIC_IMPULSE_PRESETS, cycleForHour } = await import(source('src/services/testMarkets/simulationCycles.ts'));
const cutoff = Date.parse('2026-09-29T14:45:00Z');
const interval = 15 * MINUTE_MS;
const iso = (value) => new Date(value).toISOString();
const serial = (candles) => candles.map((c) => [c.openTime, c.open, c.close, c.volume, c.quoteVolume]);
const invariantDigest = (candles) => sha(JSON.stringify(serial(candles)));
function capture(id, label, config, from, end) {
  const sim = new TestMarketSimulation(config);
  const canonical5m = sim.candles5m(end, from).filter((c) => c.openTime >= from && c.openTime + 5 * MINUTE_MS <= end);
  const candles15m = aggregateCandles(canonical5m, interval).filter((c) => c.openTime >= from && c.openTime + interval <= end);
  const canonical1m = sim.candles1m(end, from).filter((c) => c.openTime >= from && c.openTime + MINUTE_MS <= end);
  for (const c of [...canonical5m, ...canonical1m, ...candles15m]) {
    if (![c.open, c.high, c.low, c.close, c.volume, c.quoteVolume].every(Number.isFinite)
      || c.low <= 0 || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) throw new Error(`Invalid actual candle in ${id}: ${JSON.stringify(c)}`);
  }
  return {
    id, label, configuration: config, startUtc: iso(from), endExclusiveUtc: iso(end),
    interval: '15m', closedCandlesOnly: true,
    candles15m, canonical5m,
    invariantEvidence: {
      canonical5mCount: canonical5m.length, canonical1mCount: canonical1m.length,
      canonical5mOpenCloseVolumeSha256: invariantDigest(canonical5m),
      canonical1mOpenCloseVolumeSha256: invariantDigest(canonical1m),
      last500CanonicalTradesSha256: sha(JSON.stringify(sim.recentTrades(end, 500))),
      finalPrice: sim.priceAt(end),
      scope: 'Open, close, volume and quoteVolume for every complete 1m/5m candle; last 500 canonical trades and final price. Full tick invariants belong to runtime tests.',
    },
  };
}

const cases = [
  capture('vta-history', 'VTA entire closed history at request cutoff', VOLTORA, VOLTORA.listingAt, cutoff),
  capture('vta-future', 'VTA next 24 hours (fixed simulated clock)', VOLTORA, cutoff, cutoff + 24 * HOUR_MS),
];
// The same fixture seed, price and listing time isolate profile character.
// New INSERTs persist NATURAL_V1 in the candidate. Model that explicit field
// here, then run the actual listing-to-simulation mapper. The before revision
// did not persist a wick model, so its otherwise identical fixtures omit it.
const fixtureListing = {
  symbol: 'QAW', name: 'Offline QA Wick Profile', logo: null, initialPrice: '0.01',
  listingAt: '2026-10-01T00:00:00Z', displayTimeZone: 'UTC', ownerAllocation: '0',
  seedMode: 'manual', seed: 'natural-wicks-reference-20260929', tradable: false,
};
for (const profile of SIMULATION_PROFILES) {
  const config = listingSimulationConfig({ ...fixtureListing, simulationProfile: profile,
    ...(stage === 'after' ? { wickModel: 'NATURAL_V1' } : {}),
  });
  cases.push(capture(`profile-${profile.toLowerCase()}`, `New simulated listing · ${profile}`, config, config.listingAt, config.listingAt + 24 * HOUR_MS));
}
const cycleEpisodes = [];
if (VOLTORA.cyclicImpulse) {
  const sim = new TestMarketSimulation(VOLTORA);
  for (let index = 0; index < CYCLIC_IMPULSE_PRESETS.length; index++) {
    const from = VOLTORA.cyclicImpulse.anchorAt + index * VOLTORA.cyclicImpulse.periodHours * HOUR_MS;
    const end = from + 2 * HOUR_MS;
    const canonical = sim.candles5m(end, from).filter((c) => c.openTime < end);
    const candles1h = aggregateCandles(canonical, HOUR_MS);
    const cycle = cycleForHour(VOLTORA.cyclicImpulse, VOLTORA.listingAt, (from - VOLTORA.listingAt) / HOUR_MS);
    cycleEpisodes.push({ index, startUtc: iso(from), endUtc: iso(end), preset: cycle?.preset, candles1h });
  }
}
const sourceSha256 = Object.fromEntries([...loadedSources].sort(([a], [b]) => a.localeCompare(b)));
for (const [file, fingerprint] of Object.entries(sourceSha256)) {
  if (sha(readFileSync(join(sourceRoot, file))) !== fingerprint) throw new Error(`Source changed during capture: ${file}; rerun against stable source.`);
}
const result = {
  schema: 'voltex-natural-wicks-preview-v1', stage,
  evidenceKind: 'Offline deterministic simulation from actual generator source. Not a browser screenshot, venue data, or deployment verification.',
  capturedAtUtc: iso(Date.now()), requestCutoffUtc: iso(cutoff),
  generation: {
    revision, sourceSha256, sourceFingerprint: sha(JSON.stringify(sourceSha256)),
    implementation: 'TestMarketSimulation.candles5m -> aggregateCandles(15 * MINUTE_MS)',
    futureListingImplementation: 'listingSimulationConfig -> TestMarketSimulation',
    futureListingWickModel: stage === 'after' ? 'NATURAL_V1; explicit field persisted for a new listing INSERT' : 'absent in the before revision',
    chartContract: 'Raw quote prices; shared before/after limits per panel; no candle edits, smoothing or vertical wick exaggeration.',
    timeConvention: 'UTC. The request cutoff is fixed at 2026-09-29 14:45, independently of capture time.',
  },
  cases, cycleEpisodes,
};
mkdirSync(output, { recursive: true });
const file = join(output, `${stage}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ file, stage, sourceFingerprint: result.generation.sourceFingerprint,
  cases: cases.map((c) => ({ id: c.id, candles: c.candles15m.length })), cycleEpisodes: cycleEpisodes.length }, null, 2));
