'use strict';
// #613 R8 sustained load (diagnostic-run-613.cjs --sustained): what the private quota does over whole minutes of the
// original 4 s load. Pure functions over a run's stored samples and the authority's private request log; report only,
// never the p95 verdict. Quota: the release ingress's 240 private requests per minute (unchanged) and the gateway's
// own identity ceiling of Q - Q/16 = 225 for the last minute's private requests.
const QUOTA = 240, GATEWAY_CEILING = 225, MINUTE = 60000;
const percentile = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.ceil(a.length * p) - 1] : null;

// Largest number of timestamps (ms) inside any window of the given length, and where it starts.
function slidingMax(times, windowMs = MINUTE) {
  const t = [...times].sort((x, y) => x - y); let best = 0, at = null;
  for (let i = 0, j = 0; i < t.length; i++) { while (t[i] - t[j] >= windowMs) j++; if (i - j + 1 > best) { best = i - j + 1; at = t[j]; } }
  return {count: best, startsAt: at};
}

// One arm's samples in consecutive whole minutes of its measured window (sample.at is ms from the window's start).
function minutes(result) {
  const out = [], length = Math.ceil((result.durationMs ?? 0) / MINUTE);
  for (let m = 0; m < length; m++) {
    const rows = result.samples.filter(s => s.at >= m * MINUTE && s.at < (m + 1) * MINUTE), of = (kind, op) => rows.filter(s => s.kind === kind && (!op || s.op === op));
    const statuses = list => list.reduce((x, s) => (x[s.status] = (x[s.status] ?? 0) + 1, x), {});
    const viewer = of('viewer', 'state'), crypto = of('crypto');
    out.push({minute: m + 1, cryptoRequests: crypto.length, cryptoP95Ms: percentile(crypto.map(s => s.ms), .95), cryptoStatuses: statuses(crypto),
      viewerPolls: viewer.length, viewerStatuses: statuses(viewer), viewerAnswered: viewer.filter(s => s.status === 200).length,
      viewerAnsweredP95Ms: percentile(viewer.filter(s => s.status === 200).map(s => s.ms), .95), viewerRefusedP95Ms: percentile(viewer.filter(s => s.status === 429).map(s => s.ms), .95),
      traderRequests: of('trader').length, traderStatuses: statuses(of('trader'))});
  }
  return out;
}

// The private ingress over the mixed arm: every request the authority received (epoch ms, route, status), counted per
// sliding minute against the quota and per route; the ingress's own 429s; and the window it covers.
function ingress(rows) {
  const routes = rows.reduce((x, r) => (x[r.route] = (x[r.route] ?? 0) + 1, x), {}), max = slidingMax(rows.map(r => r.at));
  return {requests: rows.length, routes, busiestSlidingMinute: max.count, busiestMinuteStartsAt: max.startsAt === null ? null : new Date(max.startsAt).toISOString(),
    // 4xx other than 429 are the commands' own answers (e.g. 422 QUOTE_STALE, rolled back), not ingress failures.
    ingress429: rows.filter(r => r.status === 429).length, commandRejections: rows.filter(r => r.status !== null && r.status >= 400 && r.status < 500 && r.status !== 429).length,
    serverErrors: rows.filter(r => r.status !== null && r.status >= 500).length,
    unfinished: rows.filter(r => r.status === null).length, quota: QUOTA, gatewayCeiling: GATEWAY_CEILING};
}

// Findings. Gates of this scenario (none of them is the p95 verdict): the ingress never over its quota in any sliding
// minute and never answering 429 itself; no crypto request failing and no trader request refused (a trader's order
// command refused by the quota is a finding even when its retry after Retry-After went through); every 429 carrying a
// numeric Retry-After; the financial invariants of both arms. Reported, not gated: how many viewer polls were answered
// per minute, how many the viewers deferred for a Retry-After, and crypto p95 per minute in both arms.
function summarize({baseline, mixed, privateRows, windowStartedAt = null}) {
  const pm = {baseline: minutes(baseline), mixed: minutes(mixed)}, q = ingress(privateRows ?? []);
  // Private requests per minute of the measured window (minute 0: setup and warm-up before it), and their routes.
  if (Number.isFinite(windowStartedAt)) {
    const by = {};
    for (const r of privateRows ?? []) { const m = r.at < windowStartedAt ? 0 : Math.floor((r.at - windowStartedAt) / MINUTE) + 1; const x = by[m] ??= {minute: m, requests: 0, routes: {}, ingress429: 0}; x.requests++; x.routes[r.route] = (x.routes[r.route] ?? 0) + 1; if (r.status === 429) x.ingress429++; }
    q.perWindowMinute = Object.values(by).sort((a, b) => a.minute - b.minute);
  }
  const viewerPolls = mixed.samples.filter(s => s.kind === 'viewer' && s.op === 'state'), answered = viewerPolls.filter(s => s.status === 200).length, refused = viewerPolls.filter(s => s.status === 429).length;
  const failures = [];
  if (q.busiestSlidingMinute > QUOTA) failures.push('INGRESS_OVER_QUOTA');
  if (q.ingress429) failures.push('INGRESS_ANSWERED_429');
  if (q.serverErrors || q.unfinished) failures.push('INGRESS_SERVER_ERRORS_OR_UNFINISHED');
  for (const [arm, r] of Object.entries({baseline, mixed})) {
    if (r.timeouts || r.unexpectedErrors) failures.push(arm.toUpperCase() + '_ERRORS_OR_TIMEOUTS');
    if (r.orderLoss || r.doubleSpend || r.viewerMutations) failures.push(arm.toUpperCase() + '_FINANCIAL_INVARIANT');
  }
  if (mixed.traderRateLimited) failures.push('TRADER_REQUEST_RATE_LIMITED');
  if (mixed.viewerConnectionsRefused) failures.push('VIEWER_CONNECTIONS_REFUSED');
  if (mixed.viewerRateLimitedWithoutRetryAfter) failures.push('VIEWER_429_WITHOUT_RETRY_AFTER');
  if (mixed.traderRateLimitedWithoutRetryAfter) failures.push('TRADER_429_WITHOUT_RETRY_AFTER');
  if (viewerPolls.some(s => s.status !== 200 && s.status !== 429)) failures.push('VIEWER_OTHER_STATUS');
  return {scope: 'SUSTAINED_REPORT_ONLY_NOT_A_P95_VERDICT', durationMs: mixed.durationMs, failures,
    // answeredShare: of the polls sent; scheduledShare: of every poll the viewers were scheduled to make (deferred ones
    // included), i.e. how much of the agreed viewer load the service actually answered.
    ingress: q, viewer: {polls: viewerPolls.length, answered, refused429: refused, answeredShare: viewerPolls.length ? answered / viewerPolls.length : null,
      scheduledShare: viewerPolls.length + (mixed.viewerPollsDeferred ?? 0) ? answered / (viewerPolls.length + (mixed.viewerPollsDeferred ?? 0)) : null},
    networkRetries: mixed.networkRetries ?? 0, viewerConnectionsRefused: mixed.viewerConnectionsRefused ?? 0, connectionErrors: mixed.connectionErrors ?? [],
    viewerPollsDeferred: mixed.viewerPollsDeferred ?? 0, lateJobs: mixed.lateJobs ?? 0, traderQuoteNotLive: mixed.traderQuoteNotLive ?? {}, viewerQuoteNotLive: mixed.viewerQuoteNotLive ?? {}, traderQuoteRefusals: mixed.traderQuoteRefusals ?? {},
    trader: {requests: mixed.samples.filter(s => s.kind === 'trader').length, nonOk: mixed.samples.filter(s => s.kind === 'trader' && s.status !== 200).length,
      rateLimited: mixed.traderRateLimited ?? 0, cyclesSkipped: mixed.traderCyclesSkipped ?? 0,
      firstRateLimitedAtMs: mixed.samples.find(s => s.kind === 'trader' && s.status === 429)?.at ?? null,
      rateLimitedOps: mixed.samples.filter(s => s.kind === 'trader' && s.status === 429).reduce((x, s) => (x[s.op] = (x[s.op] ?? 0) + 1, x), {})},
    crypto: {baselineP95Ms: percentile(baseline.cryptoLatencies, .95), mixedP95Ms: percentile(mixed.cryptoLatencies, .95)},
    perMinute: pm};
}

module.exports = {QUOTA, GATEWAY_CEILING, slidingMax, minutes, ingress, summarize};
