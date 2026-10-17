// Opt-in VOLTEX DemoBalance authority. No connection URL or credentials are
// read here: the existing API injects its Prisma client. Default SQLite stays
// separate. All SQL is static and values are bound parameters.
import { createHash, randomUUID } from 'node:crypto';
import { accountId } from './accounts.mjs';
import { createState, validate, snapshot, units, decimal, check, SimError, canonicalOrder } from './engine.mjs';
import { executeAccountCommand, portfolioSnapshot } from './account-commands.mjs';
import { createObservations } from './account-observations.mjs';

export function exactAuthorityAmount(value) {
  const text = String(value), match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/.exec(text);
  check(match && !/[1-9]/.test((match[2] ?? '').slice(8)), 'CASH_PRECISION_UNSUPPORTED');
  return decimal(units(match[1] + '.' + (match[2] ?? '').slice(0, 8).padEnd(8, '0')));
}
const CASH_SCALE=10n**18n,ENGINE_FACTOR=10n**10n;
const cashUnits=value=>{const match=/^(0|[1-9]\d{0,17})(?:\.(\d{1,18}))?$/.exec(String(value));check(match,'CASH_PRECISION_UNSUPPORTED');return BigInt(match[1])*CASH_SCALE+BigInt((match[2]??'').padEnd(18,'0'));};
const cashDecimal=value=>`${value/CASH_SCALE}.${(value%CASH_SCALE).toString().padStart(18,'0')}`;
export function authorityProjection(available,locked,ownReserved){
  const available18=cashUnits(available),locked18=cashUnits(locked),reserved=units(ownReserved);
  check(locked18>=reserved*ENGINE_FACTOR,'AUTHORITY_RESERVE_MISMATCH');
  return{available18,locked18,cash:decimal(available18/ENGINE_FACTOR+reserved),dust:cashDecimal(available18%ENGINE_FACTOR)};
}
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  check(value === null || ['string', 'boolean', 'number'].includes(typeof value), 'ACCOUNT_COMMAND_INVALID');
  check(typeof value !== 'number' || Number.isSafeInteger(value), 'ACCOUNT_COMMAND_INVALID'); return value;
};
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sql = (db, query, ...params) => db.$queryRawUnsafe(query, ...params);
const write = (db, query, ...params) => db.$executeRawUnsafe(query, ...params);
const json = value => typeof value === 'string' ? JSON.parse(value) : structuredClone(value);
const stripCash = state => { const stored = structuredClone(state); delete stored.wallets.USDT.cash; return JSON.stringify(stored); };
const commands = new Set(['ensure', 'read', 'readView', 'portfolioView', 'interests', 'submitObserved', 'cancel', 'observe', 'observeFailed', 'observeBackground', 'observeFailedBackground']);
const observationTypes = new Set(['observe','observeFailed','observeBackground','observeFailedBackground']);
const cancellableTypes = new Set(['readView','portfolioView','observe']);
function quoteIntent(input) {
  if (!input || !Object.hasOwn(input,'change24h')) return input;
  const percent=input.change24h;
  check(percent===null || typeof percent==='number' && Number.isFinite(percent),'ACCOUNT_COMMAND_INVALID');
  // Display percentage is the one provider Number domain. Money, capacity,
  // timestamps and all other numeric fields retain their existing guards.
  return {...input,change24h:percent===null?null:['display-percent',String(percent)]};
}

export function openPostgresAuthority(db, { issuer, tradePrincipals, now = Date.now, beforeCommit, afterCommit, maxPending = 128 } = {}) {
  check(typeof issuer === 'string' && issuer.length > 0 && Array.isArray(tradePrincipals) && tradePrincipals.length === 2, 'AUTH_CONFIG_INVALID');
  const permitted = new Set(tradePrincipals.map(principal => { check(principal.issuer === issuer, 'AUTH_CONFIG_INVALID'); return accountId(principal); }));
  check(permitted.size === 2 && Number.isInteger(maxPending) && maxPending > 0 && maxPending <= 128, 'AUTH_CONFIG_INVALID');
  const observations = createObservations({ now }), registered = new Set(), queues = new Map();
  let pending = 0;
  const counters = { committed: 0, replayed: 0, rejected: 0, unknown: 0 };
  const authorize = actor => {
    check(actor && actor.issuer === issuer && actor.subject === actor.userId && permitted.has(accountId(actor)), 'AUTH_REQUIRED');
    check(typeof actor.sessionId === 'string' && actor.sessionId.length > 0 && Number.isSafeInteger(actor.expiresAt) && now() < actor.expiresAt, 'AUTH_REQUIRED');
    return accountId(actor);
  };
  async function session(tx, actor, lock) {
    authorize(actor);
    // NO KEY UPDATE conflicts with block/revoke UPDATE, but remains compatible
    // with FK KEY SHARE acquired by Demo Spot's orders/audit inserts.
    const users = await sql(tx, 'SELECT "id","blockedAt" FROM "User" WHERE "id"=$1' + (lock ? ' FOR NO KEY UPDATE' : ''), actor.userId);
    check(users.length === 1 && !users[0].blockedAt, 'AUTH_REQUIRED');
    const sessions = await sql(tx, 'SELECT "id","userId","revokedAt" FROM "Session" WHERE "id"=$1' + (lock ? ' FOR NO KEY UPDATE' : ''), actor.sessionId);
    check(sessions.length === 1 && sessions[0].userId === actor.userId && !sessions[0].revokedAt, 'AUTH_REQUIRED');
    authorize(actor);
  }
  async function load(tx, actor, lock = false) {
    const id = authorize(actor);
    const rows = await sql(tx, 'SELECT a."principalHash",a."issuer",a."subject",a."userId",a."revision",a."ledger",d."available"::text AS available,d."locked"::text AS locked FROM "StocksTestAccount" a JOIN "DemoBalance" d ON d."userId"=a."userId" AND d."asset"=\'USDT\' WHERE a."principalHash"=$1' + (lock ? ' FOR UPDATE OF a,d' : ''), id);
    check(rows.length === 1 && rows[0].issuer === actor.issuer && rows[0].subject === actor.subject && rows[0].userId === actor.userId, 'ACCOUNT_NOT_BOUND');
    const state = json(rows[0].ledger),projection=authorityProjection(rows[0].available,rows[0].locked,state.wallets.USDT.reserved);
    check(!Object.hasOwn(state.wallets.USDT, 'cash'), 'AUTHORITY_SHADOW_CASH_FORBIDDEN');
    state.wallets.USDT.cash = projection.cash;
    check(state.revision === rows[0].revision, 'AUTHORITY_RESERVE_MISMATCH');
    validate(state);
    if (!registered.has(id)) { observations.register(id, false); registered.add(id); }
    return { id, state, available18:projection.available18, locked18:projection.locked18,authorityCash:{asset:'USDT',available:cashDecimal(projection.available18),locked:cashDecimal(projection.locked18),unspentRemainder:projection.dust,stocksPrecision:8} };
  }
  const view = (type, entry) => type === 'portfolioView' ? portfolioSnapshot(entry.state, now()) : {...(type==='read'?snapshot(entry.state,now()):observations.view(entry.id,entry.state)),authorityCash:entry.authorityCash};
  function intent(type, input, occurrenceId) {
    const payload = { type, input: type === 'submitObserved' ? canonicalOrder(input?.order) : ['observe','observeBackground'].includes(type) ? quoteIntent(input) : input ?? null }, digest = hash(payload);
    const id = type === 'submitObserved' ? input?.order?.id : observationTypes.has(type) ? `observation:${occurrenceId}` : `${type}:${digest}`;
    check(typeof id === 'string' && id.length >= 16 && id.length <= 160, 'INVALID_REQUEST_ID');
    if (type === 'submitObserved') check(input.order.currency === 'USDT', 'INVALID_ORDER');
    return { id, digest };
  }
  async function executeNow(actor, type, input, occurrenceId) {
    check(commands.has(type), type === 'balances' ? 'BALANCE_EDIT_DISABLED' : 'ACCOUNT_COMMAND_INVALID');
    for (const object of [input, input?.order]) if (object && typeof object === 'object') check(!['userId','accountId','owner','subject','issuer','account','user'].some(key => key in object), 'ACCOUNT_SELECTOR_FORBIDDEN');
    const id = authorize(actor);
    if (['observe','observeBackground'].includes(type)) quoteIntent(input);
    if (['ensure', 'read', 'readView', 'portfolioView', 'interests'].includes(type)) {
      await session(db, actor, false); const entry = await load(db, actor); await session(db, actor, false);
      return type === 'ensure' ? { id } : type === 'interests' ? executeAccountCommand(entry.state, type, input ?? {}, now()) : view(type, entry);
    }
    let committed = false, committedState, syncId, projection = true, observation;
    try {
      const outcome = await db.$transaction(async tx => {
        await session(tx, actor, true);
        // Cash first, then Stocks: Demo Spot already uses atomic conditional
        // UPDATE on this same row; no second lock protocol/change is required.
        const cashRows = await sql(tx, 'SELECT "id" FROM "DemoBalance" WHERE "userId"=$1 AND "asset"=\'USDT\' FOR UPDATE', actor.userId);
        check(cashRows.length === 1, 'ACCOUNT_NOT_BOUND');
        const entry = await load(tx, actor, true), state = entry.state;
        const received = type === 'observe' || type === 'observeBackground';
        const isObservation = ['observe', 'observeBackground', 'observeFailed', 'observeFailedBackground'].includes(type);
        const background = type.endsWith('Background'); projection = !background;
        const target = isObservation ? (received ? input?.instrumentId : input?.id) : type === 'submitObserved' ? input?.order?.instrumentId : null;
        const durable = !isObservation || observations.hasOrders(state, target);
        const key = intent(type, input, occurrenceId), prior = await sql(tx, 'SELECT "payloadHash","receipt" FROM "StocksTestReceipt" WHERE "principalHash"=$1 AND "intentId"=$2', id, key.id);
        if (prior.length) {
          check(prior[0].payloadHash === key.digest, 'IDEMPOTENCY_CONFLICT'); counters.replayed++;
          return { replay: true, receipt: json(prior[0].receipt), result: json(prior[0].receipt).result, snapshot: observations.view(id, state), ...(isObservation ? { observation: { durable: true, mode: 'committed' } } : {}) };
        }
        if (isObservation) {
          if (received) observation = observations.observe(id, state, input); else observations.failed(id, state, target);
          if (!durable) { observations.count(false); return { volatile: true, ...(background ? {} : { snapshot: observations.view(id, state) }), observation: { durable: false, mode: 'volatile' } }; }
        }
        const oldCash = units(state.wallets.USDT.cash), oldReserve = units(state.wallets.USDT.reserved);
        let result;
        if (type === 'submitObserved') { if (state.orders.some(order => order.id === input.order.id)) syncId = null; else syncId = target; result = observations.submit(id, state, input, now()); }
        else if (isObservation) { syncId = target; if (received && observation.quote) result = executeAccountCommand(state, 'quote', observation.quote, now()); else if (!received) result = executeAccountCommand(state, 'quoteFailed', { id: target }, now()); }
        else result = executeAccountCommand(state, type, input, now());
        state.revision++; validate(state);
        const reserveDelta = units(state.wallets.USDT.reserved) - oldReserve;
        const availableDelta = units(state.wallets.USDT.cash) - oldCash - reserveDelta;
        const nextAvailable = entry.available18 + availableDelta*ENGINE_FACTOR, nextLocked = entry.locked18 + reserveDelta*ENGINE_FACTOR;
        check(nextAvailable >= 0n && nextLocked >= 0n && nextLocked - units(state.wallets.USDT.reserved)*ENGINE_FACTOR === entry.locked18 - oldReserve*ENGINE_FACTOR, 'INSUFFICIENT_FUNDS');
        const changes = await write(tx, 'UPDATE "DemoBalance" SET "available"="available"+$2::numeric,"locked"="locked"+$3::numeric,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1 AND "asset"=\'USDT\' AND "available"+$2::numeric>=0 AND "locked"+$3::numeric>=0', actor.userId, decimal(availableDelta), decimal(reserveDelta));
        check(changes === 1, 'INSUFFICIENT_FUNDS');
        // jsonb canonicalizes object key order. Reconcile observations against
        // the representation future reads will actually return, preserving
        // the existing digest/capacity/freshness contract without refetching.
        const persisted = await sql(tx, 'UPDATE "StocksTestAccount" SET "revision"=$2,"ledger"=$3::jsonb,"updatedAt"=CURRENT_TIMESTAMP WHERE "principalHash"=$1 RETURNING "ledger"', id, state.revision, stripCash(state));
        check(persisted.length === 1, 'ACCOUNT_NOT_BOUND');
        const acknowledgedState = json(persisted[0].ledger);
        acknowledgedState.wallets.USDT.cash = state.wallets.USDT.cash;
        const receipt = { intentId: key.id, payloadHash: key.digest, revision: state.revision, ...(result === undefined ? {} : { result }) };
        await write(tx, 'INSERT INTO "StocksTestReceipt" ("principalHash","intentId","payloadHash","revision","receipt") VALUES($1,$2,$3,$4,$5::jsonb)', id, key.id, key.digest, state.revision, JSON.stringify(receipt));
        await write(tx, 'INSERT INTO "StocksTestAudit" ("principalHash","intentId","userId","sessionId","kind","revision","payloadHash") VALUES($1,$2,$3,$4,$5,$6,$7)', id, key.id, actor.userId, actor.sessionId, type, state.revision, key.digest);
        await beforeCommit?.({ actor: { ...actor }, intentId: key.id, transaction: tx });
        await session(tx, actor, false); authorize(actor);
        committedState = acknowledgedState;
        return { result, receipt, snapshot: snapshot(state, now()), ...(isObservation ? { observation: { durable: true, mode: 'committed' } } : {}) };
      }, { timeout: 10000, maxWait: 2000, isolationLevel: 'ReadCommitted' });
      committed = !outcome.volatile && !outcome.replay;
      if (committedState) { observations.committed(id, committedState, syncId); if (projection) outcome.snapshot = observations.view(id, committedState); counters.committed++; }
      if (committed) await afterCommit?.({ actor: { ...actor }, receipt: outcome.receipt });
      return outcome;
    } catch (error) {
      counters.rejected++;
      if (committed || (error?.code && !['AUTH_REQUIRED','ACCOUNT_NOT_BOUND','IDEMPOTENCY_CONFLICT','INSUFFICIENT_FUNDS','QUOTE_STALE','INVALID_ORDER','INVALID_QUOTE','ACCOUNT_BUSY'].includes(error.code) && !(error instanceof SimError))) { counters.unknown++; throw new SimError('ACCOUNT_OUTCOME_UNKNOWN'); }
      throw error;
    }
  }
  return {
    // Explicit operator/test provisioning; never mounted as a browser endpoint.
    // It links EXISTING DemoBalance only and never inserts/credits that table.
    async bindExisting(actor) {
      const id = authorize(actor);
      return db.$transaction(async tx => {
        await session(tx, actor, true);
        const cash = await sql(tx, 'SELECT "available"::text AS available,"locked"::text AS locked FROM "DemoBalance" WHERE "userId"=$1 AND "asset"=\'USDT\' FOR UPDATE', actor.userId);
        check(cash.length === 1, 'ACCOUNT_NOT_BOUND'); cashUnits(cash[0].available);cashUnits(cash[0].locked);
        const state = createState(now()); state.wallets.USDT.cash = '0.00000000'; state.wallets.USDC.cash = '0.00000000';
        await write(tx, 'INSERT INTO "StocksTestAccount" ("principalHash","issuer","subject","userId","revision","ledger") VALUES($1,$2,$3,$4,0,$5::jsonb) ON CONFLICT ("principalHash") DO NOTHING', id, issuer, actor.subject, actor.userId, stripCash(state));
        const entry = await load(tx, actor); return { id, revision: entry.state.revision };
      });
    },
    execute(actor, type, input, options = {}) {
      const id = authorize(actor), actorCopy = structuredClone(actor), inputCopy = structuredClone(input);
      const signal=cancellableTypes.has(type)?options.signal:undefined;
      const aborted=()=>new SimError(type==='observe'?'ACCOUNT_OBSERVATION_ABORTED':'ACCOUNT_READ_ABORTED');
      if(signal?.aborted)return Promise.reject(aborted());
      const occurrenceId=observationTypes.has(type)?options.occurrenceId??randomUUID():undefined;
      check(occurrenceId===undefined||typeof occurrenceId==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(occurrenceId),'ACCOUNT_COMMAND_INVALID');
      check(pending < maxPending, 'ACCOUNT_BUSY');pending++;
      const queue=queues.get(id)??{active:false,entries:[]};queues.set(id,queue);
      return new Promise((resolve,reject)=>{
        const entry={actor:actorCopy,type,input:inputCopy,occurrenceId,deadline:performance.now()+2500,signal,onAbort:null,resolve,reject};
        const detach=entry=>entry.signal?.removeEventListener('abort',entry.onAbort);
        const pump=()=>{
          if(queue.active)return;
          const next=queue.entries.shift();if(!next){queues.delete(id);return;}
          detach(next);queue.active=true;
          const settle=(callback,value)=>{pending--;queue.active=false;pump();callback(value);};
          Promise.resolve().then(()=>{check(performance.now()<next.deadline,'ACCOUNT_BUSY');return executeNow(next.actor,next.type,next.input,next.occurrenceId);})
            .then(value=>settle(next.resolve,value),error=>settle(next.reject,error));
        };
        entry.onAbort=()=>{const index=queue.entries.indexOf(entry);if(index<0)return;queue.entries.splice(index,1);pending--;detach(entry);reject(aborted());if(!queue.active&&!queue.entries.length)queues.delete(id);};
        queue.entries.push(entry);signal?.addEventListener('abort',entry.onAbort,{once:true});if(signal?.aborted)entry.onAbort();pump();
      });
    },
    metrics() { return { ...counters, pending, authority: 'existing-demo-balance' }; },
  };
}
