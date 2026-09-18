#!/usr/bin/env node
/**
 * Render the native engine benchmark JSON files as a Markdown comparison.
 * Usage: node scripts/bench-native-engine-report.cjs docs/qa/native-engine-bench/before.json docs/qa/native-engine-bench/after.json [...]
 */
const fs = require('node:fs');
const files = process.argv.slice(2);
if (!files.length) { console.error('usage: bench-native-engine-report.cjs <report.json> [...]'); process.exit(1); }
const reports = files.map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(f, 'utf8')) }));
const kb = (bytes) => (bytes === null || bytes === undefined ? '—' : `${Math.round(bytes / 1024)} KB`);
const ms = (v) => (v === null || v === undefined ? '—' : `${v} ms`);
const lines = [];
for (const r of reports) {
  lines.push(`### ${r.label} — ${r.ops} ops, quote latency ${r.quoteLatencyMs} ms, history latency ${r.historyLatencyMs} ms (${r.at})`);
  lines.push('');
  lines.push('| contracts | OPEN p50 / p95 / p99 | CLOSE p50 / p95 / p99 | REFRESH p50 / p95 | quotes per OPEN (p50 / max) | history per OPEN (max) | payload per commit | response p95 | journal | filled / partial / rejected (OPEN) | loop p99 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of r.scenarios) {
    if (s.refused) { lines.push(`| ${s.contracts} | refused after ${s.opened} contracts (${s.refused}) | | | | | | | | | |`); continue; }
    const o = s.samples.OPEN, c = s.samples.CLOSE, f = s.samples.REFRESH, st = s.statuses?.OPEN ?? {};
    lines.push(`| ${s.contracts} | ${ms(o.p50)} / ${ms(o.p95)} / ${ms(o.p99)} | ${ms(c.p50)} / ${ms(c.p95)} / ${ms(c.p99)} | ${ms(f.p50)} / ${ms(f.p95)} | ${s.calls.OPEN.quote.p50} / ${s.calls.OPEN.quote.max} | ${s.calls.OPEN.history.max} | ${kb(s.payload.bytesLast)} | ${kb(s.response.p95)} | ${s.journal} | ${st.filled ?? '—'} / ${st.partial ?? '—'} / ${st.rejected ?? '—'} | ${ms(s.loop?.p99ms)} |`);
  }
  lines.push('');
}
process.stdout.write(lines.join('\n') + '\n');
