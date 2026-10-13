export const finite = value => Number.isFinite(value) && value >= 0;
export function quantiles(values) {
  if (!values.length || values.some(x => !finite(x))) return null;
  const rows = [...values].sort((a, b) => a - b), q = p => rows[Math.min(rows.length - 1, Math.ceil(rows.length * p) - 1)];
  return { n: rows.length, p50: q(.5), p95: q(.95), p99: q(.99), max: rows.at(-1) };
}
export function delta(before, after, key) { return finite(before?.[key]) && finite(after?.[key]) && after[key] >= before[key] ? after[key] - before[key] : null; }
export function summarize(records, expected, before, after) {
  const issues = []; if (!Number.isSafeInteger(expected) || records.length !== expected) issues.push('ATTEMPT_CARDINALITY');
  if (new Set(records.map(x => x.id)).size !== records.length) issues.push('DUPLICATE_ATTEMPT_ID');
  for (const r of records) if (!finite(r.ms) || !['SUCCESS','ERROR','EXPECTED_ABORT'].includes(r.outcome)) issues.push('INCOMPLETE_ATTEMPT');
  const cpuMs = delta(before, after, 'cpuMs'); if (cpuMs === null) issues.push('MISSING_PROCESS_CPU');
  const errors = records.filter(x => x.outcome === 'ERROR'), expectedAborts = records.filter(x => x.outcome === 'EXPECTED_ABORT');
  return { completeness: issues.length ? 'INCOMPLETE' : 'COMPLETE', issues, attempts: records.length, expectedAttempts: expected, errors: issues.length ? null : errors.length, observedErrors: errors.length, expectedAborts: issues.length ? null : expectedAborts.length,
    errorCodes: errors.reduce((m, r) => ({ ...m, [r.code || 'UNKNOWN']: (m[r.code || 'UNKNOWN'] || 0) + 1 }), {}),
    cpuMs, cpuMsPerAttempt: cpuMs === null || !records.length ? null : cpuMs / records.length,
    allAttemptLatencyMs: quantiles(records.map(x => x.ms)), successLatencyMs: quantiles(records.filter(x => x.outcome === 'SUCCESS').map(x => x.ms)),
    capacityAcceptance: 'NOT_EVALUATED_BY_TARGETED_DIAGNOSTIC' };
}

export const SQL_KEYS = ['sqlCalls','sqlReadCalls','sqlWriteCalls','sqlExecCalls','transactionExecCalls','sqlWallMs','sqlCpuMs'];
export const QUEUE_KEYS = ['accepted','dispatched','completed','rejected','timedOut','cancelledReads','cancelledObservations','maxPending','maxBytes','waitMs','maxWaitMs','workMs','logicalWorkMs','registrationGroups','groupedRegistrations','maxRegistrationGroup'];
export function sampleIssues(sample) {
  const issues = [], a = sample?.accounts;
  if (!finite(sample?.cpuMs) || !finite(sample?.memory?.rss) || !finite(sample?.maxRss) || sample.memory.rss === 0) issues.push('PROCESS_METRICS');
  if (!a || a.workerAlive !== 1 || !finite(a.sqlThreadCpuAvailable) || !finite(a.metricsAgeMs) || !finite(a.updatedAt) || !a.updatedAt || !finite(sample?.wallMs)
      || Math.abs(sample.wallMs - a.updatedAt - a.metricsAgeMs) > 1000) issues.push('ACCOUNT_SNAPSHOT_PROVENANCE');
  if (SQL_KEYS.some(k => !finite(a?.[k])) || QUEUE_KEYS.some(k => !finite(a?.queue?.[k]))) issues.push('ACCOUNT_COUNTER_MISSING');
  if (['pending','active','bytes'].some(k => !finite(a?.queue?.[k]))) issues.push('ACCOUNT_QUEUE_MISSING');
  if (['nativeInflight','flights','active','queued','quoteFlights'].some(k => !finite(sample?.live?.[k]))) issues.push('LIVE_COUNTER_MISSING');
  return issues;
}
export function accountDeltas(before, after) {
  const issues = [...sampleIssues(before), ...sampleIssues(after)];
  const sql = Object.fromEntries(SQL_KEYS.map(k => [k, delta(before?.accounts,after?.accounts,k)]));
  const queue = Object.fromEntries(QUEUE_KEYS.map(k => [k,delta(before?.accounts?.queue,after?.accounts?.queue,k)]));
  if (Object.values(sql).includes(null) || Object.values(queue).includes(null)) issues.push('ACCOUNT_COUNTER_DECREASED_OR_ABSENT');
  return { issues, sql, queue, snapshotScope:'last acknowledged worker command; age retained, not a fresh SQL probe' };
}
export function drained(sample) {
  return sampleIssues(sample).length === 0 && ['pending','active','bytes'].every(k => sample.accounts.queue[k] === 0)
    && Object.values(sample.live).every(v => v === 0);
}
export function journalIssues(client, profile) {
  const issues = [], rows = client?.records, dispatches = client?.dispatches;
  if (!Array.isArray(rows) || !Array.isArray(dispatches) || dispatches.length !== rows.length) return ['JOURNAL_CARDINALITY'];
  const seen = new Set();
  for (const d of dispatches) {
    const r = rows.find(r => r.id === d.id);
    if (seen.has(d.id) || !r || !finite(d.atMs) || typeof d.path !== 'string' || d.method !== 'GET' || typeof d.deliberateAbort !== 'boolean') issues.push('JOURNAL_DISPATCH_INVALID');
    if (r?.outcome === 'EXPECTED_ABORT' && (!d.deliberateAbort || profile !== 'history')) issues.push('UNPLANNED_ABORT');
    seen.add(d.id);
  }
  const success = rows.filter(r => r.outcome === 'SUCCESS').length;
  const expected = profile.startsWith('projection') ? success * 3 : profile === 'wallet' ? success * 6 : profile === 'identity' ? success : 40;
  if (!Array.isArray(client.contracts) || client.contracts.length !== expected || client.contracts.some(c => typeof c.name !== 'string' || typeof c.ok !== 'boolean')) issues.push('CONTRACT_COVERAGE');
  if (profile === 'history' && rows.filter(r => r.outcome === 'EXPECTED_ABORT').length !== 15) issues.push('ABORT_COVERAGE');
  if(profile==='identity' && (!Array.isArray(client.timings)||client.timings.length!==3||[5,20,50].some(n=>client.timings.filter(t=>t.users===n).length!==1||dispatches.filter(d=>d.cohort===n).length!==n)))issues.push('IDENTITY_COHORT_COVERAGE');
  return issues;
}
export function traceIssues(trace, sample) {
  if (!Array.isArray(trace)) return ['TRACE_ABSENT'];
  const issues = [], count = kind => trace.filter(e => e.kind === kind).length, t = sample?.transport, l = sample?.logical;
  const fields = { requested:l?.requested, completed:l?.completed, error:l?.failed, 'native-start':t?.starts, 'admission-observed-at-fetch':t?.starts, 'native-completed':t?.completed, 'native-failed':t?.failed, 'native-cancelled':t?.cancelled };
  if (Object.entries(fields).some(([kind,n]) => !finite(n) || count(kind) !== n)) issues.push('TRACE_COUNTER_RECONCILIATION');
  for (let i=0; i<trace.length; i++) {
    const e=trace[i];
    if (e.sequence !== i+1 || !finite(e.atMs) || !Number.isSafeInteger(e.wallMs) || !Object.hasOwn(fields,e.kind) || !['api.bybit.com','api.binance.com'].includes(e.host) || !/^[a-f0-9]{64}$/.test(e.flight || '') || (i && e.atMs<trace[i-1].atMs)) issues.push('TRACE_INVALID');
  }
  if (!finite(t?.inflight) || t.inflight !== 0 || t.starts !== t.completed + t.failed + t.cancelled || l?.requested !== l?.completed + l?.failed) issues.push('TRANSPORT_NOT_RECONCILED');
  return [...new Set(issues)];
}
export function quoteIssues(records, trace) {
  const issues=[];
  for(const row of records.filter(r=>r.outcome==='SUCCESS'))for(const q of row.quoteEvidence||[]){
    if(!Number.isSafeInteger(q.timestamp)||!finite(q.receivedAt)||q.receivedAt<q.timestamp||!['bybit','binance'].includes(q.provider)||q.fxError)issues.push('QUOTE_EVIDENCE_INVALID');
    if(!trace.some(e=>e.kind==='native-start'&&String(e.providerEventId)===String(q.eventId)&&e.providerTimestamp===q.timestamp&&e.symbol===q.instrumentId.split(':')[1]))issues.push('QUOTE_NATIVE_EVENT_NOT_FOUND');
  }
  return [...new Set(issues)];
}
export function preflightGate(row) {
  if(row.preflight&&row.status!=='PASS')throw Error('CHEAP_PREFLIGHT_FAILED_NO_MEASURED_RUNS_STARTED');
}
export function kernelCounters(raw) {
  if (typeof raw !== 'string') return null;
  const values = {};
  for (const line of raw.trim().split('\n')) { const m=/^([a-z_.]+) (\d+)$/.exec(line); if (!m || Object.hasOwn(values,m[1]) || !Number.isSafeInteger(Number(m[2]))) return null; values[m[1]]=Number(m[2]); }
  return values;
}
export function ioCounters(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const devices = {}, totals={rbytes:0,wbytes:0,rios:0,wios:0};
  for (const line of raw.trim().split('\n')) {
    const [device,...tokens]=line.trim().split(/\s+/); if (!/^\d+:\d+$/.test(device) || devices[device]) return null;
    const values={}; for (const token of tokens) { const m=/^([a-z]+)=(\d+)$/.exec(token); if (!m || Object.hasOwn(values,m[1]) || !Number.isSafeInteger(Number(m[2]))) return null; values[m[1]]=Number(m[2]); }
    if (Object.keys(totals).some(k => !finite(values[k]))) return null;
    devices[device]=values; for(const k of Object.keys(totals))totals[k]+=values[k];
  }
  return { devices, totals };
}
