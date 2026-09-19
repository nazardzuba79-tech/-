#!/usr/bin/env node
/**
 * Render native engine benchmark JSON files as Markdown tables.
 * Usage: node scripts/bench-native-engine-report.cjs docs/qa/native-engine-bench/before.json docs/qa/native-engine-bench/after.json [...]
 * Reads both the block-D shape (samples per kind) and the F6 shape (samples + phases + calls per kind).
 */
const fs = require('node:fs');
const files = process.argv.slice(2);
if (!files.length) { console.error('usage: bench-native-engine-report.cjs <report.json> [...]'); process.exit(1); }
const reports = files.map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(f, 'utf8')) }));
const kb = (bytes) => (bytes === null || bytes === undefined ? '—' : `${Math.round(bytes / 1024)} KB`);
const ms = (v) => (v === null || v === undefined ? '—' : `${v} ms`);
const trio = (s) => (s ? `${ms(s.p50)} / ${ms(s.p95)} / ${ms(s.max)}` : '—');
const lines = [];
for (const r of reports) {
  const mode = [r.frame ? 'live frame' : 'per-contract quotes', r.db ? 'PostgreSQL' : 'in-memory repository'].join(', ');
  lines.push(`### ${r.label} — ${r.ops} ops, quote latency ${r.quoteLatencyMs} ms, history latency ${r.historyLatencyMs} ms, ${mode} (${r.at})`);
  lines.push('');
  lines.push('| contracts | command | total p50 / p95 / max | engine p50 / p95 | market wait p50 / p95 | repository wait p50 / p95 | serialize p50 | quotes / frame reads / history (p50) | repo calls (p50) | response p95 | payload per commit | fills (OPEN filled/partial/rejected) |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of r.scenarios) {
    if (s.refused) { lines.push(`| ${s.contracts} | — | refused after ${s.opened} contracts (${s.refused}) | | | | | | | | | |`); continue; }
    const kinds = Object.keys(s.samples);
    for (const kind of kinds) {
      const t = s.samples[kind], ph = s.phases?.[kind], c = s.calls?.[kind], st = kind === 'OPEN' ? s.statuses?.OPEN : null;
      const callsCell = c ? `${c.quote?.p50 ?? '—'} / ${c.marks?.p50 ?? '—'} / ${c.history?.p50 ?? '—'}` : '—';
      lines.push(`| ${s.contracts} | ${kind} | ${trio(t)} | ${ph ? `${ms(ph.engine.p50)} / ${ms(ph.engine.p95)}` : '—'} | ${ph ? `${ms(ph.market.p50)} / ${ms(ph.market.p95)}` : '—'} | ${ph ? `${ms(ph.repository.p50)} / ${ms(ph.repository.p95)}` : '—'} | ${ph ? ms(ph.serialize.p50) : '—'} | ${callsCell} | ${c?.repository?.p50 ?? '—'} | ${kb(s.response?.p95)} | ${kb(s.payload?.bytesLast)} | ${st ? `${st.filled} / ${st.partial} / ${st.rejected}` : ''} |`);
    }
  }
  lines.push('');
}
process.stdout.write(lines.join('\n') + '\n');
