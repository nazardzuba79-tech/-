import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./summarize-launch.cjs', import.meta.url));
function fixture(t, readerOverride, resultsOverride) {
  const prefix = join(tmpdir(), 'stocks-launch-summary-');
  const root = mkdtempSync(prefix);
  t.after(() => {
    assert(resolve(root).startsWith(resolve(prefix)));
    rmSync(root, { recursive: true, force: true });
  });
  for (const variant of ['before', 'after', 'separated']) {
    const dir = join(root, variant);
    mkdirSync(dir);
    const results = [];
    for (let repeat = 0; repeat < 3; repeat++) for (const kind of ['A', 'D50']) {
      const reader = { concurrency: kind === 'A' ? 0 : 50, cold: false, ok: kind === 'A' ? 0 : 10,
        errors: 0, statuses: kind === 'A' ? {} : { 200: 10 }, failures: {}, drained: true };
      const override = readerOverride?.({ variant, kind, repeat, reader });
      if (override !== null) writeFileSync(join(dir, `${kind}-${repeat}-readers.log`),
        typeof override === 'string' ? override : JSON.stringify(override ?? reader));
      // Pooled p95 must use every raw timing, not the average of repeat quantiles.
      const samples = repeat === 0 ? [1, 1, 1, 100] : [10, 10, 10, 10];
      results.push({ kind, repeat, rawTimings: { service: samples }, errors: [],
        stock: kind === 'A' ? null : JSON.stringify({ droppedConnections: 0 }) });
    }
    writeFileSync(join(dir, 'comparison.json'), JSON.stringify({ results: resultsOverride?.(variant, results) ?? results }));
  }
  const run = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  assert.equal(run.signal, null, run.stderr);
  return { run, summary: JSON.parse(readFileSync(join(root, 'summary.json'), 'utf8')),
    console: JSON.parse(run.stdout) };
}

for (const [name, incompleteReader] of [
  ['missing reader log', null],
  ['truncated reader JSON', '{"errors":0'],
  ['undrained reader', { ok: 10, errors: 0, drained: false }],
  ['missing reader error counter', { ok: 10, drained: true }],
]) test(`${name} cannot be reported as zero reader errors`, t => {
  const result = fixture(t, ({ variant, kind, repeat }) =>
    variant === 'after' && kind === 'D50' && repeat === 1 ? incompleteReader : undefined);
  assert.equal(result.run.status, 1, 'incomplete evidence must fail the reporting step');
  assert.equal(result.summary.acceptance, false);
  assert.equal(result.summary.incomplete, true);
  assert.equal(result.summary.variants.after.incomplete, true);
  const row = result.summary.variants.after.cases.D50;
  assert.equal(row.incomplete, true);
  assert.equal(row.readerErrors, null, 'unknown failures are not zero');
  assert.equal(row.readerErrorsKnown, 0);
  assert.deepEqual(row.incompleteReaderRepeats, [1]);
  assert.equal(result.console.after.D50.incomplete, true);
  assert.equal(result.console.after.D50.readerErrors, null);
});

test('complete evidence preserves error counts and pooled percentile without granting acceptance', t => {
  const result = fixture(t, ({ variant, kind, repeat, reader }) =>
    variant === 'after' && kind === 'D50' && repeat === 1
      ? { ...reader, errors: 2, failures: { TimeoutError: 2 } } : undefined);
  assert.equal(result.run.status, 0, result.run.stderr);
  assert.equal(result.summary.acceptance, false);
  assert.equal(result.summary.incomplete, false);
  const row = result.summary.variants.after.cases.D50;
  assert.equal(row.incomplete, false);
  assert.equal(row.readerErrors, 2);
  assert.equal(row.readerErrorsKnown, 2);
  assert.equal(row.calls, 12);
  assert.equal(row.p95, 100);
  assert.equal(row.p95ChangePercent, 0);
  assert.equal(result.console.after.D50.readerErrors, 2);
  assert.equal(result.console.after.A.readerErrors, 0, 'zero-reader controls remain complete');
});

test('an empty zero-reader control log is explicitly not applicable, not lost workload evidence', t => {
  const result = fixture(t, ({ kind }) => kind === 'A' ? '' : undefined);
  assert.equal(result.run.status, 0, result.run.stderr);
  assert.equal(result.summary.incomplete, false);
  assert.equal(result.summary.variants.after.cases.A.readerErrors, 0);
  assert(result.summary.variants.after.cases.A.readers.every(r => r.notApplicable && r.concurrency === 0));
});

for (const [name, change] of [
  ['missing repeat', rows => rows.filter(r => !(r.kind === 'D50' && r.repeat === 2))],
  ['duplicate repeat', rows => rows.map(r => r.kind === 'D50' && r.repeat === 2 ? { ...r, repeat: 1 } : r)],
]) test(`${name} cannot make partial reader evidence complete`, t => {
  const result = fixture(t, undefined, (variant, rows) => variant === 'after' ? change(rows) : rows);
  assert.equal(result.run.status, 1);
  assert.equal(result.summary.incomplete, true);
  assert.equal(result.summary.variants.after.cases.D50.repeatsComplete, false);
  assert.equal(result.console.after.D50.incomplete, true);
  assert.equal(result.console.after.D50.readerErrors, null);
});

test('an empty comparison is incomplete evidence', t => {
  const result = fixture(t, undefined, (variant, rows) => variant === 'after' ? [] : rows);
  assert.equal(result.run.status, 1);
  assert.equal(result.summary.incomplete, true);
  assert.equal(result.summary.variants.after.incomplete, true);
  assert.equal(result.summary.acceptance, false);
  assert.equal(result.console.after.incomplete, true);
});
