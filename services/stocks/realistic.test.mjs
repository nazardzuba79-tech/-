import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { percentile,runReaders } from './realistic-readers.mjs';
import { combineMetrics } from './realistic-metrics.mjs';
import { startFixture } from './realistic-global-fixture.mjs';

test('capacity report preserves errors and distinguishes amortized shared memory',()=>{
  assert.equal(percentile([1,2,3,4,5],.95),5);assert.equal(percentile([], .5),null);
  const reader={fixture:true,users:5,errors:1,ok:10,latencyMs:{max:100}};
  const server={fixture:true,cpuVcpu:.05,cpuMs:100,maxRssBytes:1000,sqlCalls:10,fixtureProviderHistoryCalls:2,fixtureQuoteCalls:1,initial:{cpuStat:'nr_periods 1\nnr_throttled 1\nthrottled_usec 5'},final:{cpuStat:'nr_periods 5\nnr_throttled 4\nthrottled_usec 20'}};
  const r=combineMetrics(reader,server);assert.equal(r.acceptance.pass,false);assert.equal(r.perReader.cpuVcpu,.01);assert.equal(r.perReader.rssBytesAmortized,200);assert.equal(r.throttling.throttledPeriods,3);
});
test('realistic fixture exercises actual account HTTP and supported chart intervals without external I/O',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'stocks-realistic-test-'));let fixture;
  try{
    fixture=await startFixture({port:0,controlPort:0,path:join(dir,'accounts.sqlite')});
    const result=await runReaders({base:`http://127.0.0.1:${fixture.port}`,users:5,seconds:1,cadenceMs:100,pattern:'shared'});
    assert.equal(result.errors,0,JSON.stringify(result));assert.deepEqual(result.intervals,['15m','1h','1D']);assert.ok(result.byOperation['history-page'].ok>0);
    const metrics=fixture.metrics();assert.equal(metrics.externalApiCalls,0);assert.ok(metrics.sqlCalls>0);assert.ok(metrics.fixtureProviderHistoryCalls>0);
  }finally{await fixture?.close();await rm(dir,{recursive:true,force:true});}
});
