'use strict';
// Explicit, bounded, read-only public probes. No credentials or production endpoints.
// A successful sample is NOT a license/entitlement, SLA, or execution admission.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const DAY = 86400000;
const numeric = value => (typeof value === 'number' || (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))) && Number.isFinite(Number(value));
const targets = [
  ...['XAU', 'XAG', 'XPT', 'XPD'].map(symbol => ({ provider: 'gold-api', symbol, url: `https://api.gold-api.com/price/${symbol}`, kind: 'indicative', maxAge: 15 * 60000 })),
  ...[['WTI', 'DCOILWTICO'], ['Brent', 'DCOILBRENTEU']].map(([symbol, series]) => ({ provider: 'fred-eia', symbol, series,
    url: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&cosd=${new Date(Date.now() - 21 * DAY).toISOString().slice(0, 10)}`, kind: 'daily_reference', maxAge: 10 * DAY })),
];
async function probe(target) {
  const startedAt = Date.now();
  const result = { provider: target.provider, symbol: target.symbol, kind: target.kind, url: target.url, checkedAt: null,
    httpStatus: null, latencyMs: null, schemaValid: false, priceDecimal: null, sourceTimestamp: null, observationDate: null,
    ageMs: null, withinReferenceAgePolicy: false, payloadSha256: null, error: null, executionAdmitted: false };
  try {
    const response = await fetch(target.url, { signal: AbortSignal.timeout(8000), redirect: 'error',
      headers: { Accept: target.series ? 'text/csv' : 'application/json', 'User-Agent': 'VOLTEX-reference-admission-probe/1.0' } });
    result.httpStatus = response.status;
    if (!response.ok) { result.error = `http_${response.status}`; await response.body?.cancel(); return result; }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no_body');
    let size = 0; const chunks = [];
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 256000) { await reader.cancel(); throw new Error('response_too_large'); }
        chunks.push(Buffer.from(part.value));
      }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks).toString('utf8');
    result.payloadSha256 = createHash('sha256').update(text).digest('hex');
    if (target.series) {
      const lines = text.trim().replace(/^\uFEFF/, '').split(/\r?\n/);
      if (!['observation_date', 'DATE'].includes(lines[0]?.split(',')[0]) || lines[0]?.split(',')[1] !== target.series) throw new Error('csv_header');
      let last = null;
      for (const line of lines.slice(1)) {
        const [date, value] = line.split(',');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !numeric(value)) continue;
        const time = Date.parse(`${date}T00:00:00Z`);
        if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) continue;
        if (!last || time > last.time) last = { date, value, time };
      }
      if (!last) throw new Error('no_observation');
      result.priceDecimal = last.value; result.observationDate = last.date;
      result.ageMs = Date.now() - last.time;
      result.withinReferenceAgePolicy = last.date <= new Date().toISOString().slice(0, 10) && result.ageMs <= target.maxAge;
    } else {
      const raw = JSON.parse(text);
      if (raw.symbol !== target.symbol || (raw.currency !== undefined && raw.currency !== 'USD') || !numeric(raw.price)) throw new Error('json_schema');
      if (typeof raw.updatedAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw.updatedAt)) throw new Error('source_time');
      const time = Date.parse(raw.updatedAt); if (!Number.isFinite(time)) throw new Error('source_time');
      result.priceDecimal = String(raw.price); result.sourceTimestamp = time; result.ageMs = Date.now() - time;
      result.withinReferenceAgePolicy = result.ageMs >= -1000 && result.ageMs <= target.maxAge;
    }
    result.schemaValid = true;
  } catch (error) {
    // Never print raw exceptions: future authenticated adapters may include secrets in URLs.
    result.error = error?.name === 'TimeoutError' ? 'timeout' : 'transport_or_schema';
  } finally { result.latencyMs = Date.now() - startedAt; result.checkedAt = new Date().toISOString(); }
  return result;
}
async function main() {
  const samples = [];
  for (const target of targets) { samples.push(await probe(target)); await sleep(1200); }
  const report = { schemaVersion: 1, commit: process.env.GITHUB_SHA || null, completedAt: new Date().toISOString(),
    scope: 'public-network-samples-only', executionAdmitted: false, samples,
    untestedAuthenticatedProviders: ['twelvedata', 'tradermade', 'oanda', 'capital.com', 'eia-direct'],
    limitations: ['Not a Render-region reachability test', 'Not a trading-session soak test', 'Daily oil is not live WTI/Brent',
      'Gold API underlying quote basis and independent backup are not admitted', 'No execution or redistribution rights inferred from HTTP 200'] };
  const output = path.resolve(process.argv[2] || 'docs/qa/cfd-multi-provider/public-probe.json');
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  for (const r of samples) console.log(`${r.provider}/${r.symbol}: http=${r.httpStatus ?? 'unknown'} schema=${r.schemaValid} reference_fresh=${r.withinReferenceAgePolicy} error=${r.error ?? 'none'} execution=false`);
  console.log(`Report: ${output}`);
}
if (require.main === module) main().catch(() => { console.error('Probe harness failed'); process.exitCode = 1; });
