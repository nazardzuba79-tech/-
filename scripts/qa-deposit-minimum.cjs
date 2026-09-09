/** Local production-bundle QA. Real deposit GET routes, explicit fixtures for
 * accounts/prices/treasury. No production credentials or database connection.
 * Run after backend compile and frontend build; opens a loopback server only.
 * Browser entry: /wallet?action=deposit (Wallet UI), /otc (nav deposit UI).
 * /qa/no-price and /qa/normal switch the controlled price scenario.
 */
const fs=require('fs'),path=require('path'),{randomBytes}=require('crypto');
process.env.JWT_SECRET=randomBytes(32).toString('hex');delete process.env.DATABASE_URL;
for(const chain of ['BITCOIN','TRON','ETHEREUM','BSC','SOLANA','TON']) {
  delete process.env[chain+'_TREASURY_ADDRESS'];delete process.env[chain+'_NATIVE_ASSET'];delete process.env[chain+'_TOKENS'];
}
Object.assign(process.env,{TRON_NATIVE_ASSET:'TRX',TRON_TOKENS:'USDT:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t:6',BITCOIN_NATIVE_ASSET:'BTC',ETHEREUM_NATIVE_ASSET:'ETH'});
const express=require('express'),jwt=require('jsonwebtoken');
const {depositsRouter}=require('../dist/api/routes/deposits');
const {TronDepositVerifier}=require('../dist/services/deposit-verifiers/TronDepositVerifier');
const app=express();let scenario='normal';
const db={treasuryWallet:{findUnique:async({where})=>['tron','bitcoin','ethereum'].includes(where.chain)?{address:'QA_ONLY_DO_NOT_SEND_FUNDS_'+where.chain.toUpperCase()}:null},
  deposit:{findMany:async()=>[]},session:{findUnique:async()=>({id:'qa',userId:'qa',revokedAt:null,lastSeenAt:new Date()})}};
app.use((req,res,next)=>req.method==='GET'||req.method==='HEAD'?next():res.sendStatus(405));
app.use('/api/v1',depositsRouter(db,{getTicker:async()=>null}));
app.get('/api/v1/me',(_req,res)=>res.json({id:'qa',email:'qa@example.invalid',displayName:'QA',avatarUrl:null,isAdmin:false,kycStatus:'NOT_STARTED'}));
app.get('/api/v1/wallet/overview',(_req,res)=>res.json({real:{spot:[],futures:[],spotValueUsd:0,futuresValueUsd:0,totalValueUsd:0},presentation:null,displayTotalUsd:0,displaySpotUsd:0,displayFuturesUsd:0,btcPriceUsd:null}));
app.get('/api/v1/wallet/performance',(_req,res)=>res.json({periods:Object.fromEntries(['7d','30d','90d','1y','all'].map(period=>[period,{period,available:false,startDate:null,endDate:null,startEquity:null,endEquity:null,absolutePnl:null,percent:null,points:[]}])),ageDays:0,startedOn:null}));
app.get('/api/v1/market/snapshot',(_req,res)=>res.json({tickers:{available:true,value:[],stale:false,fetchedAt:Date.now(),source:'qa'},overview:{available:false,reason:'qa'},sentiment:{available:false,reason:'qa'}}));
app.get('/api/v1/market/external/rankings',(_req,res)=>res.json({source:'qa',rankings:[]}));
app.get('/api/v1/market/external/tickers/:pair', (req,res)=>res.json(scenario==='no-price'?{source:'qa',ticker:null}:{source:'qa-controlled-price',ticker:{pair:req.params.pair,lastPrice:req.params.pair.startsWith('BTC')?'50000':'2500'}}));
app.get('/api/v1/market/external/tickers',(_req,res)=>res.json({tickers:[]}));
app.get('/api/v1/support/conversations/mine',(_req,res)=>res.json({conversation:null}));
app.use('/api',(_req,res)=>res.json([]));
app.get('/qa/:scenario',(req,res)=>{if(!['normal','no-price'].includes(req.params.scenario))return res.sendStatus(400);scenario=req.params.scenario;res.redirect('/wallet?action=deposit');});
const dist=path.resolve('frontend/dist');app.use(express.static(dist,{index:false}));
const token=jwt.sign({sub:'qa',sid:'qa'},process.env.JWT_SECRET,{expiresIn:'2h'});
app.get('*',(_req,res)=>res.type('html').send(fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<head>',`<head><script>localStorage.setItem('exchange_token',${JSON.stringify(token)});</script>`)));
const server=app.listen(0,'127.0.0.1',()=>console.log('Deposit QA server http://127.0.0.1:'+server.address().port));

// Optional public-provider probe. This verifies format compatibility only,
// never an exchange production deposit. Export booleans, never addresses/hash.
if(process.env.QA_TRONGRID_PROBE==='1') (async()=>{
  const response=await fetch('https://api.trongrid.io/v1/contracts/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t/events?event_name=Transfer&limit=1&only_confirmed=true',{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Public TronGrid probe unavailable');const payload=await response.json();const event=payload.data?.[0];
  if(!event)throw Error('No public Transfer event');
  const verifier=new TronDepositVerifier({chain:'tron',type:'tron',nativeAsset:'TRX',treasuryAddress:event.result.to,minConfirmations:19,tokens:{USDT:{contractAddress:'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',decimals:6}}});
  const result=await verifier.verify(event.transaction_id,'USDT');
  const audit={publicTronGridTransferVerified:result.amount.isPositive(),recipientWasHex:/^(0x)?[0-9a-f]{40,42}$/i.test(event.result.to),confirmationsAtLeast19:result.confirmations>=19,productionExchangeDepositProven:false};
  const output=path.resolve(process.env.QA_OUTPUT_DIR||'node_modules/.cache/deposit-qa');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'public-trongrid-probe.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit));
})().catch(()=>console.log('Public TronGrid probe failed; no production end-to-end claim made'));
