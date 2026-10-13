import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./summarize-launch.cjs', import.meta.url));
// Contract: crypto-comparison.cjs and launch-resource-comparison in stocks-review.yml.
const cases = { before: ['A','B','C','D10','D50','D100','E','F'],
  after: ['A','B','C','D10','D50','D100','E','F'], separated: ['A','C','D100','F'] };
const operationCounts = Object.fromEntries(
  ['spotCreate','spotCancel','spotMaker','spotFill','futuresCreate','futuresCancel',
    'futuresMaker','futuresOpen','tpslSet','tpslState','tpslSweep','stateRead'].map(k => [k,80]));
Object.assign(operationCounts, { futuresCloseMaker:40, futuresClose:40,
  protectionLiquidity:40, stopLossTrigger:20, takeProfitTrigger:20 });
const stats = xs => { const a = [...xs].sort((a,b) => a-b); return { n:a.length,
  p50:a[Math.floor(a.length*.5)], p95:a[Math.floor(a.length*.95)],
  p99:a[Math.floor(a.length*.99)], max:a.at(-1) }; };
const concurrency = kind => kind.startsWith('D') ? Number(kind.slice(1)) : kind === 'F' ? 100 : kind === 'E' ? 10 : 0;
function stockReport(kind, repeat) {
  return { scenario:kind, written:kind === 'E' ? 0 : 500, writeBatches:1,
    faultKind:kind === 'E' ? ['429','500','timeout'][repeat] : null, faults:kind === 'E' ? 1 : 0,
    historyReads:10, historyReadMs:1, cacheBytes:100, cacheEntries:1, maxConnections:128,
    elapsedMs:21000, cpuVcpu:.05, rss:100000, eventLoopMaxMs:1, dataBytes:4096,
    droppedConnections:0, cachePending:0,
    initial:{ cpu:'usage_usec 10\n', io:'8:0 \n' }, cpuMax:'5000 100000\n',
    cpuStat:'usage_usec 20\n', ioMax:'8:0 rbps=1048576 wbps=131072\n',
    ioStat:'8:0 rbytes=0 wbytes=4096 rios=0 wios=1\n',
    ioPressure:'some avg10=0 total=0\nfull avg10=0 total=0\n',
    memoryEvents:'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n' };
}
function fixture(t, readerOverride, resultsOverride, comparisonOverride) {
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
    for (let repeat = 0; repeat < 3; repeat++) for (const kind of cases[variant]) {
      const active = concurrency(kind);
      const reader = { concurrency:active, cold:kind === 'F', ok:active ? 10 : 0,
        errors:0, statuses:active ? {200:10} : {}, failures:{}, drained:true };
      const override = readerOverride?.({ variant, kind, repeat, reader });
      if (override !== null) writeFileSync(join(dir, `${kind}-${repeat}-readers.log`),
        typeof override === 'string' ? override : JSON.stringify(override ?? reader));
      // Pooled p95 must use every raw timing, not the average of repeat quantiles.
      const rawTimings = Object.fromEntries(Object.entries(operationCounts).map(([key,n]) =>
        [key,Array.from({length:n},(_,i) => repeat === 0 ? (i%4 === 0 ? 100 : 1) : 10)]));
      const rawScheduling = Array(80).fill(0);
      results.push({kind,repeat,elapsedMs:20000,rawTimings,rawScheduling,
        latency:stats(Object.values(rawTimings).flat()),
        perOperation:Object.fromEntries(Object.entries(rawTimings).map(([key,v]) => [key,stats(v)])),
        scheduling:stats(rawScheduling),eventLoopMaxMs:1,errors:[],
        stock:kind === 'A' ? null : JSON.stringify(stockReport(kind,repeat))});
    }
    const data = {transport:'real service calls; NOT HTTP/E2E',cryptoCpu:'0',loadCpu:'1',
      stockCpu:variant === 'separated' ? '1' : '0',
      stockImage:variant === 'before' ? 'voltex-stock-before' : 'voltex-stock-after',
      diskDevice:'/dev/fixture',limitations:['Isolated test fixture'],
      results:resultsOverride?.(variant,results) ?? results};
    const value = comparisonOverride?.(variant,data) ?? data;
    writeFileSync(join(dir,'comparison.json'),typeof value === 'string' ? value : JSON.stringify(value));
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
  assert.equal(row.calls, 3360);
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
});

const afterD50 = change => (variant,rows) => {
  if (variant === 'after') change(rows.find(r => r.kind === 'D50' && r.repeat === 1));
  return rows;
};
test('completeness: control-only comparison cannot omit entire active case groups',t => {
  const result = fixture(t,undefined,(variant,rows) => variant === 'after' ? rows.filter(r => ['A','B','C'].includes(r.kind)) : rows);
  assert.equal(result.run.status,1); assert.equal(result.summary.variants.after.incomplete,true);
  for (const kind of ['D10','D50','D100','E','F']) {
    assert.equal(result.summary.variants.after.cases[kind].incomplete,true);
    assert.equal(result.console.after[kind].readerErrors,null);
  }
});
test('completeness: separated experiment requires its own A C D100 F set',t => {
  const result = fixture(t,undefined,(variant,rows) => variant === 'separated' ? rows.filter(r => r.kind !== 'F') : rows);
  assert.equal(result.run.status,1); assert.equal(result.summary.variants.separated.cases.F.incomplete,true);
});
for (const [name,change] of [
  ['missing operation',r => { delete r.rawTimings.stopLossTrigger; }],
  ['short operation',r => r.rawTimings.spotCreate.pop()],
  ['duplicated operation samples',r => r.rawTimings.spotCreate.push(1)],
  ['unknown operation',r => { r.rawTimings.other=[1]; }],
  ['nonfinite timing',r => { r.rawTimings.spotCreate[0]=Infinity; }],
  ['negative timing',r => { r.rawTimings.spotCreate[0]=-1; }],
  ['short scheduling',r => r.rawScheduling.pop()],
  ['nonfinite scheduling',r => { r.rawScheduling[0]=NaN; }],
  ['mismatched timing summary',r => { r.latency.n=1; }],
  ['missing crypto failure evidence',r => { delete r.errors; }],
]) test('completeness: '+name+' cannot report complete crypto evidence',t => {
  const result = fixture(t,undefined,afterD50(change));
  assert.equal(result.run.status,1); assert.equal(result.summary.variants.after.cases.D50.incomplete,true);
});
for (const [name,change] of [
  ['absent stock report',r => { r.stock=null; }],
  ['truncated stock report',r => { r.stock='{"scenario":'; }],
  ['empty stock report',r => { r.stock='{}'; }],
  ['wrong stock scenario',r => { const x=JSON.parse(r.stock); x.scenario='D100'; r.stock=JSON.stringify(x); }],
  ['missing stock counter',r => { const x=JSON.parse(r.stock); delete x.droppedConnections; r.stock=JSON.stringify(x); }],
  ['invalid stock metric',r => { const x=JSON.parse(r.stock); x.cpuVcpu=-1; r.stock=JSON.stringify(x); }],
  ['missing stock resource evidence',r => { const x=JSON.parse(r.stock); delete x.cpuMax; r.stock=JSON.stringify(x); }],
]) test('completeness: '+name+' cannot be silently dropped',t => {
  const result = fixture(t,undefined,afterD50(change));
  assert.equal(result.run.status,1); assert.equal(result.summary.variants.after.cases.D50.incomplete,true);
  assert.equal(result.console.after.D50.socketDrops,null);
});
test('completeness: failure injection report must match its repeat',t => {
  const result = fixture(t,undefined,(variant,rows) => {
    if (variant === 'after') { const r=rows.find(r => r.kind === 'E' && r.repeat === 1);
      const x=JSON.parse(r.stock); x.faultKind='429'; r.stock=JSON.stringify(x); }
    return rows;
  });
  assert.equal(result.run.status,1); assert.equal(result.summary.variants.after.cases.E.incomplete,true);
});
for (const [name,change] of [
  ['reader concurrency',r => ({...r,concurrency:10})],
  ['reader cache mode',r => ({...r,cold:true})],
  ['missing status counts',r => ({...r,statuses:undefined})],
  ['inconsistent reader counts',r => ({...r,ok:11})],
  ['missing failure counts',r => ({...r,errors:1})],
  ['invalid status counts',r => ({...r,statuses:{200:-1}})],
  ['zero active attempts',r => ({...r,ok:0,statuses:{}})],
]) test('completeness: '+name+' cannot certify a different or incomplete workload',t => {
  const result = fixture(t,({variant,kind,repeat,reader}) =>
    variant === 'after' && kind === 'D50' && repeat === 1 ? change(reader) : undefined);
  assert.equal(result.run.status,1); assert.equal(result.summary.variants.after.cases.D50.readerErrors,null);
});
for (const [name,change] of [
  ['missing provenance',d => ({results:d.results})],
  ['wrong transport',d => ({...d,transport:'HTTP'})],
  ['wrong variant image',d => ({...d,stockImage:'voltex-stock-before'})],
  ['wrong CPU placement',d => ({...d,stockCpu:'1'})],
  ['malformed comparison JSON',() => '{"results":'],
  ['non-array results',d => ({...d,results:{}})],
]) test('completeness: '+name+' remains incomplete with a retained report',t => {
  const result = fixture(t,undefined,undefined,(variant,data) => variant === 'after' ? change(data) : data);
  assert.equal(result.run.status,1); assert.equal(result.summary.variants.after.incomplete,true);
  assert.equal(result.summary.acceptance,false);
});
