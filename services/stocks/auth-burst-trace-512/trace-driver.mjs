// This wrapper reuses the unchanged HTTP implementation and sampler. No import-time I/O.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriver } from '../auth-http-fixture-512/probe.mjs';
import { servePrivateStdio } from '../auth-http-fixture-512/plan.mjs';
import { TRACE_COUNTS, ordinaryRows, safetyRow, warmupRow } from './trace-plan.mjs';

export async function createTraceDriver({ createInner = createDriver } = {}) {
  const inner = await createInner();
  let initialized = false, stopped = false, busy = false, phase = '', health = 0,
    safety = 0, warmup = 0, ordinary = 0, healthPassed = false;
  const counts = () => ({ health, safety, warmup, ordinary });
  async function command(op, input = {}) {
    assert.ok(!busy && !stopped, 'TRACE_DRIVER_NOT_IDLE');
    if (op === 'init') { assert.ok(!initialized); initialized = true; }
    else {
      assert.ok(initialized, 'TRACE_DRIVER_NOT_INITIALIZED');
      if (op === 'phase') {
        const allowed = phase === '' ? 'startup' : phase === 'startup' && healthPassed ? 'gateway-safety' :
          phase === 'gateway-safety' && safety === TRACE_COUNTS.gatewaySafety ? 'warmup' :
          phase === 'warmup' && warmup === TRACE_COUNTS.warmup ? 'ordinary' :
          phase === 'ordinary' && ordinary === TRACE_COUNTS.ordinary ? 'tail-drain' : null;
        assert.equal(input.name, allowed, 'TRACE_PHASE_ORDER'); phase = input.name;
      } else if (op === 'health') {
        assert.equal(phase, 'startup'); assert.ok(!healthPassed && health < TRACE_COUNTS.healthMaximum); health++;
      } else if (op === 'requests') {
        assert.deepEqual(Object.keys(input).sort(), ['class', 'rows']);
        if (input.class === 'gatewaySafety') {
          assert.equal(phase, 'gateway-safety'); assert.ok(safety < TRACE_COUNTS.gatewaySafety);
          assert.deepEqual(input.rows, [safetyRow(safety)]); safety++;
        } else if (input.class === 'warmup') {
          assert.equal(phase, 'warmup'); assert.ok(warmup < TRACE_COUNTS.warmup);
          assert.deepEqual(input.rows, [warmupRow(warmup)]); warmup++;
        } else {
          assert.equal(input.class, 'ordinary', 'TRACE_CLASS_FORBIDDEN'); assert.equal(phase, 'ordinary');
          assert.equal(ordinary, 0, 'TRACE_SECOND_BURST_FORBIDDEN'); assert.deepEqual(input.rows, ordinaryRows());
          ordinary = TRACE_COUNTS.ordinary;
        }
      } else assert.ok(['audit', 'stop'].includes(op), 'TRACE_COMMAND_FORBIDDEN');
    }
    busy = true;
    try {
      const result = await inner.command(op, input);
      if (op === 'phase') return { ...result, completedMonoNs: process.hrtime.bigint().toString() };
      if (op === 'health' && result.outcome === 'HTTP' && result.status === 200) healthPassed = true;
      if (op === 'stop') { stopped = true; return { ...result, traceCounts: counts() }; }
      return result;
    } finally { busy = false; }
  }
  return { command };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const driver = await createTraceDriver(); servePrivateStdio(driver.command);
}
