'use strict';
// Execute the ACTUAL release bytes at their intended browser origin. Every
// network request is intercepted; fixtures must never conceal a wrong origin.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { audit, profiles, root } = require('./wallet591-frontend-artifact.cjs');
const profile = process.argv[2] || 'production', config = profiles[profile];
assert(config, 'Unknown profile');
const dist = path.join(root, 'output', `wallet591-${profile}-dist`);
const out = path.join(root, 'output', `wallet591-${profile}-qa`);
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.json':'application/json'};
const syntheticToken = 'isolated-release-fixture-not-a-production-token';
const balances = [{asset:'USDT',available:'123.45',locked:'0'}];
const me = {id:'fixture-only',email:'qa@example.invalid',displayName:'Isolated release QA',isAdmin:true,role:'ADMIN',kycStatus:'NOT_STARTED',twoFactorEnabled:false,createdAt:'2026-01-01T00:00:00Z'};
const now = Date.now();
const cardYield = {annualRate:'0.12',asset:'USDT',locked:false,availableCardBalance:null,accruedReward:null,dataStatus:'UNAVAILABLE',reason:'QA_NO_CARD_BALANCE'};
const programs = [{id:'MONTHLY_17_24M',name:'Monthly fixture',monthlyRate:'0.12',termMonths:12,minUsd:'2500',assets:['USDT'],compound:false,payoutFrequency:'MONTHLY',lockRule:'PRINCIPAL_RETURN_UNDEFINED',enabled:true}];
const gateway = value => ({available:true,value,source:'ISOLATED_FIXTURE',fetchedAt:now,stale:false});
function fixture(p) {
  const x=p.replace(/^\/api\/v1/,'').replace(/^\/_voltex\/market/,'');
  if(x==='/me') return me;
  if(x==='/admin/users/page') return {items:[],total:0,page:1,pageSize:20,totalPages:1,asOf:new Date(now).toISOString()};
  if(x==='/admin/spam-emails') return {entries:[]};
  if(x==='/admin/deposit-address-copies') return {pendingCount:0};
  if(x==='/private-trading/access') return {allowed:false,nativeAvailable:false,simulationOnly:false};
  if(x==='/private-trading/native/wallet') return {available:false};
  if(x.startsWith('/market/derivatives/')) return {available:false,reason:'ISOLATED_FIXTURE'};
  if(x==='/market/display/spot-snapshot') return fixture('/market/snapshot');
  if(x==='/market/display') return {type:'snapshot',rows:[]};
  if(x==='/market/display/spot-tickers')return {source:'ISOLATED_FIXTURE',tickers:[]};
  if(x.startsWith('/market/display/spot-trades/'))return {pair:'BTC/USDT',trades:[]};
  if(x==='/cfd/display/tickers')return {source:'ISOLATED_FIXTURE',configured:true,tickers:[]};
  if(x.startsWith('/market/display/spot-book/')) return {pair:'BTC/USDT',bids:[],asks:[],source:'ISOLATED_FIXTURE',updatedAt:now};
  if(x.startsWith('/market/display/spot-candles/')) return {pair:'BTC/USDT',interval:'15m',candles:[],source:'ISOLATED_FIXTURE'};
  if(x.startsWith('/market/display/futures-')) return {retCode:0,result:{category:'linear',symbol:'BTCUSDT',list:[]},time:now};
  if(x==='/admin/work-summary') return {asOf:new Date(now).toISOString(),widgets:Object.fromEntries(['readyPackages','pendingPackages','unlinkedTransfers','activeWithdrawals','pendingKyc','openOtc','totalUsers','newUsers24h'].map(k=>[k,{value:0,unit:'count',href:'/admin/users',status:'ready',asOf:new Date(now).toISOString()}]))};
  if(x==='/wallet/overview') return {real:{spot:balances,futures:[],spotValueUsd:123.45,futuresValueUsd:0,totalValueUsd:123.45},valuationComplete:true,unpricedAssets:[],btcPriceUsd:80000};
  if(x==='/wallet/performance') return {periods:Object.fromEntries(['7d','30d','90d','1y','all'].map(period=>[period,{period,available:false,startDate:null,endDate:null,startEquity:null,endEquity:null,absolutePnl:null,percent:null,points:[]}])),ageDays:0,startedOn:null};
  if(x==='/wallet/portfolio-history') return {points:[]};
  if(x==='/balances'||x==='/futures/balances') return balances;
  if(x==='/kyc/me') return {kycStatus:'NOT_STARTED',latestSubmission:null,materialRequest:null};
  if(x==='/banking/config') return {programs,assets:[{asset:'USDT',priceUsd:'1',minimumAssetQty:'2500'}],rewardCurrencyRule:'SAME_AS_DEPOSIT_ASSET',usdValuesAreReferenceOnly:true,cardYield};
  if(x==='/banking/state') return {placements:[],ledger:[],summary:{totalUsd:'0',accruedUsd:'0',activeCount:0},cardYield};
  if(x==='/banking/referral') return {referralCode:'ISOLATED',referralPercent:20,referredCount:0,rewardsByAsset:[],recentRewards:[]};
  if(x==='/futures/config') return {symbols:['BTCUSDT'],minLeverage:1,maxLeverage:125,fundingIntervalHours:8,highLeverageWarningThreshold:50,leverageTiers:[{notionalCap:null,maxLeverage:125,maintenanceMarginRate:.005,maintenanceAmount:0}]};
  if(x==='/market/universe') return gateway({instruments:[]});
  if(x==='/market/assets') return gateway({assets:[],matched:0,catalogueTotal:0,tradableCount:0,collisions:[],metadataComplete:true,limit:100,offset:0});
  if(x==='/market/assets/icons') return {icons:{}};
  if(x==='/market/snapshot') return {tickers:gateway([]),overview:{available:false,reason:'FIXTURE'},sentiment:{available:false,reason:'FIXTURE'}};
  if(['/market/listings','/market/nrx','/market/test-assets'].includes(x)) return {serverTime:now,assets:[]};
  if(x==='/market/pairs') return [{pair:'BTC/USDT',base:'BTC',quote:'USDT'}];
  if(x==='/market/external/symbols') return {source:'FIXTURE',symbols:[{pair:'BTC/USDT',baseAsset:'BTC',quoteAsset:'USDT'}]};
  if(x==='/market/external/tickers') return {source:'FIXTURE',tickers:[]};
  if(x==='/market/external/rankings') return {source:'FIXTURE',rankings:[]};
  if(x==='/market/global') return {source:'FIXTURE',global:null,fearGreed:null};
  if(x.includes('/orderbook')) return {bids:[],asks:[],source:'FIXTURE',updatedAt:now};
  if(x.includes('/candles')) return {candles:[],source:'FIXTURE'};
  if(x.startsWith('/futures/mark-price')) return {symbol:'BTCUSDT',markPrice:'80000',indexPrice:'80000'};
  if(x.startsWith('/futures/open-interest')) return {symbol:'BTCUSDT',openInterest:'0'};
  if(x.startsWith('/futures/funding-rate')) return {symbol:'BTCUSDT',fundingRate:'0',nextFundingTime:now+3600000,history:[]};
  if(x==='/support/conversations/mine') return {conversation:null};
  if(['/admin/users','/orders/me','/futures/orders/me','/futures/positions','/futures/positions/history','/wallet/activity','/transactions','/deposits','/withdrawals','/deposits/me','/withdrawals/me','/security-log','/demo/balances'].includes(x)) return [];
  return undefined;
}
async function main() {
  fs.mkdirSync(out,{recursive:true});
  const artifact = audit(dist,profile), cases=[], requests=[], violations=[], pageErrors=[], unknown=[];
  const browser = await chromium.launch(process.env.QA_BROWSER_EXECUTABLE ? {executablePath:process.env.QA_BROWSER_EXECUTABLE} : {});
  async function session(width, options={}) {
    const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',locale:'en-US'});
    await ctx.addInitScript(({token,lang})=>{if(token)localStorage.setItem('exchange_token',token);localStorage.setItem('exchange_lang',lang);},{token:options.guest?null:syntheticToken,lang:options.lang||'en'});
    await ctx.routeWebSocket('**/*',s=>s.close());
    await ctx.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url()),p=u.pathname;
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':config.origin,'access-control-allow-headers':'authorization,content-type'},body:JSON.stringify(body)});
      const isApi=p.startsWith('/api/v1/');
      if(isApi) {
        const expected=new URL(config.env.VITE_API_URL);
        if(u.origin!==expected.origin) {violations.push({kind:'WRONG_API_ORIGIN',url:u.origin+p});return route.abort();}
        if(/conversion/.test(p)){violations.push({kind:'CONVERSION_REQUEST',path:p});return route.abort();}
        // Existing Wallet automatically requests a snapshot. ACK only in this
        // isolated route handler; never forward it or mutate a real ledger.
        if(req.method()==='POST'&&p==='/api/v1/wallet/portfolio-snapshot')return json({recorded:false,reason:'ISOLATED_NO_WRITES'});
        if(!['GET','HEAD','OPTIONS'].includes(req.method())){violations.push({kind:'WRITE_BLOCKED',path:p});return route.abort();}
        if(req.method()==='OPTIONS')return json({},204);
        let status=200;
        if(p==='/api/v1/private-trading/native/wallet')status=403;
        if(p==='/api/v1/me'&&options.meStatus)status=options.meStatus;
        if(options.failPaths?.includes(p))status=503;
        const body=fixture(p);
        if(status===200&&body===undefined)status=501;
        requests.push({width,path:p,origin:u.origin,status,scenario:options.meStatus||options.lang||'success'});
        if(status==='network')return route.abort('failed');
        if(status!==200&&status!==501)return json({error:'ISOLATED_FAILURE',code:status===403?'private_access_denied':'ISOLATED_FAILURE'},status);
        if(body===undefined){unknown.push(p);return json({error:'UNMAPPED_FIXTURE'},501);}
        return json(body);
      }
      const market=new URL(config.env.VITE_MARKET_EDGE_URL);
      if((u.origin===market.origin&&(u.origin!==config.origin||p.startsWith('/_voltex/market/')))||u.origin==='https://market.voltextech.net') {
        const body=fixture(p);if(body!==undefined)return json(body);
        unknown.push(u.origin+p);return json({error:'UNMAPPED_MARKET_FIXTURE'},501);
      }
      if(u.origin===config.origin) {
        const rel=decodeURIComponent(p).replace(/^\//,'');
        let file=path.resolve(dist,rel);
        if(!file.startsWith(dist+path.sep))file=path.join(dist,'index.html');
        if(!fs.existsSync(file)||!fs.statSync(file).isFile()) {
          if(path.extname(p)){violations.push({kind:'MISSING_ASSET',path:p});return route.fulfill({status:404,body:''});}
          file=path.join(dist,'index.html');
        }
        let bytes=fs.readFileSync(file);
        if(options.corrupt&&file.endsWith('.js'))bytes=Buffer.from(bytes.toString().split(config.env.VITE_API_URL).join('https://wrong-api.invalid/api/v1'));
        return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:bytes});
      }
      // Explicitly blocked third-party imagery/analytics: never contact production.
      if(['api.kraken.com','api.bybit.com','api.bytick.com'].includes(u.hostname)&&req.method()==='GET')return json({error:'ISOLATED_PROVIDER_UNAVAILABLE'},503);
      if(u.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:''});
      if(req.resourceType()==='image'||req.resourceType()==='font')return route.fulfill({status:204,body:''});
      violations.push({kind:'UNEXPECTED_EXTERNAL',url:u.origin+p});return route.abort();
    });
    const page=await ctx.newPage();page.setDefaultTimeout(15000);
    page.on('pageerror',e=>pageErrors.push(e.message));
    return {ctx,page};
  }
  try {
    for(const width of [1440,390]) {
      const {ctx,page}=await session(width);
      for(const [name,url,selector,required] of [
        ['Admin','/admin/users','.admin-page-grid',['/me','/admin/users/page']],
        ['Spot','/trade','.trade-terminal',['/balances','/orders/me']],
        ['Wallet','/wallet','.vx-wallet',['/wallet/overview']],
        ['Banking','/banking','.banking-referral',['/banking/config','/banking/state']],
        ['Futures','/futures','.futures-terminal',['/futures/config','/futures/balances','/futures/orders/me']],
        ['KYC','/settings?tab=verification','.settings-arctic-root',['/kyc/me']],
      ]) {
        const start=requests.length;
        await page.goto(config.origin+url);await page.locator(selector).first().waitFor();
        await page.waitForFunction(()=>document.readyState==='complete');
        for(const suffix of required) {
          const deadline=Date.now()+10000;
          while(!requests.slice(start).some(r=>r.path==='/api/v1'+suffix)&&Date.now()<deadline)await page.waitForTimeout(100);
          assert(requests.slice(start).some(r=>r.path==='/api/v1'+suffix&&r.status===200),`${name} missing successful ${suffix}`);
        }
        assert((await page.locator('body').innerText()).length>100,`${name} empty UI`);
        await page.screenshot({path:path.join(out,`${name}-${width}.png`)});
        cases.push({name,width,status:'PASS'});
      }
      await ctx.close();
      const failed=await session(width,{failPaths:['/api/v1/balances','/api/v1/orders/me']});
      await failed.page.goto(config.origin+'/trade');
      await failed.page.getByText('Could not load assets',{exact:true}).waitFor();
      await failed.page.getByText('Could not load orders',{exact:true}).waitFor();
      assert(await failed.page.locator('.terminal-size-range').isDisabled(),'Sizing must be disabled without balances');
      await failed.page.screenshot({path:path.join(out,`Spot-balances-orders-503-${width}.png`)});
      cases.push({name:'Spot-balances-open-orders-503',width,status:'PASS'});await failed.ctx.close();
      for(const status of [401,403,503,'network']) {
        const {ctx,page}=await session(width,{meStatus:status});await page.goto(config.origin+'/admin/users');
        // adminRead wraps transport errors as status=0; the unchanged gate
        // classifies numeric status (including 0) as SERVER. Assert fail-closed.
        if(status===503||status==='network')await page.locator('[data-admin-gate="error"] [data-admin-gate-reason="SERVER"]').waitFor();
        else await page.waitForURL(u=>!u.pathname.startsWith('/admin'));
        assert.equal(await page.locator('.admin-page-grid').count(),0,'Private admin UI leaked on failure');
        cases.push({name:`Admin-${status}`,width,status:'PASS'});await ctx.close();
      }
      const guest=await session(width,{guest:true});await guest.page.goto(config.origin+'/wallet');await guest.page.waitForURL(/\/login/);
      cases.push({name:'Guest-authentication',width,status:'PASS'});await guest.ctx.close();
      for(const lang of ['en','ru','zh','es','hi','ja','ko']) {
        const {ctx,page}=await session(width,{lang});await page.goto(config.origin+'/wallet');await page.locator('.vx-wallet').waitFor();
        assert.equal(await page.evaluate(()=>localStorage.getItem('exchange_lang')),lang);
        const label={en:'Convert',ru:'Конвертация',zh:'闪兑',es:'Convertir',hi:'कन्वर्ट',ja:'コンバート',ko:'전환'}[lang];
        const convert=page.getByRole('button',{name:label,exact:true});
        await convert.waitFor();assert(await convert.isDisabled(),'Conversion must stay disabled');
        assert.equal(await page.locator('.wallet-action-convert:enabled').count(),0);
        cases.push({name:`Wallet-locale-${lang}`,width,status:'PASS'});await ctx.close();
      }
    }
    assert.deepEqual([...new Set(unknown)],[],'Unmapped requests must be reviewed');
    assert.deepEqual(violations,[],'Release routing/asset/financial isolation violations');
    assert.deepEqual([...new Set(pageErrors)],[],'Uncaught browser exceptions');
    // A poisoned bundle must fail the same origin oracle BEFORE fixtures reply.
    const before=violations.length;
    const negative=await session(1440,{corrupt:true});await negative.page.goto(config.origin+'/admin/users');
    await negative.page.waitForFunction(()=>document.readyState==='complete');
    const deadline=Date.now()+10000;while(violations.length===before&&Date.now()<deadline)await negative.page.waitForTimeout(100);
    await negative.ctx.close();assert(violations.slice(before).some(v=>v.kind==='WRONG_API_ORIGIN'),'Negative control failed to detect wrong API');
    const report={status:'PASS',profile,source:artifact.source,assetDigest:artifact.assetDigest,widths:[1440,390],cases,requests,
      negativeControl:true,negativeViolations:violations.slice(before),noConversionRequests:true,noExternalRequests:true,
      evidenceScope:'ISOLATED_BROWSER_SYNTHETIC_RESPONSES',productionAuthenticatedQA:'NOT_RUN',corsScope:'Fixture responses only; see separate live read-only CORS evidence'};
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({status:'PASS',profile,cases:cases.length,requests:requests.length}));
  } catch(e) {
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({status:'FAIL',profile,cases,requests,violations,unknown:[...new Set(unknown)],pageErrors:[...new Set(pageErrors)],error:e.stack},null,2));throw e;
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
