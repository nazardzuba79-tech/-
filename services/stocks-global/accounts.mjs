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

export function openAccounts(path, { now = Date.now, beforeCommit = () => {}, beforeRegistrationCommit = () => {}, diagnostics = false } = {}) {
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
  const exists = db.prepare('SELECT 1 FROM paper_accounts WHERE id=?');
  const insert = db.prepare('INSERT OR IGNORE INTO paper_accounts(id,ledger) VALUES (?,?)');
  const update = db.prepare('UPDATE paper_accounts SET ledger=? WHERE id=?');
  const load = (id,missing='ACCOUNT_NOT_FOUND') => { const row = sql('read','sqlReadCalls',()=>read.get(id)); check(row, missing); const state = JSON.parse(row.ledger); validate(state); return state; };
  return {
    ensurePrincipals(principals) {
      // Only the worker's already-admitted, consecutive registrations may share
      // this transaction. Existing ledgers and financial commands are excluded.
      check(Array.isArray(principals)&&principals.length>0&&principals.length<=32,'ACCOUNT_COMMAND_INVALID');
      const owners=new Map(principals.map(principal=>{const id=accountId(principal);return[id,{id,created:false}];}));
      const missing=[...owners.values()].filter(owner=>!sql('exists','sqlReadCalls',()=>exists.get(owner.id)));
      if(!missing.length)return{owners:[...owners.values()],committed:false};
      sql('begin','sqlExecCalls',()=>db.exec('BEGIN IMMEDIATE'));
      let committed=false;
      try{
        for(const owner of missing){
          // Another SQLite writer may have created this identity since SELECT.
          // Never replace its initial balance, history, revision or reservations.
          owner.created=sql('write','sqlWriteCalls',()=>insert.run(owner.id,JSON.stringify(createState(now())))).changes===1;
        }
        beforeRegistrationCommit();
        sql('commit','sqlExecCalls',()=>db.exec('COMMIT'));committed=true;
        return{owners:[...owners.values()],committed:true};
      }catch(error){
        if(committed)throw new SimError('ACCOUNT_OUTCOME_UNKNOWN');
        try{sql('rollback','sqlExecCalls',()=>db.exec('ROLLBACK'));}
        catch{throw new SimError('ACCOUNT_OUTCOME_UNKNOWN');}
        throw error;
      }
    },
    forPrincipal(principal,{existingOnly=false}={}) {
      check(typeof existingOnly==='boolean','ACCOUNT_COMMAND_INVALID');
      const id = accountId(principal);
      const missing=existingOnly?'ACCOUNT_NOT_BOUND':'ACCOUNT_NOT_FOUND';
      // Reopening an existing owner must not acquire SQLite's writer lock merely
      // to ignore an INSERT. A concurrent writer can coexist with this read.
      // Missing owners still receive their own FULL durable INSERT before ACK;
      // INSERT OR IGNORE retains correctness if another process creates first.
      // Restricted traders must already have an authoritative test ledger. Read
      // and validate the raw record; neither login nor a later command can fund
      // an absent binding. The default fixture/legacy registration stays intact.
      const present=existingOnly?load(id,missing):sql('exists','sqlReadCalls',()=>exists.get(id));
      const created = !existingOnly && !present && sql('write','sqlWriteCalls',()=>insert.run(id,JSON.stringify(createState(now())))).changes === 1;
      return {
        id, created,
        readState: () => load(id,missing),
        read: () => snapshot(load(id,missing), now()),
        async transact(fn) {
          sql('begin','sqlExecCalls',()=>db.exec('BEGIN IMMEDIATE'));
          let committed=false;
          try {
            const state = load(id,missing), result = fn(state, now());
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
