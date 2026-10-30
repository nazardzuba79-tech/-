'use strict';
// #613 R10 PUSH_DIAGNOSTIC, report only (the collection gate and the p95 numbers are summarize-613.cjs --push's): what
// the viewers' streams (push-viewers.cjs) delivered and what they cost, per run and over all runs, from the stored
// results. Per run: crypto p50/p95/p99 of both arms; streams opened, quotes delivered against one a second per stream
// over the measured window (uptime), quota waits, unavailable, revoked, discarded, stale viewers, quote age and delivery
// delay p95; the gateway's own counters (connections: peak, shed with 503, dropped silently; stream deliveries); CPU per
// process and PostgreSQL, server CPU-set utilisation, memory; the private requests the authority served inside the
// measured window (identity batches; every other route is an account command), its 429s, and the busiest sliding minute
// of the whole log against 240; the financial invariants.
// Usage: node push-report-613.cjs <runsDir> [out.json]
const fs = require('node:fs'), path = require('node:path');
const {percentile} = require('./policy.cjs');
const {PLAN} = require('./driver.cjs');

const QUOTA = 240;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const busiestMinute = at => { const s = [...at].sort((x, y) => x - y); let best = 0; for (let i = 0, j = 0; j < s.length; j++) { while (s[j] - s[i] >= 60000) i++; best = Math.max(best, j - i + 1); } return best; };
const cpuMs = (b, a) => finite(b?.cpu?.user) && finite(a?.cpu?.user) ? (a.cpu.user + a.cpu.system - b.cpu.user - b.cpu.system) / 1000 : null;

function privateRequests(rows, startedAt, finishedAt) {
  if (!Array.isArray(rows)) return null;
  const from = Date.parse(startedAt), to = Date.parse(finishedAt), inWindow = rows.filter(r => r.at >= from && r.at <= to);
  const byRoute = {}; for (const r of inWindow) { const k = r.route + ' ' + r.status; byRoute[k] = (byRoute[k] ?? 0) + 1; }
  return {window: inWindow.length, byRoute, identities: inWindow.filter(r => r.route === 'identities').length, commands: inWindow.filter(r => r.route !== 'identities').length,
    status429: rows.filter(r => r.status === 429).length, busiestMinute: busiestMinute(rows.map(r => r.at)), quota: QUOTA};
}

function arm(out, name) {
  const r = read(path.join(out, name + '-result.json'));
  if (!r) return null;
  const b = r.metrics?.before?.processes ?? {}, a = r.metrics?.after?.processes ?? {}, gateway = a.stocksGateway ?? {}, p = r.push;
  const seconds = PLAN.measureMs / 1000;
  return {
    cryptoP50: percentile(r.cryptoLatencies ?? [], .5), cryptoP95: percentile(r.cryptoLatencies ?? [], .95), cryptoP99: percentile(r.cryptoLatencies ?? [], .99),
    cpuMs: {api: cpuMs(b.api, a.api), authority: cpuMs(b.stocksAuthority, a.stocksAuthority), gateway: cpuMs(b.stocksGateway, a.stocksGateway),
      postgres: finite(r.metrics?.host?.after?.postgres?.cpuMs) && finite(r.metrics?.host?.before?.postgres?.cpuMs) ? r.metrics.host.after.postgres.cpuMs - r.metrics.host.before.postgres.cpuMs : null},
    serverUtilization: r.isolation?.usage?.server?.utilization ?? null,
    memoryMb: Object.fromEntries(Object.entries(r.isolation?.memory ?? {}).map(([k, v]) => [k, finite(v?.hwmKb) ? v.hwmKb / 1024 : finite(v?.pssKb) ? v.pssKb / 1024 : null])),
    gatewayConnections: gateway.connections ?? null, gatewayStreams: gateway.streams ?? null,
    viewerDenials: r.viewerDenials, orderLoss: r.orderLoss, doubleSpend: r.doubleSpend, viewerMutations: r.viewerMutations, timeouts: r.timeouts, unexpectedErrors: r.unexpectedErrors,
    traderP95: percentile((r.samples ?? []).filter(s => s.kind === 'trader').map(s => s.ms), .95),
    push: p ? {opened: p.opened, quotes: p.quotes, expectedQuotes: finite(p.opened) ? p.opened * seconds : null, uptime: p.opened ? p.quotes / (p.opened * seconds) : null,
      waits: p.waits, unavailable: p.unavailable, revoked: p.revoked, discarded: p.discarded, staleViewers: p.staleViewers,
      quoteAgeP95Ms: p.quoteAgeP95Ms, deliveryDelayP95Ms: p.deliveryDelayP95Ms, errors: p.errors?.length ?? null} : null,
    privateRequests: privateRequests(read(path.join(out, name + '-private-requests.json')), r.startedAt, r.finishedAt),
  };
}

function report(runsDir) {
  const runs = [];
  for (const name of (fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : []).filter(n => /^push-\d+$/.test(n))) {
    const out = path.join(runsDir, name, 'out'), result = read(path.join(out, 'result.json'));
    runs.push({name, runtime: result?.runtimeSourceSha ?? null, workload: result?.workload ?? null, status: result?.status ?? 'NO_RESULT', baseline: arm(out, 'baseline'), mixed: arm(out, 'mixed')});
  }
  const done = runs.filter(r => r.mixed?.push), sum = f => done.reduce((s, r) => s + (f(r) ?? 0), 0), meanOf = f => { const v = done.map(f).filter(finite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const max = f => Math.max(0, ...done.map(f).filter(finite));
  const total = {runs: done.length, opened: sum(r => r.mixed.push.opened), quotes: sum(r => r.mixed.push.quotes), expectedQuotes: sum(r => r.mixed.push.expectedQuotes),
    waits: sum(r => r.mixed.push.waits), unavailable: sum(r => r.mixed.push.unavailable), revoked: sum(r => r.mixed.push.revoked), staleViewers: sum(r => r.mixed.push.staleViewers),
    errors: sum(r => r.mixed.push.errors), quoteAgeP95MsMax: max(r => r.mixed.push.quoteAgeP95Ms), deliveryDelayP95MsMax: max(r => r.mixed.push.deliveryDelayP95Ms),
    meanCpuMs: Object.fromEntries(['baseline', 'mixed'].map(a => [a, Object.fromEntries(['api', 'authority', 'gateway', 'postgres'].map(k => [k, meanOf(r => r[a]?.cpuMs?.[k])]))])),
    meanServerUtilization: {baseline: meanOf(r => r.baseline?.serverUtilization), mixed: meanOf(r => r.mixed.serverUtilization)},
    maxMemoryMb: Object.fromEntries(['api', 'stocksAuthority', 'stocksGateway', 'postgres'].map(k => [k, max(r => r.mixed.memoryMb?.[k])])),
    meanIdentitiesInWindow: meanOf(r => r.mixed.privateRequests?.identities), meanCommandsInWindow: meanOf(r => r.mixed.privateRequests?.commands),
    busiestMinuteMax: max(r => r.mixed.privateRequests?.busiestMinute), private429: sum(r => r.mixed.privateRequests?.status429),
    gatewayPeakConnectionsMax: max(r => r.mixed.gatewayConnections?.peak), gatewayShed: sum(r => r.mixed.gatewayConnections?.shed), gatewayDropped: sum(r => r.mixed.gatewayConnections?.dropped),
    viewerDenials: sum(r => r.mixed.viewerDenials), financial: {orderLoss: sum(r => r.mixed.orderLoss), doubleSpend: sum(r => r.mixed.doubleSpend), viewerMutations: sum(r => r.mixed.viewerMutations)}};
  total.uptime = total.expectedQuotes ? total.quotes / total.expectedQuotes : null;
  return {scope: 'PUSH_DIAGNOSTIC_REPORT_ONLY', acceptance: false, runs, total};
}

function markdown({runs, total}) {
  const f = (x, d = 1) => finite(x) ? x.toFixed(d) : '—';
  const lines = ['PUSH_DIAGNOSTIC streams and costs (report only):', '',
    '| run | runtime | crypto p50/p95/p99 ms baseline → mixed | streams | quotes / expected (uptime) | waits / unavailable / revoked / stale | quote age p95 ms | delivery p95 ms | identity batches / commands in window | busiest minute (/240) | gateway conn peak / shed / dropped | CPU ms mixed: API / authority / gateway / PG | server busy % base → mixed |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of runs) {
    const b = r.baseline, m = r.mixed, p = m?.push, q = m?.privateRequests, c = m?.gatewayConnections;
    lines.push(`| ${r.name} | ${(r.runtime ?? '').slice(0, 8)} | ${f(b?.cryptoP50, 2)}/${f(b?.cryptoP95, 2)}/${f(b?.cryptoP99, 2)} → ${f(m?.cryptoP50, 2)}/${f(m?.cryptoP95, 2)}/${f(m?.cryptoP99, 2)} | ${p?.opened ?? '—'} | ${p ? `${p.quotes} / ${p.expectedQuotes} (${f(p.uptime * 100)} %)` : '—'} | ${p ? [p.waits, p.unavailable, p.revoked, p.staleViewers].join(' / ') : '—'} | ${f(p?.quoteAgeP95Ms, 0)} | ${f(p?.deliveryDelayP95Ms, 0)} | ${q ? `${q.identities} / ${q.commands}` : '—'} | ${q?.busiestMinute ?? '—'} | ${c ? `${c.peak} / ${c.shed} / ${c.dropped}` : '—'} | ${['api', 'authority', 'gateway', 'postgres'].map(k => f(m?.cpuMs?.[k], 0)).join(' / ')} | ${f(b?.serverUtilization * 100)} → ${f(m?.serverUtilization * 100)} |`);
  }
  lines.push('', `Total: ${total.runs} runs, ${total.opened} streams, ${total.quotes} of ${total.expectedQuotes} quotes (uptime ${f(total.uptime * 100, 2)} %), quota waits ${total.waits}, unavailable ${total.unavailable}, revoked ${total.revoked}, stale viewers ${total.staleViewers}, stream errors ${total.errors}; quote age p95 max ${f(total.quoteAgeP95MsMax, 0)} ms, delivery p95 max ${f(total.deliveryDelayP95MsMax, 0)} ms; private 429: ${total.private429}; busiest minute ${total.busiestMinuteMax}/240; gateway connections peak ${total.gatewayPeakConnectionsMax}, shed ${total.gatewayShed}, dropped ${total.gatewayDropped}; viewer orders refused ${total.viewerDenials}; order loss / double spend / viewer mutations ${total.financial.orderLoss} / ${total.financial.doubleSpend} / ${total.financial.viewerMutations}.`);
  lines.push(`Mean CPU per 20 s window, baseline → mixed: ${['api', 'authority', 'gateway', 'postgres'].map(k => `${k} ${f(total.meanCpuMs.baseline[k], 0)} → ${f(total.meanCpuMs.mixed[k], 0)} ms`).join(', ')}; server CPU set busy ${f(total.meanServerUtilization.baseline * 100)} → ${f(total.meanServerUtilization.mixed * 100)} %; max memory MB ${Object.entries(total.maxMemoryMb).map(([k, v]) => `${k} ${f(v, 0)}`).join(', ')}; identity batches ${f(total.meanIdentitiesInWindow)} and commands ${f(total.meanCommandsInWindow)} per window.`);
  return lines.join('\n');
}

module.exports = {report, markdown, privateRequests, busiestMinute};

if (require.main === module) {
  const [runsDir, jsonOut] = process.argv.slice(2), r = report(runsDir);
  console.log(markdown(r));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(r, null, 2));
}
