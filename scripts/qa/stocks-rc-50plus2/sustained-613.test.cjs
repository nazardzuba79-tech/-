'use strict';
// sustained-613.cjs (#613 R8 sustained load) on synthetic samples and private request logs. No workload.
const test = require('node:test'), assert = require('node:assert/strict');
const s = require('./sustained-613.cjs');

const arm = (samples, extra = {}) => ({durationMs: 180000, samples, cryptoLatencies: samples.filter(x => x.kind === 'crypto').map(x => x.ms), timeouts: 0, unexpectedErrors: 0, missedJobs: 0, orderLoss: 0, doubleSpend: 0, viewerMutations: 0, viewerRateLimitedWithoutRetryAfter: 0, ...extra});
const crypto = n => Array.from({length: n}, (_, i) => ({kind: 'crypto', op: 'open', status: 200, ms: 5 + (i % 20), at: i * 250}));

test('busiest sliding minute counts the densest 60 s, not calendar minutes', () => {
  assert.deepEqual(s.slidingMax([0, 30000, 59999, 60000, 61000]), {count: 4, startsAt: 30000});
  assert.deepEqual(s.slidingMax([]), {count: 0, startsAt: null});
  assert.equal(s.slidingMax(Array.from({length: 241}, (_, i) => i * 249)).count, 241, '241 requests inside one minute');
  assert.equal(s.slidingMax(Array.from({length: 480}, (_, i) => i * 250)).count, 240, 'exactly 4 a second is 240 per sliding minute');
});

test('findings: within quota and only 429 + Retry-After refusals pass; the viewer share is reported, not gated', () => {
  const viewers = [];
  for (let i = 0; i < 300; i++) viewers.push({kind: 'viewer', op: 'state', status: i < 120 ? 200 : 429, ms: i < 120 ? 600 : 3, at: i * 600, retryAfter: i < 120 ? undefined : '2'});
  const rows = Array.from({length: 600}, (_, i) => ({at: 1e12 + i * 300, method: 'POST', route: i % 3 ? 'orders' : 'identities', status: 200}));
  const r = s.summarize({baseline: arm(crypto(720)), mixed: arm([...crypto(720), ...viewers, {kind: 'trader', op: 'state', status: 200, ms: 20, at: 1000}]), privateRows: rows});
  assert.deepEqual(r.failures, []);
  assert.equal(r.ingress.busiestSlidingMinute, 200); assert.deepEqual(r.ingress.routes, {identities: 200, orders: 400});
  assert.equal(r.viewer.answered, 120); assert.equal(r.viewer.refused429, 180); assert.equal(r.viewer.answeredShare, 0.4);
  assert.equal(r.perMinute.mixed.length, 3);
  assert.deepEqual(r.perMinute.mixed[0].viewerStatuses, {200: 100});
  assert.deepEqual(r.perMinute.mixed[1].viewerStatuses, {200: 20, 429: 80});
  assert.equal(r.perMinute.baseline[0].cryptoRequests, 240);
});

test('findings: an ingress over quota or answering 429, a viewer 5xx, missing Retry-After or a broken invariant fail', () => {
  const over = Array.from({length: 241}, (_, i) => ({at: i * 200, route: 'orders', status: 200}));
  assert.ok(s.summarize({baseline: arm(crypto(10)), mixed: arm(crypto(10)), privateRows: over}).failures.includes('INGRESS_OVER_QUOTA'));
  assert.ok(s.summarize({baseline: arm(crypto(10)), mixed: arm(crypto(10)), privateRows: [{at: 0, route: 'orders', status: 429}]}).failures.includes('INGRESS_ANSWERED_429'));
  assert.ok(s.summarize({baseline: arm(crypto(10)), mixed: arm(crypto(10)), privateRows: [{at: 0, route: 'orders', status: null}]}).failures.includes('INGRESS_SERVER_ERRORS_OR_UNFINISHED'));
  assert.ok(s.summarize({baseline: arm(crypto(10)), mixed: arm(crypto(10)), privateRows: [{at: 0, route: 'orders', status: 503}]}).failures.includes('INGRESS_SERVER_ERRORS_OR_UNFINISHED'));
  const rejected = s.summarize({baseline: arm(crypto(10)), mixed: arm(crypto(10)), privateRows: [{at: 0, route: 'command', status: 422}]});
  assert.deepEqual([rejected.failures, rejected.ingress.commandRejections], [[], 1], 'a command rolled back for its quote is its own answer, not an ingress failure');
  const r = s.summarize({baseline: arm(crypto(10)), mixed: arm([...crypto(10), {kind: 'viewer', op: 'state', status: 503, ms: 1, at: 1}], {viewerRateLimitedWithoutRetryAfter: 1, orderLoss: 1}), privateRows: []});
  assert.deepEqual(r.failures, ['MIXED_FINANCIAL_INVARIANT', 'VIEWER_429_WITHOUT_RETRY_AFTER', 'VIEWER_OTHER_STATUS']);
  // A trader request refused by the quota is a finding even when its retry after Retry-After went through.
  const t = s.summarize({baseline: arm(crypto(10)), mixed: arm([...crypto(10), {kind: 'trader', op: 'retry-sell', status: 429, ms: 2, at: 26500, retryAfter: '30'}, {kind: 'trader', op: 'retry-sell', status: 200, ms: 20, at: 56600}], {traderRateLimited: 1, traderCyclesSkipped: 7}), privateRows: []});
  assert.deepEqual(t.failures, ['TRADER_REQUEST_RATE_LIMITED']);
  assert.deepEqual([t.trader.rateLimited, t.trader.cyclesSkipped, t.trader.firstRateLimitedAtMs, t.trader.rateLimitedOps], [1, 7, 26500, {'retry-sell': 1}]);
  assert.ok(s.summarize({baseline: arm(crypto(10)), mixed: arm(crypto(10), {traderRateLimited: 1, traderRateLimitedWithoutRetryAfter: 1}), privateRows: []}).failures.includes('TRADER_429_WITHOUT_RETRY_AFTER'));
  assert.deepEqual(s.summarize({baseline: arm(crypto(10), {timeouts: 1}), mixed: arm(crypto(10)), privateRows: []}).failures, ['BASELINE_ERRORS_OR_TIMEOUTS']);
  // #613 R9: the gateway's explicit 503 SOURCE_BUSY with Retry-After is a told refusal, not a finding; without
  // Retry-After, or any other 503, it still is.
  const busy = extra => s.summarize({baseline: arm(crypto(10)), mixed: arm([...crypto(10), {kind: 'viewer', op: 'state', status: 503, ms: 1, at: 1, ...extra}]), privateRows: []});
  assert.deepEqual([busy({error: 'SOURCE_BUSY', retryAfter: '1'}).failures, busy({error: 'SOURCE_BUSY', retryAfter: '1'}).viewer.refusedBusy], [[], 1]);
  assert.deepEqual(busy({error: 'SOURCE_BUSY', retryAfter: null}).failures, ['VIEWER_OTHER_STATUS']);
  assert.deepEqual(busy({error: 'AUTH_UNAVAILABLE', retryAfter: '1'}).failures, ['VIEWER_OTHER_STATUS']);
});
