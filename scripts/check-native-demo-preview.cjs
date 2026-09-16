/**
 * End-to-end API check of the ISOLATED native demo preview (never production).
 * Usage: PREVIEW_ORIGIN=https://… [EXPECTED_COMMIT=sha] [WAIT_FOR_COMMIT_MS=900000] [ALLOW_FIXTURE_MARKET=1] node scripts/check-native-demo-preview.cjs
 */
const fs=require('fs'),assert=require('assert/strict'),{randomUUID}=require('crypto');
const origin=(process.env.PREVIEW_ORIGIN||'https://voltex-native-demo-review.onrender.com').replace(/\/$/,'');
const expectedCommit=process.env.EXPECTED_COMMIT||'';
const waitForCommitMs=Number(process.env.WAIT_FOR_COMMIT_MS||0);
const report={origin,productionVerified:false,isolatedPreview:true,expectedCommit:expectedCommit||null,checks:[]};
const pass=name=>{report.checks.push(name);console.log('✓',name);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,options={}){
  const r=await fetch(origin+path,{...options,signal:AbortSignal.timeout(90000)});
  const text=await r.text();let body=null;try{body=JSON.parse(text);}catch{body=text;}
  return{status:r.status,ok:r.ok,body};
}
async function json(path,options={}){
  const r=await request(path,options);
  assert(r.ok,`${options.method||'GET'} ${path} -> ${r.status} ${JSON.stringify(r.body).slice(0,400)}`);
  return r.body;
}
(async()=>{
  let health=await json('/health');
  for(const started=Date.now();expectedCommit&&health.commit!==expectedCommit&&Date.now()-started<waitForCommitMs;){
    console.log(`waiting for deploy of ${expectedCommit.slice(0,8)} (serving ${String(health.commit).slice(0,8)})`);
    await sleep(20000);health=await json('/health');
  }
  report.health=health;
  assert.equal(health.kind,'isolated-native-demo-preview');
  if(process.env.ALLOW_FIXTURE_MARKET!=='1')assert.equal(health.fixtureMarket,false,'preview must use actual public mainnet market data');
  if(expectedCommit)assert.equal(health.commit,expectedCommit,'preview is not serving the commit under review');
  pass(`isolated preview healthy (commit ${String(health.commit).slice(0,8)})`);

  const page=await fetch(origin+'/futures?demo=1',{signal:AbortSignal.timeout(90000)});assert(page.ok);
  const html=await page.text();const m=/localStorage\.setItem\("exchange_token",("[^"]+")\)/.exec(html);assert(m,'preview session token not issued');
  assert(/<div id="root">/.test(html),'terminal SPA shell missing');
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+JSON.parse(m[1])};
  const command=(body)=>json('/api/v1/private-trading/native/commands',{method:'POST',headers,body:JSON.stringify({idempotencyKey:randomUUID(),...body})});

  let s=await json('/api/v1/private-trading/native/state',{headers});
  assert.equal(s.initialized,false);
  assert.deepEqual(s.model.funding,{longCashflow:'-0.001',shortCashflow:'0.004',unit:'FRACTION',intervalMs:28800000});
  assert.equal(s.model.fundingSource,'CUSTOM_DEMO_MODEL');assert.equal(s.model.marginMode,'CROSS');
  s=await json('/api/v1/private-trading/native/initialize',{method:'POST',headers,body:JSON.stringify({idempotencyKey:'preview-check-'+randomUUID(),acceptedModel:s.model.version})});
  assert.equal(s.source,'PREVIEW_FIXTURE');
  // `walletBalance` became `settleBalance` when the wallet's OTHER assets
  // started counting as Cross collateral and one name meant two quantities.
  assert.equal(s.account.settleBalance,'10000000');
  // The non-settle holding is priced through the market-data path, so it is a
  // real number rather than zero, and collateral is the sum of the two halves
  // — the settle row is counted once, in the ledger, not twice.
  assert(Number(s.account.walletCollateral)>0,'Preview wallet collateral was not priced');
  // The identity, not its decimal spelling: the server prints exact decimal
  // strings and float addition here would disagree on the last digit for a
  // large wallet without anything actually being wrong.
  assert(Math.abs(Number(s.account.collateral)-(Number(s.account.settleBalance)+Number(s.account.walletCollateral)))<1e-6,
    'Collateral is not the settle ledger plus the wallet valuation');
  assert.equal(s.account.collateralComplete,true);
  assert.deepEqual(s.account.unpricedAssets,[]);
  assert.equal(s.ledger.reconciled,true);
  assert.equal(s.ledger.closingBalance,s.account.settleBalance);
  pass('fresh isolated Cross account initialized with custom funding model disclosed');

  // Live market long 5,000 x 10 on actual public depth.
  s=await command({kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',margin:'5000',leverage:'10'});
  assert.equal(s.positions.length,1);const live=s.positions[0];
  assert.equal(live.historical,false);assert.equal(live.marginMode,'CROSS');assert.equal(live.liquidationPrice,null,'10M collateral should keep a 5k/10x long far from liquidation');
  assert(Number(live.quantity)>0&&Number(live.entryPrice)>0);
  pass(`live market long filled ${live.quantity} @ ${live.entryPrice}`);

  const mark=Number(live.markPrice);
  s=await command({kind:'PROTECTION',positionId:live.id,protection:{takeProfit:(Math.round(mark*1.5*10)/10).toFixed(1),stopLoss:(Math.round(mark*0.5*10)/10).toFixed(1),triggerBy:'MARK'}});
  assert.notEqual(s.positions[0].protection.takeProfit,null);
  s=await command({kind:'PROTECTION',positionId:live.id,protection:{takeProfit:null}});
  assert.equal(s.positions[0].protection.takeProfit,null);assert.notEqual(s.positions[0].protection.stopLoss,null);
  pass('TP/SL added, TP removed, SL kept');

  s=await command({kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'LIMIT',price:(Math.floor(mark*0.5)).toFixed(1),margin:'1000',leverage:'10'});
  const resting=s.orders.find(o=>o.status==='OPEN');assert(resting,'far limit should rest');
  assert(Number(s.account.orderReserve)>0);
  s=await command({kind:'CANCEL',orderId:resting.id});
  assert.equal(s.orders.find(o=>o.id===resting.id).status,'CANCELLED');assert.equal(s.account.orderReserve,'0');
  pass('limit rested with reserve, then cancelled and released');

  const step=Number(live.quantity)>=0.002?'0.001':null;
  if(step){s=await command({kind:'CLOSE',positionId:live.id,quantity:step});assert(s.events.some(e=>e.kind==='CLOSE'&&e.quantity===step));pass('partial market close');}

  const chart=await json('/api/v1/private-trading/candles?symbol=BTCUSDT&source=BYBIT_LINEAR&interval=1h&limit=12',{headers});
  assert.equal(chart.source,'BYBIT_LINEAR');assert(chart.candles.length>=8);
  const entry=chart.candles[chart.candles.length-6],exit=chart.candles[chart.candles.length-3];
  s=await command({kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',margin:'5000',leverage:'10',candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:entry.time*1000,pricePoint:'CLOSE'}});
  const hist=s.positions.find(p=>p.historical);assert(hist,'historical position missing');
  assert.equal(Number(hist.entryPrice),entry.close);assert.notEqual(hist.unrealizedPnl,null);assert.equal(hist.openedAt,(entry.time+3600)*1000);
  assert(s.entries.some(e=>e.positionId===hist.id&&e.candle.openTime===entry.time*1000));
  assert.equal(s.positions.filter(p=>!p.historical).length,1,'historical entry must not merge into the live position');
  pass(`historical long at actual 1h close ${entry.close} with immediate P&L ${hist.unrealizedPnl}`);

  const wick=chart.candles[chart.candles.length-5],limit=(Math.ceil(((wick.low+wick.open)/2)*10)/10).toFixed(1);
  s=await command({kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'LIMIT',price:limit,margin:'2000',leverage:'10',candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:wick.time*1000,pricePoint:'CLOSE'}});
  const touched=s.positions.find(p=>p.historical&&p.id!==hist.id);
  if(Number(limit)>=wick.low){assert(touched,'buy limit above the candle low must fill');assert(Number(touched.entryPrice)<=Number(limit));}
  pass(`historical buy limit ${limit} on candle low ${wick.low}: filled at ${touched?.entryPrice}`);

  s=await command({kind:'CLOSE',positionId:hist.id,candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:exit.time*1000,pricePoint:'CLOSE'}});
  const closed=s.history.find(p=>p.id===hist.id);assert(closed,'historical exit missing');assert.equal(closed.closedAt,(exit.time+3600)*1000);
  pass(`historical exit at later candle close; net ${closed.netPnl}`);

  const again=await json('/api/v1/private-trading/native/state',{headers});
  assert.equal(again.revision,s.revision);assert.deepEqual(again.positions.map(p=>p.id),s.positions.map(p=>p.id));
  pass('reload returns the persisted revision');

  const card=await json('/api/v1/private-trading/native/cards',{method:'POST',headers,body:JSON.stringify({positionId:closed.id})});
  const frozen=await json(`/api/v1/private-trading/native/cards/${card.revision}/${encodeURIComponent(closed.id)}`,{headers});
  assert.deepEqual(frozen,card);assert.equal(card.status,'CLOSED');
  pass('P&L card frozen by revision');

  const noAuth=await request('/api/v1/private-trading/native/state');assert.equal(noAuth.status,401);
  const denied=await request('/api/v1/futures/orders',{method:'POST',headers,body:'{}'});assert.equal(denied.status,403);
  pass('unauthenticated native state and real trading writes denied');
  report.passed=true;
})().catch(e=>{report.passed=false;report.error=String(e&&e.message||e);process.exitCode=1;console.error(e);})
  .finally(()=>{fs.writeFileSync('preview-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));});
