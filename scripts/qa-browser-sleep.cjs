'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=process.env.QA_RESUME==='1' && fs.existsSync(path.join(root,'output/browser-sleep/results.json')) ? JSON.parse(fs.readFileSync(path.join(root,'output/browser-sleep/results.json'),'utf8')) : [];
async function serve(dist,port){
  const child=cp.spawn(process.execPath,[path.join(__dirname,'qa-futures-account-harness.cjs'),'--budget','--port',String(port),'--dist',dist],{cwd:root,stdio:'ignore',windowsHide:true});
  for(let i=0;i<50;i++){try{await fetch(`http://127.0.0.1:${port}/__qa/hits`);return child;}catch{await sleep(100);}}
  child.kill();throw Error('Fixture startup failed');
}
const snapshot=page=>page.evaluate(()=>window.__readBudget.snapshot());
const advance=(page,ms)=>page.evaluate(ms=>window.__readBudget.advance(ms),ms);
const delta=(a,b)=>Object.fromEntries(Object.entries(b.hits).map(([k,v])=>[k,v-(a.hits[k]||0)]).filter(([,v])=>v));
async function check(browser,label,port,route,mode='B',width=1440){
  if(results.some(r=>r.label===label&&r.route===route&&r.mode===mode&&r.width===width))return;
  if(process.env.QA_ROUTE&&route!==process.env.QA_ROUTE)return;
  await fetch(`http://127.0.0.1:${port}/__qa/scenario?mode=${mode}`);
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.addInitScript(()=>{window.__browserSleepQa=true;});
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const page=await context.newPage();await page.goto(`http://127.0.0.1:${port}${route}`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!!window.__readBudget);await sleep(200);
  // Harness controls are outside the application under test.
  await page.locator('#budget-qa').evaluate(e=>e.style.display='none');
  const first=await snapshot(page);
  await advance(page,300001);await sleep(200);const asleep=await snapshot(page);
  await advance(page,1800000);await sleep(200);const long=await snapshot(page);
  const sleepingPhase=await page.locator('[data-browser-phase]').getAttribute('data-browser-phase').catch(()=>null);
  if(label==='candidate'){
    assert.equal(sleepingPhase,'sleeping',route+' should sleep');
    assert.deepEqual(delta(asleep,long),{},route+' has HTTP during sleep');
    assert.equal(long.transports.active,0,route+' has open provider streams during sleep');
    assert.equal(long.transports.sent,asleep.transports.sent,route+' sends while sleeping');
  }
  await page.mouse.click(8,8);await page.waitForTimeout(500);const awake=await snapshot(page);
  if(label==='candidate'){
    try { await page.waitForFunction(()=>!document.querySelector('[data-browser-phase]'),null,{timeout:10000}); }
    catch(error){fs.writeFileSync(path.join(root,'output/browser-sleep/wake-failure.json'),JSON.stringify({route,state:await snapshot(page),phase:await page.locator('[data-browser-phase]').getAttribute('data-browser-phase')},null,2));throw error;}
    const changes=delta(long,awake);assert.equal(changes['GET /api/v1/me'],1,route+' session should validate once');
    assert.ok(!Object.keys(changes).some(k=>/POST.*(orders|command|transfer)/.test(k)),route+' wake submitted a financial command');
  }
  const beforeHidden=await snapshot(page);await page.evaluate(()=>window.__readBudget.hidden(true));await advance(page,1800000);const hidden=await snapshot(page);
  if(label==='candidate')assert.deepEqual(delta(beforeHidden,hidden),{},route+' hidden HTTP');
  await page.evaluate(()=>window.__readBudget.hidden(false));await page.waitForTimeout(500);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  if(label==='candidate'){assert.equal(overflow,false,route+' viewport overflow');assert.deepEqual(hidden.errors,[],route+' browser errors');}
  const record={label,route,mode,width,first:first.hits,first5m:delta(first,asleep),sleep30m:delta(asleep,long),wake:delta(long,awake),transports:{asleep:asleep.transports,long:long.transports,awake:awake.transports},hidden30m:delta(beforeHidden,hidden),overflow,errors:hidden.errors};results.push(record);
  fs.mkdirSync(path.join(root,'output/browser-sleep'),{recursive:true});
  fs.writeFileSync(path.join(root,'output/browser-sleep/results.json'),JSON.stringify(results,null,2));
  if(label==='candidate')await page.screenshot({path:path.join(root,'output/browser-sleep',route.replace(/[^a-z0-9]/gi,'_')+'-'+mode+'-'+width+'.png')});
  console.log(label+' '+route+' '+mode+' '+width+' sleep requests='+Object.values(record.sleep30m).reduce((a,b)=>a+b,0)+' wake='+JSON.stringify(record.wake));
  await context.close();
}
(async()=>{
  const servers=[];let browser;
  try{
    if(process.env.QA_LABEL!=='candidate')servers.push(await serve(path.join(root,'output/browser-sleep-main/frontend/dist'),4275));
    servers.push(await serve(path.join(root,'frontend/dist'),4276));
    browser=await chromium.launch({channel:'msedge',headless:true});
    const routes=[['/admin/users'],['/admin/deposits'],['/wallet'],['/futures','A'],['/futures','B'],['/futures','C'],['/trade'],['/trade?market=cfd&pair=XAUUSD'],['/markets']];
    for(const [label,port]of[['baseline',4275],['candidate',4276]])if(!process.env.QA_LABEL||process.env.QA_LABEL===label)for(const [route,mode]of routes)await check(browser,label,port,route,mode);
    if(process.env.QA_LABEL!=='baseline')for(const width of [320,360,390,430])await check(browser,'candidate',4276,'/futures','C',width);
    console.log('PASS browser idle matrix '+results.length+' scenarios');
  }finally{await browser?.close();for(const server of servers)server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
