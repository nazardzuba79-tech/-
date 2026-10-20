const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,disposableUrl}=require('./testing/disposable-postgres.cjs');
const opts={timeout:30000,skip:disposableUrl()?false:'NOT_RUN: disposable local PostgreSQL required'};

async function login(f,index){
  const response=await fetch(f.apiOrigin+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email:f.users[index]+'@example.invalid',password:f.loginPassword})});
  assert.equal(response.status,200);const body=await response.json();assert.ok(body.token);
  return body.token;
}
test('normal password/session login shares existing PG DemoBalance and enforces both principals, viewer and logout',opts,async t=>{
  const f=await fixture(t,{normalLogin:true,releaseRouter:true,wallClock:true});
  const before=await f.rows(),tokens=await Promise.all([login(f,0),login(f,1)]);
  assert.deepEqual(await f.rows(),before,'login cannot create or change Stocks/cash rows');
  for(const index of [0,1]){
    const token=tokens[index],csrf=await f.ready(index,token);
    const initial=(await f.request('state?id='+encodeURIComponent(f.ID),{token})).data;
    const id=require('node:crypto').randomUUID();
    const order={gatewayToken:csrf,instrumentId:f.ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1',id};
    const buy=await f.request('orders',{token,body:order});
    assert.equal(buy.status,200,buy.data.error);assert.equal(buy.data.positions[f.ID+'|USDT'].quantity,'0.10000000');
    assert.equal(Number(buy.data.wallets.USDT.cash),Number(initial.wallets.USDT.cash)-10);
    const dbCash=await f.db.demoBalance.findUnique({where:{userId_asset:{userId:f.users[index],asset:'USDT'}}});
    assert.equal(Number(dbCash.available),Number(buy.data.wallets.USDT.cash));
    const replay=await f.request('orders',{token,body:order});
    assert.equal(replay.status,200);assert.deepEqual(replay.data.wallets,buy.data.wallets);
    await f.ready(index,token);
    const sell=await f.request('orders',{token,body:{...order,side:'SELL',id:require('node:crypto').randomUUID()}});
    assert.equal(sell.status,200,sell.data.error);assert.equal(sell.data.positions[f.ID+'|USDT'].quantity,'0.00000000');
    assert.equal(sell.data.wallets.USDT.cash,initial.wallets.USDT.cash);
  }
  const viewer=await f.newViewer('hosted');
  const snapshot=await f.rows(),csrf=await f.ready(0,viewer.token);
  const denied=await f.request('orders',{token:viewer.token,body:{gatewayToken:csrf,id:require('node:crypto').randomUUID(),instrumentId:f.ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1'}});
  assert.equal(denied.status,401);assert.deepEqual(await f.rows(),snapshot);
  assert.equal((await fetch(f.apiOrigin+'/api/v1/auth/logout',{method:'POST',headers:{authorization:'Bearer '+tokens[0]}})).status,200);
  assert.equal((await f.request('state?id='+encodeURIComponent(f.ID),{token:tokens[0]})).status,401);
  assert.equal((await f.request('state?id='+encodeURIComponent(f.ID),{token:tokens[1]})).status,200);
});
test('catalogue-only PG identity authenticates normal login while all financial routes remain disabled',opts,async t=>{
  const {createReleaseMarket}=await import('./release-market.mjs');
  const f=await fixture(t,{normalLogin:true,releaseRouter:true,financialEnabled:false,hub:createReleaseMarket({})});
  const before=await f.rows(),token=await login(f,0);
  const catalogue=await f.request('catalogue',{token});
  assert.equal(catalogue.status,200);assert.ok(catalogue.data.catalogue.every(row=>!row.online&&!row.display));
  const state=await f.request('state?id='+encodeURIComponent(f.ID),{token});
  assert.equal(state.status,200);assert.equal(state.data.account.canTrade,false);
  assert.deepEqual(state.data.quotes,{});
  const forged=await fetch(f.apiOrigin+'/api/v1/stocks-test-cash/command',{method:'POST',headers:{
    authorization:'Bearer '+token,'x-stocks-authority-key':f.gatewayKey,'content-type':'application/json'},body:JSON.stringify({type:'ensure'})});
  assert.equal(forged.status,403);assert.equal((await forged.json()).error,'STOCKS_TRADING_DISABLED');
  const denied=await f.request('orders',{token,body:{gatewayToken:state.data.token,id:'forged-order'}});
  assert.equal(denied.status,401);assert.deepEqual(await f.rows(),before);
});
