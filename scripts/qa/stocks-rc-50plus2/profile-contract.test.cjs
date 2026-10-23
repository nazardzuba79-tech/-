const test = require('node:test'), assert = require('node:assert/strict');
const { createProfiler, captureValidity, LIMITS } = require('./cpu-http-profile.cjs');
const { alignment, validateClocks } = require('./profile-clock.cjs');
const point = monoMs => ({monoMs,perfMs:monoMs,wallMs:100000+monoMs,originEpochMs:100000});
test('one profiler adopts Work bounded CPU contract and rejects larger duration', () => {
  assert.equal(LIMITS.durationMs,5000); assert.equal(LIMITS.maxNodes,10000);
  assert.equal(LIMITS.maxSamples,12000); assert.equal(LIMITS.maxBytes,4194304);
  assert.throws(()=>createProfiler({enabled:true,role:'api',durationMs:5001}),/PROFILE_BOUND_REQUIRED/);
});
test('drops, overruns, bytes and clock drift invalidate evidence without changing workload criteria', () => {
  const valid = {elapsedMs:5000,clockDriftMs:0,droppedEvents:0};
  assert.equal(captureValidity(valid).valid,true);
  for (const [patch,reason] of [
    [{droppedEvents:1},'DROPPED_DATA'],[{profile:{droppedNodes:1}},'DROPPED_DATA'],
    [{profile:{droppedSamples:1}},'DROPPED_DATA'],[{elapsedMs:5251},'STOP_OVERRUN'],
    [{captureStopElapsedMs:5251},'STOP_OVERRUN'],
    [{clockDriftMs:6},'CLOCK_DRIFT'],[{profileError:'ERROR'},'CPU_PROFILE_ERROR'],
    [{events:['x'.repeat(LIMITS.maxBytes)]},'BYTE_CAP'],
  ]) {
    const result = captureValidity({...valid,...patch});
    assert.equal(result.valid,false); assert.ok(result.reasons.includes(reason));
  }
});
test('Work IPC brackets reject nonfinite clocks, excessive RTT, skew and drift', () => {
  const a = alignment(point(0),point(1),point(2)), b = alignment(point(100),point(101),point(102));
  assert.equal(validateClocks([a],[b]).valid,true);
  assert.equal(alignment(point(0),point(10),point(51)).valid,false);
  assert.equal(alignment(point(0),point(3),point(2)).valid,false);
  assert.equal(alignment(point(0),{...point(1),monoMs:NaN},point(2)).valid,false);
  assert.equal(validateClocks([], [b]).valid,false);
  const shifted = p => ({...p,wallMs:p.wallMs+3,originEpochMs:p.originEpochMs+3});
  assert.equal(validateClocks([a],[alignment(shifted(point(100)),shifted(point(101)),shifted(point(102)))]).valid,false);
});
