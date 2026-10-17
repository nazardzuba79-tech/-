// CONTRACT FIXTURE ONLY. No CLI/server imports this module. Its in-process
// synthetic session authority is not a replacement for VOLTEX authentication.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { accountId } from '../accounts.mjs';
import { executeAccountCommand } from '../account-commands.mjs';
import { check, SimError, units, decimal, validate, snapshot } from '../engine.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  check(value === null || ['string', 'number', 'boolean'].includes(typeof value), 'AUTHORITY_INTENT_INVALID');
  check(typeof value !== 'number' || Number.isSafeInteger(value), 'AUTHORITY_INTENT_INVALID');
  return value;
}
// Exact representability only: never silently round Decimal(36,18) cash.
export function exactEight(value) {
  check(typeof value === 'string' && /^(0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value), 'CASH_PRECISION_UNSUPPORTED');
  const [whole, fraction = ''] = value.split('.');
  check(!/[1-9]/.test(fraction.slice(8)), 'CASH_PRECISION_UNSUPPORTED');
  return decimal(units(whole + '.' + fraction.slice(0, 8).padEnd(8, '0')));
}

export function openSyntheticCashAuthority(path, { now = Date.now, beforeCommit = () => {}, afterCommit = () => {} } = {}) {
  check(path.endsWith('.sqlite'), 'FIXTURE_DATABASE_REQUIRED');
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;
    CREATE TABLE IF NOT EXISTS fixture_cash(id TEXT PRIMARY KEY, available TEXT NOT NULL, locked TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS fixture_stocks(principal TEXT PRIMARY KEY, cash_id TEXT NOT NULL UNIQUE, ledger TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS fixture_receipts(principal TEXT NOT NULL, intent_id TEXT NOT NULL, digest TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(principal,intent_id)) STRICT;
    CREATE TABLE IF NOT EXISTS fixture_audit(principal TEXT NOT NULL, intent_id TEXT NOT NULL, cash_id TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(principal,intent_id)) STRICT;`);
  const sessions = new Map(), permits = new WeakMap();
  const binding = principal => { const row = db.prepare('SELECT * FROM fixture_stocks WHERE principal=?').get(accountId(principal)); check(row, 'ACCOUNT_NOT_BOUND'); return row; };
  const cash = id => { const row = db.prepare('SELECT * FROM fixture_cash WHERE id=?').get(id); check(row, 'ACCOUNT_NOT_BOUND'); return row; };
  const decode = (row, money) => {
    const state = JSON.parse(row.ledger);
    // Cash is a projection of the ONE authority row, never a second balance.
    state.wallets.USDT.cash = decimal(units(money.available) + units(state.wallets.USDT.reserved));
    check(units(money.locked) >= units(state.wallets.USDT.reserved), 'AUTHORITY_RESERVE_MISMATCH');
    validate(state); return state;
  };
  const encode = state => { const stored = structuredClone(state); delete stored.wallets.USDT.cash; return JSON.stringify(stored); };
  const owns = permit => { const session = sessions.get(permit.session); check(session?.valid && session.canTrade && session.principal === permit.principal, 'AUTH_REQUIRED'); check(now() < session.expiresAt, 'AUTH_REQUIRED'); };
  const transaction = work => { db.exec('BEGIN IMMEDIATE'); try { const result = work(); check(!result?.then, 'ASYNC_TRANSACTION_FORBIDDEN'); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const validateCommand = command => {
    check(command && typeof command === 'object' && !Array.isArray(command), 'AUTHORITY_INTENT_INVALID');
    check(Object.keys(command).every(key => ['intentId', 'expectedRevision', 'type', 'input'].includes(key)), 'ACCOUNT_SELECTOR_FORBIDDEN');
    check(typeof command.intentId === 'string' && /^[\w-]{16,80}$/.test(command.intentId), 'INVALID_REQUEST_ID');
    check(Number.isSafeInteger(command.expectedRevision) && command.expectedRevision >= 0, 'AUTHORITY_INTENT_INVALID');
    check(['submit', 'cancel', 'quote', 'quoteFailed'].includes(command.type), 'AUTHORITY_INTENT_INVALID');
    if (command.type === 'submit') check(command.input?.currency === 'USDT' && command.input.id === command.intentId, 'INVALID_ORDER');
    check(!['userId', 'accountId', 'owner', 'subject', 'issuer', 'account', 'user'].some(key => key in (command.input ?? {})), 'ACCOUNT_SELECTOR_FORBIDDEN');
    return digest(command);
  };
  return {
    // Explicit fixture provisioning only. Reads/commands never call this method.
    installFixture({ principal, cashId, available, locked = '0', state }) {
      const id = accountId(principal), money = { available: exactEight(available), locked: exactEight(locked) };
      check(typeof cashId === 'string' && cashId.length > 0, 'ACCOUNT_NOT_BOUND');
      const ledger = structuredClone(state); ledger.wallets.USDT.cash = decimal(units(money.available) + units(ledger.wallets.USDT.reserved));
      check(units(money.locked) >= units(ledger.wallets.USDT.reserved), 'AUTHORITY_RESERVE_MISMATCH'); validate(ledger);
      transaction(() => {
        check(!db.prepare('SELECT 1 FROM fixture_stocks WHERE principal=?').get(id), 'FIXTURE_ALREADY_BOUND');
        db.prepare('INSERT INTO fixture_cash VALUES(?,?,?)').run(cashId, money.available, money.locked);
        db.prepare('INSERT INTO fixture_stocks VALUES(?,?,?)').run(id, cashId, encode(ledger));
      });
    },
    registerFixtureSession(principal, { canTrade = false, expiresAt = now() + 3000 } = {}) {
      check(Number.isSafeInteger(expiresAt) && expiresAt > now(), 'AUTH_REQUIRED');
      const session = randomUUID(); sessions.set(session, { principal: accountId(principal), canTrade: canTrade === true, valid: true, expiresAt }); return session;
    },
    revokeFixtureSession(session) { const value = sessions.get(session); check(value, 'AUTH_REQUIRED'); value.valid = false; },
    issuePermit(principal, session, command) {
      const grant = { principal: accountId(principal), session, digest: validateCommand(command) }; owns(grant); binding(principal);
      const token = Object.freeze({}); permits.set(token, grant); return token;
    },
    execute(token, command) {
      const grant = permits.get(token); check(grant, 'AUTH_REQUIRED'); owns(grant);
      const requestDigest = validateCommand(command); check(requestDigest === grant.digest, 'IDEMPOTENCY_CONFLICT');
      let committed = false;
      db.exec('BEGIN IMMEDIATE');
      try {
        owns(grant);
        const prior = db.prepare('SELECT * FROM fixture_receipts WHERE principal=? AND intent_id=?').get(grant.principal, command.intentId);
        if (prior) { check(prior.digest === requestDigest, 'IDEMPOTENCY_CONFLICT'); db.exec('COMMIT'); committed = true; return JSON.parse(prior.receipt); }
        const row = db.prepare('SELECT * FROM fixture_stocks WHERE principal=?').get(grant.principal); check(row, 'ACCOUNT_NOT_BOUND');
        const money = cash(row.cash_id), state = decode(row, money);
        check(state.revision === command.expectedRevision, 'ACCOUNT_CHANGED');
        const oldCash = units(state.wallets.USDT.cash), oldReserve = units(state.wallets.USDT.reserved);
        const result = executeAccountCommand(state, command.type, structuredClone(command.input), now());
        check(!result?.then, 'ASYNC_TRANSACTION_FORBIDDEN'); state.revision++; validate(state);
        const reserveDelta = units(state.wallets.USDT.reserved) - oldReserve;
        const nextAvailable = units(money.available) + units(state.wallets.USDT.cash) - oldCash - reserveDelta;
        const nextLocked = units(money.locked) + reserveDelta;
        check(nextAvailable >= 0n && nextLocked >= 0n, 'INSUFFICIENT_FUNDS');
        // Unrelated Wallet locks stay locked; only this account's reserve moves.
        check(nextLocked - units(state.wallets.USDT.reserved) === units(money.locked) - oldReserve, 'AUTHORITY_RESERVE_MISMATCH');
        db.prepare('UPDATE fixture_cash SET available=?,locked=? WHERE id=?').run(decimal(nextAvailable), decimal(nextLocked), row.cash_id);
        db.prepare('UPDATE fixture_stocks SET ledger=? WHERE principal=?').run(encode(state), grant.principal);
        const receipt = { intentId: command.intentId, digest: requestDigest, result, snapshot: snapshot(state, now()) };
        db.prepare('INSERT INTO fixture_receipts VALUES(?,?,?,?)').run(grant.principal, command.intentId, requestDigest, JSON.stringify(receipt));
        db.prepare('INSERT INTO fixture_audit VALUES(?,?,?,?,?)').run(grant.principal, command.intentId, row.cash_id, state.revision, requestDigest);
        const hookResult = beforeCommit(); check(!hookResult?.then, 'ASYNC_TRANSACTION_FORBIDDEN'); owns(grant);
        // Fixture revocations and commit run synchronously on this one authority
        // thread. This is the fixture linearization point, NOT a claim about a
        // remote /me response or production worker/session synchronization.
        db.exec('COMMIT'); committed = true;
        const after = afterCommit(); check(!after?.then, 'ASYNC_TRANSACTION_FORBIDDEN');
        return receipt;
      } catch (error) {
        if (committed) throw new SimError('ACCOUNT_OUTCOME_UNKNOWN');
        try { db.exec('ROLLBACK'); } catch { throw new SimError('ACCOUNT_OUTCOME_UNKNOWN'); }
        throw error;
      }
    },
    readFixture(principal) { const row = binding(principal), money = cash(row.cash_id); return { cashId: row.cash_id, money: { available: money.available, locked: money.locked }, snapshot: snapshot(decode(row, money), now()) }; },
    spendElsewhereFixture(cashId, amount) { transaction(() => { const row = cash(cashId), value = units(exactEight(amount)); check(units(row.available) >= value, 'INSUFFICIENT_FUNDS'); db.prepare('UPDATE fixture_cash SET available=? WHERE id=?').run(decimal(units(row.available) - value), cashId); }); },
    rowsFixture() { return { cash: db.prepare('SELECT * FROM fixture_cash ORDER BY id').all(), accounts: db.prepare('SELECT * FROM fixture_stocks ORDER BY principal').all(), receipts: db.prepare('SELECT * FROM fixture_receipts ORDER BY principal,intent_id').all(), audit: db.prepare('SELECT * FROM fixture_audit ORDER BY principal,intent_id').all() }; },
    close() { db.close(); },
  };
}
