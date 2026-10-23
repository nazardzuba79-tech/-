const test=require('node:test'),assert=require('node:assert/strict');
const {disposableUrl,fixture}=require('./testing/disposable-postgres.cjs');
const available=!!disposableUrl();
const order=(id,extra={})=>({id,instrumentId:'BYBIT:AAPLXUSDT',currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.1',limitPrice:'90',...extra});
const until=async callback=>{const end=Date.now()+5000;while(!await callback()){assert.ok(Date.now()<end,'bounded PG barrier');await new Promise(resolve=>setTimeout(resolve,5));}};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function pg(name,fn){test('real PostgreSQL: '+name,{timeout:20000,skip:available?false:'NOT_RUN: no confirmed disposable local PostgreSQL URL; SQLite/mock is not acceptance'},fn);}

pg('gateway execution OFF preserves all cash, account, receipt and audit rows for both admitted sessions and a viewer',async t=>{
  // Keep the API authority gate ON inside this isolated test: the separate
  // gateway gate must reject commands independently, before any PG authority call.
  const f=await fixture(t,{financialEnabled:false,orderExecutionEnabled:true}),viewer=await f.newViewer('execution-off');
  const before=await f.rows();
  for(const token of [...f.tokens,viewer.token]){
    const state=await f.request('state?id='+encodeURIComponent(f.ID),{token});
    assert.equal(state.status,200);assert.equal(state.data.account.canTrade,false);
    for(const type of ['MARKET','LIMIT'])for(const side of ['BUY','SELL']){
      const result=await f.request('orders',{token,body:{gatewayToken:state.data.token,...order('pg-default-off-'+type+side,{type,side})}});
      assert.equal(result.status,403);assert.equal(result.data.error,'ACCOUNT_TRADING_DISABLED');
    }
    for(const route of ['cancel','balances','refresh'])assert.equal((await f.request(route,{token,body:{gatewayToken:state.data.token}})).status,403);
  }
  assert.deepEqual(await f.rows(),before);
});

pg('Market/Limit/partial sell/cancel/PnL and account isolation use existing DemoBalance',async t=>{
  const f=await fixture(t),token=await f.ready();const baseline=await f.db.demoBalance.findUnique({where:{userId_asset:{userId:f.users[0],asset:'USDT'}}});
  const bought=await f.request('orders',{body:{gatewayToken:token,...order('pg-market-buy-000001',{type:'MARKET'})}});assert.equal(bought.status,200,JSON.stringify(bought));assert.equal(bought.data.wallets.USDT.cash,'721.25000000');
  f.advance(3000,'110');await f.request('state?id='+encodeURIComponent(f.ID));
  const sold=await f.request('orders',{body:{gatewayToken:token,...order('pg-partial-sell-00001',{type:'MARKET',side:'SELL',quantity:'0.05'})}});assert.equal(sold.status,200);assert.equal(sold.data.wallets.USDT.cash,'726.75000000');assert.equal(sold.data.realized.USDT,'0.50000000');
  const limit=await f.request('orders',{body:{gatewayToken:token,...order('pg-limit-cancel-00001')}});assert.equal(limit.status,200);assert.equal(limit.data.wallets.USDT.reserved,'9.00000000');
  const cancelled=await f.request('cancel',{body:{gatewayToken:token,id:'pg-limit-cancel-00001'}});assert.equal(cancelled.status,200);assert.equal(cancelled.data.wallets.USDT.reserved,'0.00000000');
  const cash=await f.db.demoBalance.findUnique({where:{userId_asset:{userId:f.users[0],asset:'USDT'}}});assert.equal(cash.available.toFixed(8),cancelled.data.wallets.USDT.available);assert.equal(baseline.available.toFixed(8),'731.25000000');
  const b=await f.db.demoBalance.findUnique({where:{userId_asset:{userId:f.users[1],asset:'USDT'}}});assert.equal(b.available.toFixed(8),'129.87500000');
});

pg('Stocks and the real DemoTradingService cannot reserve the same existing USDT twice',async t=>{
  const f=await fixture(t),token=await f.ready(),BigNumber=require('bignumber.js');
  const results=await Promise.allSettled([
    f.request('orders',{body:{gatewayToken:token,...order('pg-double-spend-00001',{quantity:'5',limitPrice:'100'})}}),
    f.demo.placeOrder({userId:f.users[0],pair:'BTC/USDT',side:'BUY',type:'LIMIT',price:new BigNumber('100'),quantity:new BigNumber('5')})
  ]);
  const wins=results.filter((row,index)=>row.status==='fulfilled'&&(index===1||row.value.status===200));assert.equal(wins.length,1);
  const cash=await f.db.demoBalance.findUnique({where:{userId_asset:{userId:f.users[0],asset:'USDT'}}});assert.equal(cash.available.toFixed(8),'231.25000000');assert.equal(cash.locked.toFixed(8),'500.00000000');
});

pg('revoked queued intent is rejected before its COMMIT through the real adapter',async t=>{
  const f=await fixture(t),token=await f.ready(),secondSession=await f.newSession(),entered=deferred(),release=deferred();let calls=0;
  f.setBefore(async()=>{if(++calls===1){entered.resolve();await release.promise;}});
  t.after(()=>release.resolve());
  const first=f.request('orders',{body:{gatewayToken:token,...order('pg-precommit-first-001')}});await entered.promise;
  const second=f.request('orders',{token:secondSession.token,body:{gatewayToken:token,...order('pg-precommit-revoked-01')}});
  await until(()=>f.authority.metrics().pending===2);
  await f.other.session.update({where:{id:secondSession.sessionId},data:{revokedAt:new Date()}});release.resolve();
  assert.equal((await first).status,200);const denied=await second;assert.equal(denied.status,401);assert.equal(denied.data.error,'AUTH_REQUIRED');
  const rows=await f.rows();const state=typeof rows.accounts[0].ledger==='string'?JSON.parse(rows.accounts[0].ledger):rows.accounts[0].ledger;
  assert.equal(state.orders.some(row=>row.id==='pg-precommit-revoked-01'),false);assert.equal(rows.receipts.length,1);assert.equal(rows.audit.length,1);
});

pg('active pre-COMMIT Session lock orders revoke acknowledgement after the durable receipt',async t=>{
  const f=await fixture(t),token=await f.ready(),entered=deferred(),release=deferred();f.setBefore(async()=>{entered.resolve();await release.promise;});t.after(()=>release.resolve());
  const request=f.request('orders',{body:{gatewayToken:token,...order('pg-session-lock-order-01')}});await entered.promise;
  let pid,revoked=false;const revocation=f.other.$transaction(async tx=>{pid=(await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid'))[0].pid;await tx.session.update({where:{id:f.sessions[0]},data:{revokedAt:new Date()}});}).then(()=>{revoked=true;});
  await until(async()=>pid&&(await f.db.$queryRawUnsafe('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',pid))[0]?.wait_event_type==='Lock');assert.equal(revoked,false);
  release.resolve();assert.equal((await request).status,200);await revocation;
  assert.equal((await f.request('orders',{body:{gatewayToken:token,...order('pg-after-revoked-00001')}})).status,401);
});

pg('lost ACK/reopened repository replays the durable receipt without double debit',async t=>{
  const f=await fixture(t),token=await f.ready();let lose=true;f.setAfter(()=>{if(lose){lose=false;throw Error('synthetic lost ACK');}});
  const input={gatewayToken:token,...order('pg-lost-ack-replay-001')};const first=await f.request('orders',{body:input});assert.equal(first.status,503);assert.equal(first.data.error,'ACCOUNT_OUTCOME_UNKNOWN');const before=await f.rows();
  const {openPostgresAuthority}=await import('./postgres-authority.mjs');const reopened=openPostgresAuthority(f.other,{issuer:f.actors[0].issuer,tradePrincipals:f.actors,now:()=>Date.now()});
  const replay=await reopened.execute(f.actors[0],'submitObserved',{order:order('pg-lost-ack-replay-001'),sourceBlocked:true});assert.equal(replay.receipt.intentId,'pg-lost-ack-replay-001');
  assert.deepEqual(await f.rows(),before);
});

pg('lost ACK survives fresh authority processes and restart cannot retain a revoked Session',async t=>{
  const f=await fixture(t),token=await f.ready();
  f.setAfter(()=>{throw Error('synthetic lost ACK before process restart');});
  const intent=order('pg-process-restart-001');
  const first=await f.request('orders',{body:{gatewayToken:token,...intent}});
  assert.equal(first.status,503);assert.equal(first.data.error,'ACCOUNT_OUTCOME_UNKNOWN');
  const durable=await f.rows();
  const {promisify}=require('node:util'),{execFile}=require('node:child_process');
  const {pathToFileURL}=require('node:url'),path=require('node:path');
  const authorityUrl=pathToFileURL(path.join(__dirname,'postgres-authority.mjs')).href;
  const script=`
    const {PrismaClient}=require('@prisma/client');
    (async()=>{
      const input=JSON.parse(process.env.STOCKS_RESTART_FIXTURE);
      const db=new PrismaClient({datasources:{db:{url:process.env.STOCKS_DISPOSABLE_PG_URL}}});
      try {
        const {openPostgresAuthority}=await import(${JSON.stringify(authorityUrl)});
        const authority=openPostgresAuthority(db,{issuer:input.actor.issuer,tradePrincipals:input.principals});
        try {
          const result=await authority.execute(input.actor,'submitObserved',{order:input.order,sourceBlocked:true});
          console.log(JSON.stringify({receipt:result.receipt,pid:process.pid}));
        } catch(error) { console.log(JSON.stringify({error:error.code,pid:process.pid})); }
      } finally {await db.$disconnect();}
    })().catch(()=>{process.exitCode=1;});
  `;
  const restart=async()=>{
    const {stdout}=await promisify(execFile)(process.execPath,['-e',script],{
      cwd:path.resolve(__dirname,'../..'),windowsHide:true,timeout:8000,
      env:{...process.env,STOCKS_RESTART_FIXTURE:JSON.stringify({actor:f.actors[0],principals:f.actors,order:intent})},
    });
    return JSON.parse(stdout.trim());
  };
  const a=await restart(),b=await restart();
  assert.notEqual(a.pid,process.pid);assert.notEqual(b.pid,process.pid);
  assert.equal(a.receipt.intentId,intent.id);assert.deepEqual(b.receipt,a.receipt);
  assert.deepEqual(await f.rows(),durable,'fresh processes must replay COMMIT, never debit again');
  await f.other.session.update({where:{id:f.sessions[0]},data:{revokedAt:new Date()}});
  const denied=await restart();assert.equal(denied.error,'AUTH_REQUIRED');
  assert.deepEqual(await f.rows(),durable,'restart must not cache the previous authorization');
});

pg('both permitted accounts trade independently and retain18-place shared Wallet remainder',async t=>{
  const f=await fixture(t);await f.db.demoBalance.update({where:{userId_asset:{userId:f.users[0],asset:'USDT'}},data:{available:'731.250000001234567890',locked:'0.000000000000000001'}});
  const [a,b]=await Promise.all([f.ready(0),f.ready(1)]);
  const results=await Promise.all([f.request('orders',{body:{gatewayToken:a,...order('pg-alpha-own-order-001')}}),f.request('orders',{index:1,body:{gatewayToken:b,...order('pg-beta-own-order-0001')}})]);
  assert.ok(results.every(row=>row.status===200));assert.equal(results[0].data.orders.some(row=>row.id==='pg-beta-own-order-0001'),false);assert.equal(results[1].data.orders.some(row=>row.id==='pg-alpha-own-order-001'),false);
  const cash=await f.db.demoBalance.findUnique({where:{userId_asset:{userId:f.users[0],asset:'USDT'}}});assert.equal(cash.available.toFixed(18),'722.250000001234567890');assert.equal(cash.locked.toFixed(18),'9.000000000000000001');
  const cancelled=await f.request('cancel',{body:{gatewayToken:a,id:'pg-alpha-own-order-001'}});assert.equal(cancelled.status,200);
  const restored=await f.db.demoBalance.findUnique({where:{userId_asset:{userId:f.users[0],asset:'USDT'}}});assert.equal(restored.available.toFixed(18),'731.250000001234567890');assert.equal(restored.locked.toFixed(18),'0.000000000000000001');
});

pg('pre-demand cache is reacquired but a genuinely old provider timestamp still blocks execution',async t=>{
  const f=await fixture(t),viewer=await f.newViewer(0);
  await f.request('state?id='+encodeURIComponent(f.ID),{token:viewer.token});const starts=f.sourceStarts.length;
  f.advance(100);const current=await f.request('state?id='+encodeURIComponent(f.ID));assert.equal(current.status,200);assert.equal(current.data.errors[f.ID],undefined);assert.equal(f.sourceStarts.length,starts+1);
  const before=await f.rows();f.advance(100);f.setSourceOffset(-5000);
  const stale=await f.request('state?id='+encodeURIComponent(f.ID),{view:'explicit-new-demand'});assert.equal(stale.data.errors[f.ID],'QUOTE_STALE');
  const rejected=await f.request('orders',{body:{gatewayToken:stale.data.token,...order('pg-old-source-blocked-01',{type:'MARKET'})}});assert.equal(rejected.status,422);assert.equal(rejected.data.error,'QUOTE_STALE');assert.deepEqual(await f.rows(),before);
});

pg('observation-triggered fill commits Wallet, ledger, receipt and audit together',async t=>{
  const f=await fixture(t),token=await f.ready();
  assert.equal((await f.request('orders',{body:{gatewayToken:token,...order('pg-observation-fill-0001')}})).status,200);
  const before=await f.rows();assert.equal(before.cash[0].locked.toFixed(8),'9.00000000');
  f.advance(3000,'80');assert.equal((await f.request('state?id='+encodeURIComponent(f.ID))).status,200);
  const after=await f.rows(),ledger=after.accounts[0].ledger;
  assert.equal(after.cash[0].available.toFixed(8),'723.25000000');assert.equal(after.cash[0].locked.toFixed(8),'0.00000000');
  assert.equal(ledger.orders.find(row=>row.id==='pg-observation-fill-0001').status,'FILLED');
  assert.equal(Object.hasOwn(ledger.wallets.USDT,'cash'),false);
  assert.equal(after.receipts.length,before.receipts.length+1);assert.equal(after.audit.length,before.audit.length+1);
});

pg('expiry at the pre-COMMIT barrier rolls back cash, ledger, receipt and audit',async t=>{
  const f=await fixture(t),token=await f.ready(),before=await f.rows();
  f.setBefore(()=>f.advance(3600000));
  const rejected=await f.request('orders',{body:{gatewayToken:token,...order('pg-expire-before-commit-01')}});
  assert.equal(rejected.status,401);assert.equal(rejected.data.error,'AUTH_REQUIRED');assert.deepEqual(await f.rows(),before);
});

pg('jsonb round-trip keeps an acknowledged quote usable for immediate replay and partial sale',async t=>{
  const f=await fixture(t),token=await f.ready(),input={gatewayToken:token,...order('pg-jsonb-buy-replay-0001',{type:'MARKET'})};
  const bought=await f.request('orders',{body:input});assert.equal(bought.status,200);
  assert.equal((await f.request('orders',{body:input})).status,200);
  const sold=await f.request('orders',{body:{gatewayToken:token,...order('pg-jsonb-immediate-sell-01',{type:'MARKET',side:'SELL',quantity:'0.05'})}});
  assert.equal(sold.status,200,JSON.stringify(sold));assert.equal(sold.data.wallets.USDT.cash,'726.25000000');
});

pg('read still rejects a real Session revocation between its two authorization fences',async t=>{
  const f=await fixture(t),before=await f.rows();let queries=0;
  const proxy={
    $queryRawUnsafe:async(query,...params)=>{queries++;const result=await f.db.$queryRawUnsafe(query,...params);if(query.startsWith('SELECT a."principalHash"'))await f.other.session.update({where:{id:f.sessions[0]},data:{revokedAt:new Date()}});return result;}
  };
  const {openPostgresAuthority}=await import('./postgres-authority.mjs');
  const authority=openPostgresAuthority(proxy,{issuer:f.actors[0].issuer,tradePrincipals:f.actors});
  await assert.rejects(authority.execute(f.actors[0],'readView'),/AUTH_REQUIRED/);
  assert.deepEqual(await f.rows(),before);t.diagnostic('read SQL statements, both authorization fences included: '+queries);
});

pg('joined read fences deny missing, mismatched, revoked and blocked identities without writes',async t=>{
  const f=await fixture(t),before=await f.rows();
  await assert.rejects(f.authority.execute({...f.actors[0],sessionId:f.sessions[1]},'read'),/AUTH_REQUIRED/);
  await assert.rejects(f.authority.execute({...f.actors[0],sessionId:'synthetic-missing-session'},'read'),/AUTH_REQUIRED/);
  await f.other.user.update({where:{id:f.users[0]},data:{blockedAt:new Date()}});
  await assert.rejects(f.authority.execute(f.actors[0],'readView'),/AUTH_REQUIRED/);
  await f.other.session.update({where:{id:f.sessions[1]},data:{revokedAt:new Date()}});
  await assert.rejects(f.authority.execute(f.actors[1],'readView'),/AUTH_REQUIRED/);
  assert.deepEqual(await f.rows(),before);
});

pg('provider-shaped fractional display change supports atomic pending Limit fills',async t=>{
  for(const change24h of [1.25,-2.75,0])await t.test('change24h='+change24h,async t=>{
    const f=await fixture(t),token=await f.ready();
    assert.equal((await f.request('orders',{body:{gatewayToken:token,...order('pg-provider-display-limit-01')}})).status,200);
    const before=await f.rows();f.advance(3000,'80');const quote={...await f.hub.quote(f.ID),change24h};
    await f.authority.execute(f.actors[0],'observe',quote);
    const after=await f.rows();assert.equal(after.cash[0].available.toFixed(8),'723.25000000');assert.equal(after.cash[0].locked.toFixed(8),'0.00000000');
    assert.equal(after.accounts[0].ledger.orders[0].status,'FILLED');assert.equal(after.accounts[0].ledger.quotes[f.ID].change24h,change24h);
    assert.equal(after.receipts.length,before.receipts.length+1);assert.equal(after.audit.length,before.audit.length+1);
    await f.authority.execute(f.actors[0],'observe',quote);assert.deepEqual(await f.rows(),after);
  });
});

pg('nonfinite display values and fractional numeric money remain rejected without durable effects',async t=>{
  const f=await fixture(t),token=await f.ready();await f.request('orders',{body:{gatewayToken:token,...order('pg-invalid-provider-limit-01')}});f.advance(3000,'80');const quote=await f.hub.quote(f.ID),before=await f.rows();
  for(const change24h of [NaN,Infinity,-Infinity])await assert.rejects(f.authority.execute(f.actors[0],'observe',{...quote,change24h}),/ACCOUNT_COMMAND_INVALID/);
  await assert.rejects(f.authority.execute(f.actors[0],'observe',{...quote,prices:{...quote.prices,USDT:{buy:1.25,sell:'80'}}}),/ACCOUNT_COMMAND_INVALID/);
  assert.deepEqual(await f.rows(),before);
});

pg('aborted undispatched observation through gateway and API cannot fill a pending Limit',async t=>{
  const f=await fixture(t),token=await f.ready();await f.request('orders',{body:{gatewayToken:token,...order('pg-abort-open-limit-0001')}});
  const entered=deferred(),release=deferred();let calls=0;f.setBefore(async()=>{if(++calls===1){entered.resolve();await release.promise;}});t.after(()=>release.resolve());
  const first=f.request('orders',{body:{gatewayToken:token,...order('pg-abort-held-command-01',{limitPrice:'70'})}});await entered.promise;
  f.advance(3000,'80');const controller=new AbortController();
  const observed=fetch(`http://127.0.0.1:${f.gateway.port}/__stocks_global/state?id=`+encodeURIComponent(f.ID),{headers:{authorization:'Bearer '+f.tokens[0]},signal:controller.signal});
  const aborted=assert.rejects(observed,/abort/i);await until(()=>f.authority.metrics().pending===2);controller.abort();await aborted;
  await new Promise(resolve=>setTimeout(resolve,100));release.resolve();assert.equal((await first).status,200);await until(()=>f.authority.metrics().pending===0);
  const after=await f.rows();assert.equal(after.cash[0].available.toFixed(8),'715.25000000');assert.equal(after.cash[0].locked.toFixed(8),'16.00000000');
  assert.equal(after.accounts[0].ledger.fills.length,0);assert.equal(after.receipts.length,2);assert.equal(after.audit.length,2);
});

pg('lost ACK replay uses the engine canonical decimals and conflicts only on a different intent',async t=>{
  const f=await fixture(t),token=await f.ready();let lose=true;f.setAfter(()=>{if(lose){lose=false;throw Error('synthetic lost ACK');}});
  const input=order('pg-equivalent-decimal-retry-01');assert.equal((await f.request('orders',{body:{gatewayToken:token,...input}})).data.error,'ACCOUNT_OUTCOME_UNKNOWN');const before=await f.rows();
  const {openPostgresAuthority}=await import('./postgres-authority.mjs'),reopened=openPostgresAuthority(f.other,{issuer:f.actors[0].issuer,tradePrincipals:f.actors});
  const replay=await reopened.execute(f.actors[0],'submitObserved',{order:{...input,quantity:'0.10000000',limitPrice:'90.00000000'},sourceBlocked:true});
  assert.deepEqual(replay.receipt,before.receipts[0].receipt);assert.deepEqual(await f.rows(),before);
  await assert.rejects(reopened.execute(f.actors[0],'submitObserved',{order:{...input,quantity:'0.2'},sourceBlocked:true}),/IDEMPOTENCY_CONFLICT/);assert.deepEqual(await f.rows(),before);
});

pg('separate failed observation occurrences remain durable across a fresh success and replay once',async t=>{
  const f=await fixture(t),token=await f.ready();await f.request('orders',{body:{gatewayToken:token,...order('pg-failure-occurrence-limit-01',{limitPrice:'70'})}});
  await f.authority.execute(f.actors[0],'observeFailed',{id:f.ID},{occurrenceId:'fixture-failure-occurrence-one'});
  assert.equal((await f.rows()).accounts[0].ledger.quotes[f.ID].failed,true);
  f.advance(3000);await f.authority.execute(f.actors[0],'observe',await f.hub.quote(f.ID),{occurrenceId:'fixture-success-occurrence-two'});
  assert.notEqual((await f.rows()).accounts[0].ledger.quotes[f.ID].failed,true);
  const failed=await f.authority.execute(f.actors[0],'observeFailed',{id:f.ID},{occurrenceId:'fixture-failure-occurrence-three'});
  const after=await f.rows();assert.equal(after.accounts[0].ledger.quotes[f.ID].failed,true);assert.equal(after.accounts[0].revision,4);assert.equal(after.receipts.length,4);assert.equal(after.audit.length,4);
  const replay=await f.authority.execute(f.actors[0],'observeFailed',{id:f.ID},{occurrenceId:'fixture-failure-occurrence-three'});assert.deepEqual(replay.receipt,failed.receipt);assert.deepEqual(await f.rows(),after);
  await assert.rejects(f.authority.execute(f.actors[0],'observeFailed',{id:'BINANCE:AAPLBUSDT'},{occurrenceId:'fixture-failure-occurrence-three'}),/IDEMPOTENCY_CONFLICT/);assert.deepEqual(await f.rows(),after);
});

pg('abort after observation activation leaves its real atomic COMMIT intact',async t=>{
  const f=await fixture(t),token=await f.ready();await f.request('orders',{body:{gatewayToken:token,...order('pg-active-observation-limit-01')}});
  f.advance(3000,'80');const quote=await f.hub.quote(f.ID),entered=deferred(),release=deferred(),controller=new AbortController();
  f.setBefore(async()=>{entered.resolve();await release.promise;});t.after(()=>release.resolve());
  const active=f.authority.execute(f.actors[0],'observe',quote,{signal:controller.signal,occurrenceId:'fixture-active-observation-commit'});await entered.promise;controller.abort();release.resolve();
  const result=await active;assert.ok(result.receipt);const after=await f.rows();assert.equal(after.cash[0].available.toFixed(8),'723.25000000');assert.equal(after.cash[0].locked.toFixed(8),'0.00000000');assert.equal(after.accounts[0].ledger.fills.length,1);assert.equal(after.receipts.length,2);assert.equal(after.audit.length,2);
});

pg('second server gate OFF (the production default): both bound traders are refused and nothing is reserved or written',async t=>{
  const f=await fixture(t,{orderExecutionEnabled:false}),before=await f.rows(),refusals=[];
  for(const index of [0,1]){
    const token=(await f.request('state?id='+encodeURIComponent(f.ID),{index})).data?.token;
    const placed=await f.request('orders',{index,body:{gatewayToken:token??'none',...order('pg-gate-off-market-0'+index,{type:'MARKET'})}});
    assert.notEqual(placed.status,200,JSON.stringify(placed));refusals.push(placed.status);
  }
  assert.deepEqual(await f.rows(),before);
  t.diagnostic('refusals '+refusals.join(','));
});
