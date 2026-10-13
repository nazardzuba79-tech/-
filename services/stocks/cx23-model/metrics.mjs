// Disposable model evidence only. No production instrumentation.
import { readFileSync } from 'node:fs';
export const MODEL = Object.freeze({ cpu: 2, memory: 4 * 1024 ** 3, deadlineMs: 3000, repeats: 3 });
export const read = path => { try { return readFileSync(path, 'utf8').trim(); } catch { return null; } };
export function keyValues(text) {
  return Object.fromEntries((text || '').split('\n').filter(Boolean).map(line => {
    const [key, value] = line.trim().split(/\s+/); return [key, Number(value)];
  }));
}
export function verifyBudget(snapshot) {
  const [quota, period] = String(snapshot.cpuMax).split(/\s+/).map(Number);
  const validCounter = value => typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
  const memory = keyValues(snapshot.memoryEvents), cpu = keyValues(snapshot.cpuStat);
  if (!Number.isSafeInteger(quota) || !Number.isSafeInteger(period) || period <= 0 || quota / period !== MODEL.cpu || Number(snapshot.memoryMax) !== MODEL.memory || !validCounter(snapshot.memoryPeak)
    || !['oom', 'oom_kill'].every(k => Number.isSafeInteger(memory[k]) && memory[k] >= 0)
    || !Number.isSafeInteger(cpu.usage_usec) || cpu.usage_usec < 0)
    throw Error('MODEL_BUDGET_NOT_VERIFIED: require cgroup v2 aggregate 2 CPU / 4 GiB and peak/OOM counters');
  return true;
}
export function cgroupSnapshot(root = '/sys/fs/cgroup') {
  return { cpuMax: read(root + '/cpu.max'), memoryMax: read(root + '/memory.max'),
    memoryPeak: read(root + '/memory.peak'), memoryCurrent: read(root + '/memory.current'),
    memoryEvents: read(root + '/memory.events'), cpuStat: read(root + '/cpu.stat'),
    ioStat: read(root + '/io.stat'), ioPressure: read(root + '/io.pressure') };
}
export function quantiles(values) {
  if (!values.length) return { n: 0, p50: null, p95: null, p99: null, max: null };
  const a = [...values].sort((x, y) => x - y), at = q => a[Math.min(a.length - 1, Math.floor(a.length * q))];
  return { n: a.length, p50: at(.5), p95: at(.95), p99: at(.99), max: a.at(-1) };
}
export function summarizeAttempts(records) {
  const success = records.filter(r => r.ok), failures = records.filter(r => !r.ok);
  return { attempts: records.length, successes: success.length, failures: failures.length,
    errorCodes: failures.reduce((a, r) => ((a[r.code] = (a[r.code] || 0) + 1), a), {}),
    successLatencyMs: quantiles(success.map(r => r.ms)), allAttemptLatencyMs: quantiles(records.map(r => r.ms)) };
}
export function compareCrypto(control, loaded, { expectedOperations } = {}) {
  const a = summarizeAttempts(control), b = summarizeAttempts(loaded);
  const pct = a.successLatencyMs.p95 > 0 && b.successLatencyMs.p95 !== null ? 100 * (b.successLatencyMs.p95 / a.successLatencyMs.p95 - 1) : null;
  return { control: a, loaded: b, p95ChangePercent: pct,
    expectedOperations: expectedOperations ?? null,
    originalFivePercentComparison: pct === null || !Number.isSafeInteger(expectedOperations) || expectedOperations <= 0 || a.attempts !== expectedOperations || b.attempts !== expectedOperations || a.failures || b.failures ? 'INCOMPLETE_OR_ERROR' : pct <= 5 ? 'PASS' : 'FAIL',
    note: 'Diagnostic comparison against original +5% criterion; this B HTTP operation workload is not the A service-call acceptance workload.' };
}
