import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from './testing/quota-sim.mjs';

// #613 R9: the private quota over whole minutes, in simulated time (testing/quota-sim.mjs: the real authority adapter
// against a model of the private ingress, 240 requests per fixed 60 s window, and the 50+2 Stocks jobs). Before R9
// the same model reproduced the CI sustained run (40883105775): the ingress refused 6 trader commands, the traders ran
// 469 commands and skipped 23 cycles, 55.6 % of the viewer polls were answered, a viewer was told to wait up to 26 s
// (Retry-After) or went 28 s without an answer, and one got AUTH_UNAVAILABLE. These cases pin what the gateway now
// guarantees with the quota unchanged; none of them is reached by the old adapter.

test('the original 50+2 load for three minutes: the ingress refuses nothing, traders keep priority, viewers are told when to come back', async () => {
  const r = await simulate({ durationMs: 180000 });
  assert.equal(r.ingress429, 0, 'the gateway never sends a request the ingress window cannot take');
  // A command the window cannot take is refused before it is sent (429 with Retry-After) and sent again. Once the
  // trading is sustained (a minute without a 30 s pause) its commands keep their room until the window ends and every
  // cycle runs; before that (a burst: a page load, the 20 s acceptance window) nothing changes for the viewers.
  assert.deepEqual(Object.keys(r.traderOutcomes).filter(k => !['ok', 'AUTH_RATE_LIMIT'].includes(k)), [], 'no unknown outcome');
  assert.ok(r.traderCommands >= 0.85 * 2 * 45 * 7, 'trader commands executed ' + r.traderCommands);
  assert.equal(r.perMinute.at(-1).commands, 2 * 15 * 7, 'the last minute runs every trader command');
  // Viewers: answered, or refused with 429 and Retry-After; never AUTH_UNAVAILABLE or a silent wait.
  assert.deepEqual(Object.keys(r.viewerOutcomes).sort(), ['AUTH_RATE_LIMIT', 'answered', 'deferred']);
  assert.equal(r.viewer429WithoutRetryAfter, 0);
  assert.ok(r.viewerRetryAfterMaxMs <= 25000, 'Retry-After ' + r.viewerRetryAfterMaxMs);
  assert.ok(r.viewerMaxGapMs <= 30000, 'longest time a viewer went without an answer ' + r.viewerMaxGapMs);
  assert.ok(r.viewerAnsweredShare >= 0.6, 'viewer polls answered ' + r.viewerAnsweredShare);
  assert.ok(r.maxConcurrentViewerReads < 128, 'concurrent viewer reads ' + r.maxConcurrentViewerReads);
});

test('a viewer and a trader signed out during the load: refused at once, everyone else unaffected, the quota still holds', async () => {
  const r = await simulate({ durationMs: 180000, revokeAt: 60000 });
  assert.equal(r.ingress429, 0);
  assert.ok(r.viewerOutcomesByViewer0.AUTH_REQUIRED >= 1, 'the signed-out viewer is refused');
  assert.equal(r.viewerOutcomes.AUTH_REQUIRED, r.viewerOutcomesByViewer0.AUTH_REQUIRED, 'no other viewer is refused AUTH_REQUIRED');
  assert.ok(r.traderOutcomes.AUTH_REQUIRED >= 1, 'the signed-out trader is refused');
  assert.deepEqual(Object.keys(r.traderOutcomes).filter(k => !['ok', 'AUTH_RATE_LIMIT', 'AUTH_REQUIRED'].includes(k)), []);
  assert.ok(r.viewerMaxGapMsExceptRevoked <= 30000, 'longest gap of the other viewers ' + r.viewerMaxGapMsExceptRevoked);
  assert.equal(r.viewerOutcomes.AUTH_UNAVAILABLE, undefined);
});

test('over the quota (the traders every 2 s): the gateway refuses the excess itself with Retry-After; the ingress refuses nothing', async () => {
  const r = await simulate({ durationMs: 180000, traderCycleMs: 2000 });
  assert.equal(r.ingress429, 0, 'nothing reaches the ingress beyond its window');
  assert.ok(r.traderOutcomes.AUTH_RATE_LIMIT >= 1, 'the traders\' excess is refused');
  assert.deepEqual(Object.keys(r.traderOutcomes).filter(k => !['ok', 'AUTH_RATE_LIMIT'].includes(k)), [], 'no outcome is unknown');
  assert.equal(r.viewerOutcomes.AUTH_UNAVAILABLE, undefined, 'viewers are refused with 429, not left to time out');
  assert.equal(r.viewer429WithoutRetryAfter, 0);
  // Fairness under the traders' priority: while a window has room, viewers get a batch at least every 4 s.
  assert.ok(r.viewerOutcomes.answered > 0 && r.viewerMaxGapMs <= 60000, 'longest gap ' + r.viewerMaxGapMs);
});
