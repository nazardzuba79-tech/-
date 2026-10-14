// Review-only single compact burst; the original matrix and its limits stay immutable.
import assert from 'node:assert/strict';
import { LIMITS, SUBJECTS, SAFETY, sha256 } from '../auth-http-fixture-512/plan.mjs';

export const TRACE_PLAN_ID = 'stocks-auth-burst-trace-512-v1';
export const REQUEST_IDS = Object.freeze(SUBJECTS.map((_, i) => `trace_${String(i + 1).padStart(2, '0')}`));
export const TRACE_COUNTS = Object.freeze({ directAuthority: 52, gatewaySafety: 17, warmup: 50,
  ordinary: 50, bursts: 1, healthMaximum: 40, initiatingMaximum: 209,
  forwardedMaximum: 155, authFetchMaximum: 115, authorityMaximum: 167, allHttpHopsMaximum: 479 });
export const TRACE_BOUNDS = Object.freeze({ initializeMs: 60000, functionalMs: 180000,
  startupMs: 30000, runMs: 300000, totalMs: 600000, cleanupMs: 30000, rpcMs: 15000,
  drainMs: LIMITS.drainMs, deadlineMs: LIMITS.deadlineMs, sampleMs: LIMITS.sampleMs });
export const TRACE_PLAN = Object.freeze({ schema: 1, planId: TRACE_PLAN_ID, variant: 'C',
  counts: TRACE_COUNTS, bounds: TRACE_BOUNDS, resources: LIMITS, requestIds: REQUEST_IDS });
export const tracePlanHash = () => sha256(JSON.stringify(TRACE_PLAN));

export function ordinaryRows() { return SUBJECTS.map((subject, i) => ({ subject, requestId: REQUEST_IDS[i] })); }
export function warmupRow(i) {
  assert.ok(Number.isInteger(i) && i >= 0 && i < SUBJECTS.length);
  return { subject: SUBJECTS[i], requestId: `warmup_${String(i + 1).padStart(2, '0')}` };
}
export function safetyRow(i) {
  assert.ok(Number.isInteger(i) && i >= 0 && i < SAFETY.length);
  const test = SAFETY[i];
  return { subject: test.subject, requestId: `safety_${String(i + 1).padStart(2, '0')}`,
    ...(test.path ? { path: test.path } : {}), ...(test.forged ? { forged: true } : {}) };
}
export function validateTraceFreeze(freeze) {
  assert.ok(freeze && typeof freeze === 'object' && !Array.isArray(freeze));
  assert.deepEqual(Object.keys(freeze).sort(), ['schema', 'planId', 'planSha256', 'sourceSha', 'contextSha256',
    'imageId', 'nodeSha256', 'bcryptSha256', 'seedSha256', 'reviewedPacketSha256', 'device'].sort());
  assert.equal(freeze.schema, 1); assert.equal(freeze.planId, TRACE_PLAN_ID);
  assert.equal(freeze.planSha256, tracePlanHash()); assert.match(freeze.sourceSha, /^[a-f0-9]{40}$/);
  assert.match(freeze.imageId, /^sha256:[a-f0-9]{64}$/); assert.match(freeze.device, /^\d+:\d+$/);
  for (const field of ['contextSha256', 'nodeSha256', 'bcryptSha256', 'seedSha256', 'reviewedPacketSha256']) assert.match(freeze[field], /^[a-f0-9]{64}$/);
  return true;
}
