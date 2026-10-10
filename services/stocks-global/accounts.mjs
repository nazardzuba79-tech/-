import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createState, snapshot, validate, check, SimError } from './engine.mjs';

// The principal comes ONLY from the server's authentication adapter, never a URL/body.
export function accountId(principal) {
  check(typeof principal?.issuer === 'string' && principal.issuer.length > 0 && principal.issuer.length <= 512, 'AUTH_REQUIRED');
  check(typeof principal?.subject === 'string' && /^[A-Za-z0-9_.:@-]{1,128}$/.test(principal.subject), 'AUTH_REQUIRED');
  return createHash('sha256').update(JSON.stringify([principal.issuer, principal.subject])).digest('hex');
}

export function openAccounts(path, { now = Date.now, beforeCommit = () => {}, diagnostics = false } = {}) {
  check(path?.endsWith('.sqlite'), 'LOCAL_LEDGER_PATH_REQUIRED');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const counters={sqlCalls:0,sqlReadCalls:0,sqlWriteCalls:0,sqlExecCalls:0,transactionExecCalls:0,sqlWallMs:0,sqlCpuMs:0,sqlThreadCpuAvailable:Number(typeof process.threadCpuUsage==='function'),sqlStages:{}};
  const sql=(stage,kind,run)=>{
    if(!diagnostics)return run();
    const started=performance.now(),cpu=process.threadCpuUsage?.();
    try{return run();}finally{
      const wallMs=performance.now()-started,used=cpu?process.threadCpuUsage(cpu):null,cpuMs=used?(used.user+used.system)/1000:0;
      counters.sqlCalls++;counters[kind]++;if(['begin','commit','rollback'].includes(stage))counters.transactionExecCalls++;
      counters.sqlWallMs+=wallMs;counters.sqlCpuMs+=cpuMs;
      const entry=counters.sqlStages[stage]??={calls:0,wallMs:0,cpuMs:0};entry.calls++;entry.wallMs+=wallMs;entry.cpuMs+=cpuMs;
    }
  };
  // Only this isolated paper database is opened. No import of the ownerless legacy JSON.
  sql('configure','sqlExecCalls',()=>db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;'));
  sql('configure','sqlExecCalls',()=>db.exec('CREATE TABLE IF NOT EXISTS paper_accounts (id TEXT PRIMARY KEY, ledger TEXT NOT NULL) STRICT'));
  const read = db.prepare('SELECT ledger FROM paper_accounts WHERE id=?');
  const insert = db.prepare('INSERT OR IGNORE INTO paper_accounts(id,ledger) VALUES (?,?)');
  const update = db.prepare('UPDATE paper_accounts SET ledger=? WHERE id=?');
  const load = id => { const row = sql('read','sqlReadCalls',()=>read.get(id)); check(row, 'ACCOUNT_NOT_FOUND'); const state = JSON.parse(row.ledger); validate(state); return state; };
  return {
    forPrincipal(principal) {
      const id = accountId(principal);
      const initial=JSON.stringify(createState(now()));
      sql('write','sqlWriteCalls',()=>insert.run(id,initial));
      return {
        id,
        read: () => snapshot(load(id), now()),
        async transact(fn) {
          sql('begin','sqlExecCalls',()=>db.exec('BEGIN IMMEDIATE'));
          let committed=false;
          try {
            const state = load(id), result = fn(state, now());
            check(!result?.then, 'ASYNC_TRANSACTION_FORBIDDEN');
            state.revision++; validate(state);
            const encoded=JSON.stringify(state);
            sql('write','sqlWriteCalls',()=>update.run(encoded,id)); beforeCommit();
            sql('commit','sqlExecCalls',()=>db.exec('COMMIT'));
            committed=true;
            return { result, snapshot: snapshot(state, now()) };
          } catch (error) {
            // A response/snapshot failure after COMMIT cannot be reported as a
            // rolled-back trade. Nor can a failed rollback prove non-execution.
            if(committed)throw new SimError('ACCOUNT_OUTCOME_UNKNOWN');
            try{sql('rollback','sqlExecCalls',()=>db.exec('ROLLBACK'));}
            catch{throw new SimError('ACCOUNT_OUTCOME_UNKNOWN');}
            throw error;
          }
        },
      };
    },
    metrics() { return {...counters,sqlStages:Object.fromEntries(Object.entries(counters.sqlStages).map(([key,value])=>[key,{...value}]))}; },
    close() { db.close(); },
  };
}
