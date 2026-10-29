'use strict';
// Report only: the stored sustained.json of every run under <runsDir> (diagnostic-run-613.cjs --sustained) as
// Markdown. Starts no workload; exits 1 when a run has no findings or recorded a failure.
// Usage: node sustained-report-613.cjs <runsDir>
const fs = require('node:fs'), path = require('node:path');
const f = (x, d = 1) => typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—';
function markdown(runsDir) {
  const lines = ['### Sustained 3-minute load and the private quota (report only, not a p95 verdict)', ''];
  let ok = true;
  for (const name of (fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [])) {
    let s, r; try { s = JSON.parse(fs.readFileSync(path.join(runsDir, name, 'out', 'sustained.json'), 'utf8')); } catch { s = null; }
    try { r = JSON.parse(fs.readFileSync(path.join(runsDir, name, 'out', 'result.json'), 'utf8')); } catch { r = null; }
    if (!s) { ok = false; lines.push(`**${name}**: no findings (${r?.status ?? 'no result'}; ${(r?.failures ?? []).join(', ') || '—'})`, ''); continue; }
    if (s.failures.length || r?.failures?.length) ok = false;
    const q = s.ingress;
    lines.push(`**${name}** (${r?.status ?? '—'}): failures ${[...s.failures, ...(r?.failures ?? [])].join(', ') || 'none'}.`,
      `Private ingress (setup, warm-up and the 3 measured minutes): ${q.requests} requests (${Object.entries(q.routes).map(([k, v]) => k + ' ' + v).join(', ')}), busiest sliding minute **${q.busiestSlidingMinute}** of ${q.quota} (gateway ceiling ${q.gatewayCeiling}), ingress 429 ${q.ingress429}, command rejections (4xx) ${q.commandRejections ?? 0}; per minute ${(q.perWindowMinute ?? []).map(x => (x.minute ? 'm' + x.minute : 'before') + ' ' + x.requests + (x.ingress429 ? ' (429: ' + x.ingress429 + ')' : '')).join(', ') || '—'}.`,
      `Viewer polls: ${s.viewer.polls}, answered ${s.viewer.answered} (${f(s.viewer.answeredShare * 100)} % of those sent, **${f(s.viewer.scheduledShare * 100)} % of the ${s.viewer.polls + (s.viewerPollsDeferred ?? 0)} scheduled**; of these with the quote not live ${Object.entries(s.viewerQuoteNotLive ?? {}).map(([k, v]) => k + ' ' + v).join(', ') || '0'}), refused with 429 ${s.viewer.refused429}, deferred for Retry-After ${s.viewerPollsDeferred ?? 0}, other refusals ${Object.entries(s.viewerOtherRefusals ?? {}).map(([k, v]) => k + ' ' + v).join(', ') || '0'}, connections refused twice in a row ${s.viewerConnectionsRefused ?? 0}${(s.connectionErrors ?? []).length ? ' (first at ' + f(s.connectionErrors[0].at / 1000) + ' s: ' + s.connectionErrors[0].cause + ')' : ''}. Trader requests ${s.trader.requests}: refused with 429 **${s.trader.rateLimited ?? 0}** (${Object.entries(s.trader.rateLimitedOps ?? {}).map(([k, v]) => k + ' ' + v).join(', ') || '—'}; first at ${f((s.trader.firstRateLimitedAtMs ?? NaN) / 1000)} s), cycles skipped while waiting ${s.trader.cyclesSkipped ?? 0}, trader reads with the quote not yet live again ${Object.entries(s.traderQuoteNotLive ?? {}).map(([k, v]) => k + ' ' + v).join(', ') || '0'}, trader steps refused for the quote and sent again ${Object.entries(s.traderQuoteRefusals ?? {}).map(([k, v]) => k + ' ' + v).join(', ') || '0'}; jobs started late (driver stall) ${s.lateJobs ?? 0}. Crypto p95 ${f(s.crypto.baselineP95Ms, 2)} → ${f(s.crypto.mixedP95Ms, 2)} ms over the whole window.`, '',
      '| minute | crypto p95 ms baseline → mixed | viewer polls answered / refused (429) | answered p95 ms | refused p95 ms | trader requests (non-200) |', '|---|---|---|---|---|---|');
    for (const m of s.perMinute.mixed) {
      const b = s.perMinute.baseline.find(x => x.minute === m.minute), non = Object.entries(m.traderStatuses).filter(([k]) => k !== '200').reduce((t, [, v]) => t + v, 0);
      lines.push(`| ${m.minute} | ${f(b?.cryptoP95Ms, 2)} → ${f(m.cryptoP95Ms, 2)} | ${m.viewerAnswered} / ${m.viewerStatuses['429'] ?? 0} | ${f(m.viewerAnsweredP95Ms, 0)} | ${f(m.viewerRefusedP95Ms, 0)} | ${m.traderRequests} (${non}) |`);
    }
    lines.push('');
  }
  return {ok, text: lines.join('\n')};
}
module.exports = {markdown};
if (require.main === module) { const r = markdown(process.argv[2]); console.log(r.text); process.exitCode = r.ok ? 0 : 1; }
