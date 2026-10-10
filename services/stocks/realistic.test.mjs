import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { percentile,runReaders,safeHttpErrorCode } from './realistic-readers.mjs';
import { combineMetrics } from './realistic-metrics.mjs';
import { startFixture } from './realistic-global-fixture.mjs';

test('capacity report preserves errors and distinguishes amortized shared memory',()=>{
  assert.equal(percentile([1,2,3,4,5],.95),5);assert.equal(percentile([], .5),null);
  const reader={fixture:true,users:5,errors:1,ok:10,latencyMs:{max:100}};
  const server={fixture:true,cpuVcpu:.05,cpuMs:100,maxRssBytes:1000,sqlCalls:10,fixtureProviderHistoryCalls:2,fixtureQuoteCalls:1,initial:{cpuStat:'nr_periods 1\nnr_throttled 1\nthrottled_usec 5'},final:{cpuStat:'nr_periods 5\nnr_throttled 4\nthrottled_usec 20'}};
  const r=combineMetrics(reader,server);assert.equal(r.acceptance.pass,false);assert.equal(r.perReader.cpuVcpu,.01);assert.equal(r.perReader.rssBytesAmortized,200);assert.equal(r.throttling.throttledPeriods,3);
});
test('HTTP diagnostics retain only public error codes and never arbitrary secret-bearing fields',()=>{
  assert.equal(safeHttpErrorCode(Buffer.from(JSON.stringify({error:'SOURCE_BUSY',token:'fixture-sensitive-ignore',details:'do not log'}))),'SOURCE_BUSY');
  assert.equal(safeHttpErrorCode(Buffer.from(JSON.stringify({error:'Bearer fixture-sensitive-ignore'}))),'UNRECORDED');
  assert.equal(safeHttpErrorCode(Buffer.from(JSON.stringify({error:'SUPER_SECRET_UNRECOGNIZED_VALUE'}))),'UNRECORDED');
  assert.equal(safeHttpErrorCode(Buffer.from('{"error":')),'UNRECORDED');
  assert.equal(safeHttpErrorCode(Buffer.alloc(8193)),'UNRECORDED');
});
test('reader preserves exact allowlisted HTTP 422 reason without recording response details',async()=>{
  const server=createServer((_req,res)=>{res.writeHead(422,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'SOURCE_BUSY',details:'fixture-private-body-never-retained'}));});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{const r=await runReaders({base:`http://127.0.0.1:${server.address().port}`,users:5,seconds:1,cadenceMs:100,pattern:'shared'});assert.ok(r.errors>0);assert.equal(r.httpErrorCodes['HTTP_422:SOURCE_BUSY'],r.errors);assert.equal(r.failures.HTTP_422,r.errors);assert.equal(JSON.stringify(r).includes('fixture-private-body-never-retained'),false);}
  finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
});
test('realistic fixture exercises actual account HTTP and supported chart intervals without external I/O',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'stocks-realistic-test-'));let fixture;
  try{
    fixture=await startFixture({port:0,controlPort:0,path:join(dir,'accounts.sqlite')});
    const result=await runReaders({base:`http://127.0.0.1:${fixture.port}`,users:5,seconds:1,cadenceMs:100,pattern:'shared'});
    assert.equal(result.errors,0,JSON.stringify(result));assert.deepEqual(result.intervals,['15m','1h','1D']);assert.ok(result.byOperation['history-page'].ok>0);
    const metrics=fixture.metrics();assert.equal(metrics.externalApiCalls,0);assert.ok(metrics.sqlCalls>0);assert.ok(metrics.fixtureProviderHistoryCalls>0);
    assert.equal(Object.values(metrics.sqlStages).reduce((sum,stage)=>sum+stage.calls,0),metrics.sqlCalls);assert.ok(metrics.sqlStages.read.calls>0);
    assert.equal(metrics.sqlCalls,metrics.sqlReadCalls+metrics.sqlWriteCalls+metrics.sqlExecCalls);
    assert.equal(metrics.accountStorage,'worker');assert.equal(metrics.accountWorkerAlive,1);assert.ok(metrics.accountQueueDelta.completed>0);assert.ok(metrics.accountMetricsAgeMs>=0);
  }finally{await fixture?.close();await rm(dir,{recursive:true,force:true});}
});
test('delayed fixture history exposes bounded SOURCE_BUSY admission with exact code and no external source',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'stocks-realistic-busy-'));let fixture;
  try{
    fixture=await startFixture({port:0,controlPort:0,path:join(dir,'accounts.sqlite'),historyFixtureDelayMs:500});
    const result=await runReaders({base:`http://127.0.0.1:${fixture.port}`,users:20,seconds:1,cadenceMs:100,pattern:'mixed'});
    assert.ok(result.httpErrorCodes['HTTP_503:SOURCE_BUSY']>0,JSON.stringify(result.httpErrorCodes));
    assert.equal(fixture.metrics().externalApiCalls,0);assert.equal(fixture.metrics().historyFixtureDelayMs,500);
  }finally{await fixture?.close();await rm(dir,{recursive:true,force:true});}
});
