import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createState, snapshot, validate, check } from './engine.mjs';

// The principal comes ONLY from the server's authentication adapter, never a URL/body.
export function accountId(principal) {
  check(typeof principal?.issuer === 'string' && principal.issuer.length > 0 && principal.issuer.length <= 512, 'AUTH_REQUIRED');
  check(typeof principal?.subject === 'string' && /^[A-Za-z0-9_.:@-]{1,128}$/.test(principal.subject), 'AUTH_REQUIRED');
  return createHash('sha256').update(JSON.stringify([principal.issuer, principal.subject])).digest('hex');
}

export function openAccounts(path, { now = Date.now, beforeCommit = () => {} } = {}) {
  check(path?.endsWith('.sqlite'), 'LOCAL_LEDGER_PATH_REQUIRED');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // Only this isolated paper database is opened. No import of the ownerless legacy JSON.
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;');
  db.exec('CREATE TABLE IF NOT EXISTS paper_accounts (id TEXT PRIMARY KEY, ledger TEXT NOT NULL) STRICT');
  const read = db.prepare('SELECT ledger FROM paper_accounts WHERE id=?');
  const insert = db.prepare('INSERT OR IGNORE INTO paper_accounts(id,ledger) VALUES (?,?)');
  const update = db.prepare('UPDATE paper_accounts SET ledger=? WHERE id=?');
  const load = id => { const row = read.get(id); check(row, 'ACCOUNT_NOT_FOUND'); const state = JSON.parse(row.ledger); validate(state); return state; };
  return {
    forPrincipal(principal) {
      const id = accountId(principal);
      insert.run(id, JSON.stringify(createState(now())));
      return {
        id,
        read: () => snapshot(load(id), now()),
        async transact(fn) {
          db.exec('BEGIN IMMEDIATE');
          try {
            const state = load(id), result = fn(state, now());
            check(!result?.then, 'ASYNC_TRANSACTION_FORBIDDEN');
            state.revision++; validate(state);
            update.run(JSON.stringify(state), id); beforeCommit();
            db.exec('COMMIT');
            return { result, snapshot: snapshot(state, now()) };
          } catch (error) { db.exec('ROLLBACK'); throw error; }
        },
      };
    },
    close() { db.close(); },
  };
}
