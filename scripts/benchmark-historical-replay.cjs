#!/usr/bin/env node
/** Isolated CPU/RAM diagnostic, NOT a CX23 capacity or production-load claim.
 * Run: node --expose-gc scripts/benchmark-historical-replay.cjs
 * No network, database, production keys, real market data or timing-based CI gate.
 * Mutable inputs exercise the unchanged reference loop; frozen snapshots use the index.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (mod, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  mod._compile(result.outputText, filename);
};
const shared = require(path.join(root, 'src/shared/listingHistoricalReplay.ts'));
const runtime = require(path.join(root, 'src/services/testMarkets/simulationScenarioControls.ts'));
function fixture(hours) {
  const clips = [];
  for (let start = 0; start < hours; start += 2400) {
    clips.push({ source: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'][clips.length],
      sourceStart: '2021-01-01T00:00:00.000Z', resolution: '1h', provenance: 'USER_SUPPLIED_UNVERIFIED',
      bars: Array.from({ length: Math.min(2400, hours - start) }, (_, i) => [2400, -2200, ((start + i) * 7919 % 1801) - 900]),
    });
  }
  return { version: 1, clips };
}
function config(program) {
  return { controls: { afterGrowth: 'historical', historical: program, stages: [{ durationHours: 24, targetPrice: '10' }] } };
}
let sink = 0;
function sample(fn, sequence, calls) {
  const cpu = process.cpuUsage(), at = process.hrtime.bigint();
  for (let i = 0; i < calls; i++) sink += fn(sequence(i)).open;
  const used = process.cpuUsage(cpu);
  return { wallMs: Number(process.hrtime.bigint() - at) / 1e6, cpuMs: (used.user + used.system) / 1000 };
}
const measurements = [], cold = [];
for (const hours of [2160, 4800]) {
  const mutable = fixture(hours), at = process.hrtime.bigint();
  const frozen = shared.freezeHistoricalMoveProgram(mutable);
  const snapshotMs = Number(process.hrtime.bigint() - at) / 1e6;
  const plainConfig = config(mutable), indexedConfig = config(frozen);
  for (const engine of ['shared', 'runtime']) {
    const reference = engine === 'shared' ? h => shared.historicalReplayHour(mutable, 10, h, 'benchmark')
      : h => runtime.controlledScenarioHour(plainConfig, 'benchmark', h + 24);
    const indexed = engine === 'shared' ? h => shared.historicalReplayHour(frozen, 10, h, 'benchmark')
      : h => runtime.controlledScenarioHour(indexedConfig, 'benchmark', h + 24);
    cold.push({ engine, hours, snapshotMs, firstIndexedCall: sample(indexed, () => hours - 1, 1) });
    assert.deepEqual(indexed(hours - 1), reference(hours - 1));
    for (let i = 0; i < 300; i++) { reference(i % hours); indexed(i % hours); }
    for (const [pattern, sequence] of [['first', () => 0], ['last', () => hours - 1], ['random', i => i * 7919 % hours]]) {
      const before = [], after = [], calls = 2000;
      for (let round = 0; round < 5; round++) {
        // Alternate execution order to reduce warmup/order bias.
        if (round % 2) { after.push(sample(indexed, sequence, calls)); before.push(sample(reference, sequence, calls)); }
        else { before.push(sample(reference, sequence, calls)); after.push(sample(indexed, sequence, calls)); }
      }
      const median = list => list.map(x => x.wallMs).sort((a, b) => a - b)[2];
      measurements.push({ engine, hours, pattern, calls, before, after,
        medianBeforeMs: median(before), medianAfterMs: median(after), speedup: median(before) / median(after) });
    }
  }
}
if (global.gc) global.gc();
const memoryBefore = process.memoryUsage();
for (let i = 0; i < 200; i++) {
  const program = shared.freezeHistoricalMoveProgram(fixture(4800));
  sink += shared.historicalReplayHour(program, i + 1, 4799, 'churn').open;
  sink += runtime.controlledScenarioHour({ controls: { afterGrowth: 'historical', historical: program,
    stages: [{ durationHours: 24, targetPrice: String(i + 1) }] } }, 'churn', 4823).open;
}
if (global.gc) global.gc();
const memoryAfter = process.memoryUsage();
console.log(JSON.stringify({ scope: 'Isolated synthetic fixture. NOT measured on production or Hetzner CX23.',
  node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model,
  reference: 'Uncached mutable program, unchanged pre-index arithmetic', indexed: 'Owned deeply frozen snapshot',
  callsPerSample: 2000, rounds: 5, cold, measurements,
  memory: { gcAvailable: Boolean(global.gc), churnedPrograms: 200, before: memoryBefore, after: memoryAfter,
    heapDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
    arrayBufferDeltaBytes: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
    maxEntriesPerModule: 4, maxOpenArrayBytesPerModule: 4 * (4800 + 1) * 8,
    note: 'Array bound excludes movement snapshots, reference arrays and ordinary tick allocations; heap/RSS are diagnostic, not hard capacity limits.' },
  sink }, null, 2));
