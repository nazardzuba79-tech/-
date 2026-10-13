import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
export function requireEmptyDirectory(path) {
  if (existsSync(path) && readdirSync(path).length) throw Error('DISPOSABLE_DIRECTORY_NOT_EMPTY: ' + path);
}
export function requireImageRevision(actual, expected) {
  if (!/^[a-f0-9]{40}$/.test(expected || '') || actual !== expected) throw Error('MODEL_IMAGE_REVISION_MISMATCH');
}
export async function cleanupWithEvidence(primary, persist, actions) {
  persist(primary); const cleanupErrors = [];
  for (const action of actions) {
    try { await action.run(); }
    catch (error) { cleanupErrors.push({ action: action.name, error: error.stack || String(error) }); }
  }
  const result = cleanupErrors.length ? { ...primary, complete: false, infrastructureFailure: true, cleanupErrors } : primary;
  persist(result); return result;
}
export async function requireFreePorts(ports = [15432, 18092, 18093, 18094]) {
  // Bind-only check: never authenticate/query an existing process or database.
  for (const port of ports) await new Promise((ok, fail) => {
    const probe = createServer(); probe.once('error', e => fail(Error(`MODEL_PORT_NOT_FREE:${port}:${e.code}`)));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(ok));
  });
}
export async function controlJson(url, runId, timeoutMs = 3000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw Error(`MODEL_CONTROL_HTTP_${r.status}`);
  const value = await r.json();
  if (value.runId !== runId) throw Error('MODEL_RUN_ID_MISMATCH');
  return value;
}
