import { open, readFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createState, validate, snapshot } from './engine.mjs';

export async function openStore(path, { now = Date.now, persist: override } = {}) {
  await mkdir(dirname(path), { recursive: true });
  // A second simulator cannot open this ledger, even on a different port.
  const lock = await open(path + '.lock', 'wx');
  await lock.writeFile(String(process.pid));
  let state;
  async function persist(next) {
    if (override) return override(next);
    const tmp = path + '.tmp'; const file = await open(tmp, 'w', 0o600);
    try { await file.writeFile(JSON.stringify(next)); await file.sync(); } finally { await file.close(); }
    await rename(tmp, path);
  }
  try {
    try { state = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; state = createState(now()); await persist(state); }
    validate(state);
  } catch (error) { await lock.close(); await unlink(path + '.lock'); throw error; }
  let tail = Promise.resolve();
  return {
    read: () => snapshot(state, now()),
    transact(fn) {
      const operation = tail.then(async () => {
        const next = structuredClone(state); const result = fn(next, now());
        next.revision++; validate(next); await persist(next); state = next;
        return { result, snapshot: snapshot(state, now()) };
      });
      tail = operation.catch(() => {}); return operation;
    },
    async close() { await tail; await lock.close(); await unlink(path + '.lock'); },
  };
}
