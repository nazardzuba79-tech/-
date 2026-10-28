#!/usr/bin/env node
// Production frontend bundle, isolated synthetic sessions/responses only.
// No request leaves Playwright's route handler; no real listing or account is changed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve('frontend/dist');
const out = path.resolve('output/seo-release-compat');
const origin = 'http://127.0.0.1:4479';
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2', '.json':'application/json' };
const now = Date.parse('2026-10-28T10:00:00Z');
const results = [];
const listing = (symbol, name, at) => ({ pair:`${symbol}/USDT`, symbol, name, quote:'USDT', managed:true, listingId:`fixture-${symbol}`, version:1,
  isTestAsset:true, isTradable:false, status:'SIMULATION', listingArmed:true, countdown:'running', listingAt:at, initialPrice:0.014,
  displayTimeZone:'Europe/Moscow', logo:null, state:{ phase:'pre-listing', serverTime:now, lastPrice:null, openPrice24h:null,
    change24hPercent:null, high24h:null, low24h:null, volume24h:null, quoteVolume24h:null } });
const assets = [listing('ECLV','ECLAVO','2026-11-06T13:00:00Z'), listing('QVTR','QAVENTRA','2026-10-28T13:00:00Z')];
const cfg = {schemaVersion:1,symbol:'QASEO',name:'Isolated SEO QA',logo:null,initialPrice:'0.0140',listingAt:'2026-11-06T13:00:00Z',
  displayTimeZone:'Europe/Moscow',ownerAllocation:'0',seedMode:'manual',seed:'isolated-seo-qa-only',tradable:false};
const adminListing = { id:'seo-qa-only',symbol:'QASEO',draft:cfg,draftRevision:1,draftUpdatedAt:'2026-10-28T10:00:00Z',
  draftUpdatedBy:'synthetic',activeVersion:null,active:null,versions:[],countdown:null };
const programs = [{id:'MONTHLY_17_24M',name:'Ежемесячные выплаты',monthlyRate:'0.12',termMonths:12,minUsd:'2500',assets:['USDT'],compound:false,payoutFrequency:'MONTHLY',lockRule:'PRINCIPAL_RETURN_UNDEFINED',enabled:true},
  {id:'COMPOUND_21_12M',name:'Накопление',monthlyRate:'0.17',termMonths:24,minUsd:'2500',assets:['USDT'],compound:true,payoutFrequency:'MATURITY',lockRule:'PRINCIPAL_AND_REWARDS_LOCKED_TO_MATURITY',enabled:true}];
const cardYield = {annualRate:'0.12',asset:'USDT',locked:false,availableCardBalance:null,accruedReward:null,dataStatus:'UNAVAILABLE',reason:'QA_NO_CARD_BALANCE'};

(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch();
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU',serviceWorkers:'block'});
      await context.addInitScript(({now})=>{ const realNow=Date.now.bind(Date), start=realNow(); Date.now=()=>now+realNow()-start;
        localStorage.setItem('exchange_token','isolated-seo-fixture-not-a-real-token');localStorage.setItem('exchange_lang','ru'); },{now});
      let deleted=false; const writes=[]; const unexpected=[];
      await context.routeWebSocket('**/*',socket=>socket.close());
      await context.route('**/*',async route=>{
        const req=route.request(),u=new URL(req.url()),p=u.pathname;
        const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        if(!['GET','HEAD','OPTIONS'].includes(req.method())) {
          writes.push({method:req.method(),path:p,body:req.postDataJSON()});
          if(p==='/api/v1/admin/listings/seo-qa-only/delete' && req.method()==='POST') {
            assert.equal(req.postDataJSON().confirmation,'УДАЛИТЬ QASEO');deleted=true;
            return json({id:'seo-qa-only',symbol:'QASEO',deleted:true,catalogueRevision:'fixture-2'});
          }
          unexpected.push(`${req.method()} ${p}`);return route.abort();
        }
        if(u.origin===origin && !p.startsWith('/api/')) {
          const relative=p==='/'?'index.html':p.slice(1);
          const f=path.resolve(dist,relative),html=path.resolve(dist,relative+'.html');
          const file=f.startsWith(dist+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile()?f:
            html.startsWith(dist+path.sep)&&fs.existsSync(html)?html:path.join(dist,'index.html');
          return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
        }
        if(p==='/api/v1/me') return json({id:'synthetic-seo-admin',email:'seo@example.invalid',displayName:'Isolated QA',role:'ADMIN',isAdmin:true,kycStatus:'APPROVED'});
        if(p.endsWith('/market/listings')) return json({serverTime:now,assets});
        if(p.endsWith('/market/nrx')||p.endsWith('/market/test-assets')) return json({serverTime:now,assets:[]});
        if(p==='/api/v1/admin/listings') return json({revision:'fixture-1',serverTime:now,listings:deleted?[]:[adminListing]});
        if(p==='/api/v1/banking/config') return json({programs,assets:[{asset:'USDT',priceUsd:'1',minimumAssetQty:'2500'}],rewardCurrencyRule:'SAME_AS_DEPOSIT_ASSET',usdValuesAreReferenceOnly:true,cardYield});
        if(p==='/api/v1/banking/state') return json({placements:[],ledger:[],summary:{totalUsd:'0',accruedUsd:'0',activeCount:0},cardYield});
        if(p==='/api/v1/banking/referral') return json({referralCode:'QASEO123',referralPercent:20,referredCount:0,rewardsByAsset:[],recentRewards:[]});
        if(p.endsWith('/market/external/symbols')) return json({symbols:['BTC/USDT']});
        if(p.endsWith('/market/external/tickers')) return json({tickers:[]});
        if(p.endsWith('/support/conversations/mine')) return json({conversation:null});
        if(p.endsWith('/market/assets/icons')) return json({icons:{}});
        if(p.endsWith('/market/pairs')) return json([{pair:'BTC/USDT',base:'BTC',quote:'USDT'}]);
        if(p.endsWith('/candles')) return json({candles:[]});
        return json([]);
      });
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      const meta=async()=>page.evaluate(()=>({robots:document.querySelector('meta[name="robots"]')?.content,canonical:document.querySelector('link[rel="canonical"]')?.getAttribute('href')??null}));
      for(const asset of assets) {
        await page.goto(`${origin}/trade?pair=${encodeURIComponent(asset.pair)}`);
        if(width<600)await page.locator('#mobile-trade-chart').click();
        await page.locator('.vta-countdown').waitFor();
        const facts=await page.locator('.vta-prelisting-facts').innerText();
        assert((await page.locator('body').innerText()).includes(asset.name));assert(facts.includes('0.0140'));assert(facts.includes(asset.symbol==='ECLV'?'06.11.2026':'28.10.2026'));
        assert.deepEqual(await meta(),{robots:'noindex, nofollow',canonical:null});
        await page.screenshot({path:path.join(out,`${asset.symbol}-${width}.png`)});
        await page.reload();await page.locator('.vta-countdown').waitFor();
        assert.equal(await page.locator('.vta-prelisting-facts').innerText(),facts);
        results.push({case:asset.symbol,width,pass:true,reload:true,listingAt:asset.listingAt});
      }
      for(const pair of ['NRX/USDT','NRX/BTC','BTC/NRX','NRX/SIMUSDT','NRXSIMUSDT']) {
        await page.goto(`${origin}/trade?pair=${encodeURIComponent(pair)}`);
        await page.getByText('Этот рынок удалён. Новые ордера недоступны.',{exact:true}).waitFor();
        assert.equal(await page.locator('canvas,input').count(),0);
        assert.deepEqual(await meta(),{robots:'noindex, nofollow',canonical:null});
        results.push({case:pair,width,pass:true,orderInputs:0});
      }
      await page.goto(`${origin}/banking`);await page.locator('.banking-referral').waitFor();
      assert((await page.locator('.banking-referral').innerText()).includes('20%'));
      await page.getByText('https://voltextech.net/QASEO123',{exact:true}).waitFor();
      assert.equal((await page.locator('.banking-referral-link code').innerText()).trim(),'https://voltextech.net/QASEO123');
      assert.deepEqual(await meta(),{robots:'noindex, nofollow',canonical:null});
      await page.screenshot({path:path.join(out,`banking-${width}.png`)});
      results.push({case:'Banking/referral',width,pass:true});
      await page.goto(`${origin}/admin/listings`);await page.locator('[data-delete-listing="QASEO"]').waitFor();
      await page.locator('[data-delete-listing="QASEO"]').click();
      await page.locator('[data-field="deleteConfirmation"]').fill('WRONG');
      assert(await page.locator('[data-confirm-delete]').isDisabled());
      await page.locator('[data-field="deleteConfirmation"]').fill('УДАЛИТЬ QASEO');
      assert(await page.locator('[data-confirm-delete]').isEnabled());
      await page.screenshot({path:path.join(out,`admin-delete-${width}.png`)});
      await page.locator('[data-confirm-delete]').click();
      await page.getByText('Листингов пока нет.',{exact:true}).waitFor();
      assert.equal(writes.length,1);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
      assert.deepEqual(await meta(),{robots:'noindex, nofollow',canonical:null});
      results.push({case:'Admin Delete',width,pass:true,syntheticDeletes:1,unexpectedWrites:0});
      await context.close();
    }
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({scope:'Actual production bundle; synthetic isolated sessions and HTTP responses; all network intercepted; no production writes',results},null,2));
    console.log(JSON.stringify({passed:results.length,failed:0,widths:[1440,390]}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
