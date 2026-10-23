'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { summarize } = require('./profile-summary.cjs');
test('HTTP phase summary uses matched same-process requests, with no cross-process or percentile subtraction', () => {
  const report = summarize({ schema: 1, role: 'api', elapsedMs: 100, cpuMicroseconds: { user: 2000, system: 1000 },
    events: [
      { request: 1, kind: 'undici:request:create', ms: 0 },
      { request: 1, kind: 'undici:client:sendHeaders', ms: 10, socket: 1 },
      { request: 1, kind: 'undici:request:headers', ms: 30 },
      { request: 1, kind: 'undici:request:trailers', ms: 32 },
      { request: 2, kind: 'undici:client:sendHeaders', ms: 40, socket: 1 },
      { request: 3, kind: 'server.callback', ms: 11 },
      { request: 3, kind: 'server.finish', ms: 29 },
      { request: null, kind: 'server.accept', ms: 1 },
    ] });
  assert.equal(report.processCpuMs, 3); assert.equal(report.requestsPerSendSocket, 2);
  assert.equal(report.phasesMs.createToSend.p95, 10); assert.equal(report.phasesMs.createToSend.count, 1);
  assert.equal(report.phasesMs.sendToHeaders.p95, 20); assert.equal(report.phasesMs.headersToTrailers.p95, 2);
  assert.equal(report.phasesMs.serverCallbackToFinish.p95, 18); assert.equal(report.incomplete, false);
});
test('missing samples and truncated/deadline capture never become a complete capacity result', () => {
  assert.throws(() => summarize({}), /SANITIZED_PROFILE_REQUIRED/);
  const report = summarize({ schema: 1, events: [], reason: 'deadline', profile: {
    nodes: [{ id: 1, frame: { source: 'node:internal/deps/undici/undici' } }], samples: [1, 0], droppedNodes: 1 } });
  assert.equal(report.incomplete, true); assert.equal(report.phasesMs.createToSend.p95, null);
  assert.equal(report.sampleCounts.undici, 1); assert.equal(report.sampleCounts['external-or-unmapped'], 1);
});
