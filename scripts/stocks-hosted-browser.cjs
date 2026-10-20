// Internal disposable acceptance, NOT an owner preview/launcher or release seed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture,disposableUrl}=require('../services/stocks-global/testing/disposable-postgres.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'output/issue558');
const ORIGIN='https://stocks-pilot.example.invalid',ID='BYBIT:AAPLXUSDT';
async function main(){
  assert.ok(disposableUrl(),'Explicit disposable local PG required');
  assert.equal(process.versions.node,'22.23.3');
  const cleanup=[],financial=process.env.STOCKS_PILOT_BROWSER_FINANCE!=='false';
  const {createReleaseMarket}=await import('../services/stocks-global/release-market.mjs');
  const f=await fixture({after:fn=>cleanup.push(fn)},{normalLogin:true,releaseRouter:true,wallClock:true,
    financialEnabled:financial,...(!financial?{hub:createReleaseMarket({})}:{})});
  const {createHostedIngress}=await import('../services/stocks-global/hosted-ingress.mjs');
  const ingress=await createHostedIngress({origin:ORIGIN,gatewayPort:f.gateway.port,port:0});
  const playwright=require(process.env.STOCKS_TEST_PLAYWRIGHT_ROOT||
    path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const browser=await playwright.chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const proof={internalFixture:true,financial,checks:[],externalBlocked:0,errors:[]};
  const pass=name=>proof.checks.push(name);
  page.on('pageerror',e=>proof.errors.push(e.message));
  // Emulates ONLY the trusted TLS edge locally; real hosted TLS/ingress remains NOT_RUN.
  // All financial/API responses below come from the actual disposable PG servers.
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==ORIGIN){proof.externalBlocked++;return route.fulfill({status:503,body:''});}
    if(url.pathname.startsWith('/__stocks_global/')){
      const headers={...req.headers(),host:new URL(ORIGIN).host};
      if(req.method()!=='GET')headers.origin=ORIGIN;
      const response=await route.fetch({url:'http://127.0.0.1:'+ingress.port+url.pathname+url.search,headers});
      return route.fulfill({response});
    }
    if(url.pathname.startsWith('/api/v1/')){
      const response=await route.fetch({url:f.apiOrigin+url.pathname+url.search});
      return route.fulfill({response});
    }
    if(url.pathname.startsWith('/assets/')){
      const file=path.resolve(ROOT,'frontend/dist-stocks-hosted','.'+url.pathname);
      assert.ok(file.startsWith(path.resolve(ROOT,'frontend/dist-stocks-hosted/assets')+path.sep));
      const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':undefined;
      return fs.existsSync(file)?route.fulfill({path:file,contentType:type}):route.fulfill({status:404,body:''});
    }
    if(url.pathname==='/login'||url.pathname==='/stocks'||url.pathname.startsWith('/stocks/'))
      return route.fulfill({path:path.join(ROOT,'frontend/dist-stocks-hosted/index.html'),contentType:'text/html'});
    return route.fulfill({status:404,body:''});
  });
  const state=()=>page.evaluate(async id=>{
    const r=await fetch('/__stocks_global/state?id='+encodeURIComponent(id),{headers:{authorization:'Bearer '+localStorage.getItem('exchange_token')}});
    return {status:r.status,data:await r.json()};
  },ID);
  const waitState=async predicate=>{
    for(let i=0;i<40;i++){const s=await state();if(s.status===200&&predicate(s.data))return s.data;await page.waitForTimeout(250);}
    throw Error('Expected PG browser state not reached');
  };
  const login=async index=>{
    await page.locator('#login-email').fill(f.users[index]+'@example.invalid');
    await page.locator('#login-password').fill(f.loginPassword);
    await page.locator('form button[type=submit]').click();
    await page.waitForURL(url=>url.pathname.startsWith('/stocks'));
  };
  fs.mkdirSync(OUT,{recursive:true});
  try{
    const initial=await f.rows();
    await page.goto(ORIGIN+'/stocks');
    await page.waitForURL(url=>url.pathname==='/login');
    assert.equal(new URL(page.url()).searchParams.get('next'),'/stocks');
    pass('Actual App route redirects to standard login with safe Stocks return');
    await login(0);
    const apple=page.locator('a[href="/stocks/'+encodeURIComponent(ID)+'"]');
    await apple.waitFor();
    assert.deepEqual(await f.rows(),initial);
    assert.equal(await page.locator('#local-preview-controls').count(),0);
    pass('Normal login opens actual catalogue without funding or alternate auth toolbar');
    await apple.click();
    await page.waitForURL(url=>url.pathname.includes('AAPLX'));
    let before=await waitState(s=>!!s.account);
    if(financial){
      before=await waitState(s=>s.account.canTrade&&s.quotes[ID]);
      await page.getByRole('textbox',{name:'Количество',exact:true}).fill('0.1');
      await page.getByRole('button',{name:'Купить AAPLX',exact:true}).click();
      const bought=await waitState(s=>s.fills.length===before.fills.length+1);
      assert.equal(Number(bought.wallets.USDT.cash),Number(before.wallets.USDT.cash)-10);
      assert.equal(bought.positions[ID+'|USDT'].quantity,'0.10000000');
      await page.getByRole('button',{name:'Продать',exact:true}).click();
      await page.getByRole('textbox',{name:'Количество',exact:true}).fill('0.1');
      await page.getByRole('button',{name:'Продать AAPLX',exact:true}).click();
      const sold=await waitState(s=>s.fills.length===before.fills.length+2);
      assert.equal(sold.wallets.USDT.cash,before.wallets.USDT.cash);
      assert.equal(sold.positions[ID+'|USDT'].quantity,'0.00000000');
      const cash=await f.db.demoBalance.findUnique({where:{userId_asset:{userId:f.users[0],asset:'USDT'}}});
      assert.equal(Number(cash.available),Number(sold.wallets.USDT.cash));
      await page.reload();const restored=await waitState(s=>s.fills?.length===sold.fills.length);
      assert.deepEqual(restored.orders,sold.orders);assert.deepEqual(restored.wallets,sold.wallets);
      pass('Actual GlobalStocks BUY/SELL/reload uses existing DemoBalance through hosted ingress and PG');
    }else{
      assert.equal(before.account.canTrade,false);assert.deepEqual(before.quotes,{});
      assert.equal(await page.getByRole('button',{name:'Купить AAPLX',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Limit',exact:true}).click();
      await page.getByRole('textbox',{name:'Цена',exact:true}).fill('100');
      await page.getByRole('textbox',{name:'Количество',exact:true}).fill('0.1');
      assert.equal(await page.getByRole('button',{name:'Купить AAPLX',exact:true}).isDisabled(),true);
      assert.deepEqual(await f.rows(),initial);
      pass('No-data catalogue and actual terminal keep Market/Limit disabled; no financial writes');
    }
    await page.screenshot({path:path.join(OUT,financial?'hosted-trading-desktop.png':'hosted-unavailable-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Торговля',exact:true}).click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(OUT,financial?'hosted-trading-mobile.png':'hosted-unavailable-mobile.png'),fullPage:true});
    pass('Mobile actual professional ticket retains viewport bounds');
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'Сменить аккаунт',exact:true}).click();
    await page.waitForURL(url=>url.pathname==='/login');
    await login(1);
    const next=await waitState(s=>!!s.account&&s.account.id!==before.account.id);
    assert.equal(next.fills.length,0);
    if(financial)assert.equal(next.wallets.USDT.cash,'129.87500000');
    pass('Normal logout/login switches account without exposing prior orders or cash');
    assert.deepEqual(proof.errors,[]);
    fs.writeFileSync(path.join(OUT,financial?'hosted-browser.json':'hosted-unavailable.json'),JSON.stringify(proof,null,2));
    console.log(JSON.stringify({result:'PASS',...proof}));
  }catch(error){
    await page.screenshot({path:path.join(OUT,'hosted-browser-failure.png'),fullPage:true});
    fs.writeFileSync(path.join(OUT,'hosted-browser-failure.txt'),String(error.stack)+'\n'+(await page.locator('body').innerText()));
    throw error;
  }finally{
    await context.unrouteAll({behavior:'ignoreErrors'});
    await browser.close();await ingress.close();for(const close of cleanup.reverse())await close();
  }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
