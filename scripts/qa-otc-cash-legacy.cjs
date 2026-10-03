// Production bundle, loopback-only fixture transport. No DB, proxy, secrets,
// blockchain or real financial operations. POSTs change this process's fixtures.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {once}=require('node:events'),{chromium}=require(process.env.QA_PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'..'),DIST=path.join(ROOT,'frontend/dist-otc-legacy');
// CI must use its fresh per-run artifact directory, never checked-in historical QA.
if(process.env.CI && !process.env.OTC_CI_EVIDENCE_DIR) throw new Error('CI requires fresh OTC_CI_EVIDENCE_DIR');
const outputParent=process.env.OTC_CI_EVIDENCE_DIR||path.join(ROOT,'output/otc-cash');
fs.mkdirSync(outputParent,{recursive:true});
const OUT=fs.mkdtempSync(path.join(outputParent,'legacy-browser-'));
const id='0e997edf-1b9a-47d2-aaed-ef2c3c287f97';
const date='2026-10-01T10:00:00Z';
const token=who=>`fixture.${Buffer.from(JSON.stringify({sub:who})).toString('base64url')}.NOT_A_VALID_SIGNATURE`;
const basic={id,number:'OTC-LOCAL-1',country:'RU',cityId:'geonames-524901',asset:'USDT',quantity:'10000',fiat:'USD',tier:'otc-convert',status:'RESERVED',version:1,offerVersion:0,acceptedOfferVersion:null,acceptedAt:null,cancelRequested:false,pickupRevision:0,createdAt:date,reservedQuantity:'10000',reservation:{asset:'USDT',quantity:'10000',status:'HELD'},offers:[]};
const privateText='ЛОКАЛЬНЫЙ ТЕСТ, НЕ РЕАЛЬНАЯ КАССА. Тестовый адрес: демонстрационный офис, вход со двора. '+ 'Длинное сообщение для проверки переноса текста. '.repeat(18);
const calls=[],unexpected=[],errors=[],external=[];let row={...basic},messages=[],available='20000';
const json=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
const mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self';frame-src 'none';object-src 'none'");
  if(u.pathname.startsWith('/api/')){
    calls.push({method:req.method,path:u.pathname,search:u.search});
    const admin=(req.headers.authorization??'').includes(token('fixture-admin'));
    if(u.pathname==='/api/v1/me')return json(res,{id:admin?'fixture-admin':'fixture-user',email:'local-fixture@example.invalid',role:admin?'ADMIN':'USER',isAdmin:admin,emailVerified:true,kycStatus:'APPROVED'});
    if(u.pathname==='/api/v1/market/display/spot-snapshot')return json(res,{_display:{mode:'snapshot',refreshMs:60000,capturedAt:Date.parse(date)},tickers:{available:false},overview:{available:false}});
    if(u.pathname==='/api/v1/otc/config')return json(res,{enabled:true,routes:[{country:'RU',cityId:basic.cityId,asset:'USDT',fiat:'USD',cashPrecision:2}]});
    if(u.pathname==='/api/v1/otc/balances')return json(res,{eligible:true,balances:[{asset:'USDT',available}]});
    if(u.pathname==='/api/v1/admin/notifications')return json(res,{notifications:[],unreadCount:0});
    if(u.pathname==='/api/v1/admin/alerts-summary')return json(res,{depositId:null,withdrawalId:null,kycId:null});
    if(req.method==='GET'&&admin&&u.pathname==='/api/v1/admin/work-summary'){
      const widget=(value,unit,href)=>({value,unit,href,status:'ready',asOf:date});
      return json(res,{asOf:date,alerts:{depositId:null,withdrawalId:null,kycId:null},widgets:{
        readyPackages:widget(0,'packages','/admin/deposits?state=READY'),
        pendingPackages:widget(0,'packages','/admin/deposits'),
        unlinkedTransfers:widget(0,'transfers','/admin/deposits?state=UNATTRIBUTED'),
        activeWithdrawals:widget(0,'withdrawals','/admin/withdrawals?status=active'),
        pendingKyc:widget(0,'users','/admin/kyc?status=PENDING'),
        openOtc:widget(['RESERVED','OFFERED','ACCEPTED','PICKUP_READY','PAYOUT_IN_PROGRESS'].includes(row.status)?1:0,'requests','/admin/otc?status=active'),
        totalUsers:widget(1,'users','/admin/users'),
        newUsers24h:widget(0,'users','/admin/users?status=new'),
      }});
    }
    const base=admin?'/api/v1/admin/otc':'/api/v1/otc/requests';
    if(req.method==='POST'){
      let raw='';for await(const part of req)raw+=part;if(raw.length>10000)return json(res,{error:'FIXTURE_INPUT_TOO_LARGE'},400);
      const body=JSON.parse(raw);
      if(u.pathname===base&&!admin){available='10000';row={...basic};return json(res,row,201);}
      if(u.pathname===`${base}/${id}/messages`){messages.push({id:`fixture-${messages.length}`,sender:admin?'ADMIN':'USER',kind:'TEXT',text:body.text,createdAt:date});return json(res,{id:'local-message'},201);}
    }
    if(req.method==='GET'&&u.pathname===base)return json(res,{rows:[{...row,offers:undefined,reservation:undefined,...(admin?{user:{id:'fixture-user',email:'local-fixture@example.invalid'}}:{})}],hasMore:false});
    if(req.method==='GET'&&u.pathname===`${base}/${id}`)return json(res,{...row,...(admin?{user:{id:'fixture-user',email:'local-fixture@example.invalid'}}:{})});
    if(req.method==='GET'&&u.pathname===`${base}/${id}/messages`)return json(res,{rows:messages,hasMore:false});
    unexpected.push({method:req.method,path:u.pathname});return json(res,{error:'NO_LOCAL_FIXTURE'},404);
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  const file=path.resolve(DIST,'.'+decodeURIComponent(u.pathname));
  if(file!==DIST&&!file.startsWith(DIST+path.sep)){res.writeHead(403);return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');return res.end(fs.readFileSync(file));}
  const who=u.pathname.startsWith('/admin/')?'fixture-admin':'fixture-user';
  const boot=`<script>localStorage.setItem('exchange_token',${JSON.stringify(token(who))});localStorage.setItem('exchange_lang','ru');</script>`;
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(DIST,'index.html'),'utf8').replace('<head>','<head>'+boot).replace('<body>','<body><aside style="position:fixed;bottom:0;left:0;z-index:99999;background:#ffdc70;color:#111;padding:2px 8px;font:11px sans-serif">LOCAL FIXTURES — NO REAL CASH / NO PRODUCTION</aside>'));
});
const count=()=>calls.filter(c=>c.path.includes('/otc')).length;
const overflow=page=>page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
async function componentShot(locator,name){
  // Component captures taller than the viewport otherwise stitch fixed site
  // chrome through the middle. Hide ONLY unrelated fixed chrome while capturing;
  // keyboard, overflow and hit-target checks use the unmodified rendered page.
  await locator.evaluate(root=>{for(const el of document.querySelectorAll('*'))if(!root.contains(el)&&!el.contains(root)&&['fixed','sticky'].includes(getComputedStyle(el).position))el.setAttribute('data-qa-fixed-chrome','');});
  await locator.screenshot({path:path.join(OUT,name),type:'jpeg',quality:85,style:'[data-qa-fixed-chrome]{visibility:hidden!important}'});
  await locator.evaluate(()=>document.querySelectorAll('[data-qa-fixed-chrome]').forEach(el=>el.removeAttribute('data-qa-fixed-chrome')));
}
async function main(){
  fs.mkdirSync(OUT,{recursive:true});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true}),checks=[];
  try {
    for(const width of [320,390,768,1440]){
      const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
      await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base){external.push(u.origin+u.pathname);return route.abort();}return route.continue();});
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.clock.install({time:new Date(date)});await page.goto(base+'/otc',{waitUntil:'networkidle'});
      const form=page.locator('[aria-label="Создать OTC-заявку"]');await form.getByText(/Доступно для обмена:/).waitFor();
      await form.getByRole('combobox').first().fill('Россия');await page.keyboard.press('Enter');
      await form.getByLabel('Город получения').selectOption(basic.cityId);await form.getByLabel('Количество, USDT').fill('10000');await form.getByLabel('Получаете наличными').selectOption('USD');
      const start=count();await form.getByLabel('Количество, USDT').fill('10001');await form.getByLabel('Количество, USDT').fill('10000');assert.equal(count(),start,'local edits make no HTTP');
      assert.equal(await form.getByLabel('Количество, USDT').evaluate(el=>getComputedStyle(el).webkitTextFillColor),'rgb(23, 33, 45)','typed amount is dark on the light form');
      assert.ok(await form.locator('.otc-combo-btn svg').first().evaluate(el=>el.getBoundingClientRect().width>=14),'country clear icon remains visible');
      await form.getByRole('button',{name:'Проверить параметры',exact:true}).click();
      assert.equal(await form.getByRole('button',{name:'Создать заявку и зарезервировать 10000 USDT'}).isDisabled(),true);
      assert.ok(await form.getByRole('button',{name:'Создать заявку и зарезервировать 10000 USDT'}).evaluate(el=>el.scrollHeight<=el.clientHeight),'long reserve button never clips or overlaps the following text');
      await componentShot(form,`client-${width}.jpg`);
      assert.ok((await overflow(page)).width<=width,`client overflow ${width}`);
      const idle=count();await page.clock.fastForward(86400000);assert.equal(count(),idle,'idle day adds no OTC requests');
      const consent=form.getByLabel('Подтверждаю параметры и правила отмены.');
      // Existing sleep safety consumes the first gesture and revalidates the
      // session. Do not bypass that barrier or treat the waking key as consent.
      await page.keyboard.press('Escape');await page.waitForLoadState('networkidle');await page.clock.runFor(1000);
      await page.locator('[data-browser-phase]').waitFor({state:'detached'});
      assert.equal(await consent.isChecked(),false,'waking gesture cannot consent');
      await consent.focus();await page.keyboard.press('Space');
      assert.equal(await consent.isChecked(),true,'keyboard consent changes actual checkbox');
      await form.getByRole('button',{name:'Создать заявку и зарезервировать 10000 USDT'}).click();
      await page.getByText('Приватная поддержка по заявке',{exact:true}).waitFor();
      row={...basic,status:'PICKUP_READY',version:4,offerVersion:1,acceptedOfferVersion:1,acceptedAt:date,pickupRevision:1,offers:[{version:1,asset:'USDT',quantity:'10000',fiat:'USD',rate:'1.25',gross:'12500',fee:'25',net:'12475',expiresAt:'2026-10-03T10:00:00Z',acceptedAt:date,cashPrecision:2}]};
      messages=[{id:'private-fixture',sender:'ADMIN',kind:'PICKUP',text:privateText,createdAt:date}];
      await page.getByRole('button',{name:'Обновить заявку и переписку'}).click();await page.getByText(privateText,{exact:true}).waitFor();
      await componentShot(page.locator('[aria-label="Заявка OTC"]'),`chat-${width}.jpg`);
      assert.ok((await overflow(page)).width<=width,`chat overflow ${width}`);assert.ok(!JSON.stringify(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)))).includes('Тестовый адрес'));
      await page.goto(base+'/admin/otc',{waitUntil:'networkidle'});await page.locator('.otc-cash-list-item').click();await page.getByText(privateText,{exact:true}).waitFor();
      await componentShot(page.locator('.otc-admin-desk'),`admin-${width}.jpg`);assert.ok((await overflow(page)).width<=width,`admin overflow ${width}`);
      const begin=page.getByRole('button',{name:'Начать выдачу',exact:true});await begin.focus();await page.keyboard.press('Enter');
      assert.equal(await page.getByRole('button',{name:'Подтвердить действие',exact:true}).isDisabled(),true,'keyboard cannot skip confirmation');
      checks.push({width,client:true,chat:true,admin:true,idleOtcRequests:0,localEditRequests:0,keyboardConfirmation:true});await context.close();row={...basic};messages=[];available='20000';
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);
    const report={checks,errors,external,unexpected,requests:calls,productionAccess:false};fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,requests:undefined},null,2));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;server.close();});
