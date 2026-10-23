'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{loopback,database,args,comparison,percentile}=require('./policy.cjs');
test('admission rejects production-like, credentialed and implicit endpoints',()=>{
 for(const u of ['https://example.com','http://198.51.100.1:3000','http://localhost:3000','http://127.0.0.1:80','http://user:pass@127.0.0.1:3000'])assert.throws(()=>loopback(u));
 assert.equal(loopback('http://127.0.0.1:32100').hostname,'127.0.0.1');
});
test('database admission requires fresh owned role/name and loopback port',()=>{
 const n='stocks_disposable_rc50_abcdef123456_baseline';
 assert.equal(database('postgresql://stocks_fixture@127.0.0.1:32101/'+n,n).hostname,'127.0.0.1');
 for(const u of ['postgresql://stocks_fixture@127.0.0.1:5432/production','postgresql://stocks_fixture:secret@127.0.0.1:32101/'+n,'postgresql://root@example.com:32101/'+n])assert.throws(()=>database(u,n));
});
test('unknown remote/configuration arguments fail closed',()=>{
 assert.throws(()=>args(['--url','https://example.com']));assert.throws(()=>args(['--root','a','--root','b']));assert.equal(args(['--prepare-only'])['prepare-only'],true);
});
function arm(){return{cryptoLatencies:Array(240).fill(100),cryptoJobs:80,traceSha:'same',timeouts:0,unexpectedErrors:0,missedJobs:0,orderLoss:0,doubleSpend:0,viewerMutations:0,viewerCount:50,traderCount:2};}
test('nearest-rank p95 preserves the strict +5% gate',()=>{
 assert.equal(percentile([4,1,3,2],.95),4);const a=arm(),b=arm();b.cryptoLatencies.fill(105);assert.equal(comparison(a,b).status,'PASS_LOCAL_DIAGNOSTIC');b.cryptoLatencies.fill(105.001);assert.equal(comparison(a,b).status,'FAIL_LOCAL_DIAGNOSTIC');
});
test('zero-error gates cannot hide timeout, lost order, debit or missed arrival',()=>{
 for(const key of ['timeouts','unexpectedErrors','missedJobs','orderLoss','doubleSpend','viewerMutations']){const a=arm(),b=arm();b[key]=1;assert.equal(comparison(a,b).status,'FAIL_LOCAL_DIAGNOSTIC',key);}
});
test('unmatched crypto trace or wrong population cannot pass',()=>{
 for(const key of ['traceSha','cryptoJobs','viewerCount','traderCount']){const a=arm(),b=arm();b[key]=key==='traceSha'?'different':999;assert.equal(comparison(a,b).status,'FAIL_LOCAL_DIAGNOSTIC');}
});
test('local diagnostic never certifies target acceptance',()=>assert.equal(comparison(arm(),arm()).targetAcceptance,false));
test('egress fence denies non-loopback fetch before network activity',()=>{
 const cp=require('node:child_process'),path=require('node:path');const result=cp.spawnSync(process.execPath,['--require',path.join(__dirname,'network-guard.cjs'),'-e',"try{fetch('https://example.com');process.exit(9)}catch(e){console.log(e.message)}"],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0);assert.match(result.stdout,/EXTERNAL_FETCH_DENIED/);
});

test('independent cash/order checks detect double debit and accepted order loss',()=>{
 const {invariants}=require('./driver.cjs');
 const before={cash:[{available:'100',locked:'0'},{available:'100',locked:'0'}],accounts:[{orders:[]},{orders:[]}],cryptoOrders:[]};
 const after=()=>({cash:[{available:'100',locked:'0'},{available:'100',locked:'0'}],accounts:[{orders:[],positions:[]},{orders:[],positions:[]}],receipts:[],cryptoOrders:[],viewerBalances:0,accountCount:2,network:{blocked:0}});
 const expected={crypto:[],stock:[[],[]]};
 assert.equal(invariants(before,after(),expected).doubleSpend,0);
 const debited=after();debited.cash[0].available='99';assert.equal(invariants(before,debited,expected).doubleSpend,1);
 const lost=after();assert.equal(invariants(before,lost,{crypto:['acknowledged-id'],stock:[[],[]]}).orderLoss,1);
 const unauthorized=after();unauthorized.viewerBalances=1;assert.equal(invariants(before,unauthorized,expected).viewerMutations,1);
});

