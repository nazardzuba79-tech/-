// The currently deployed frontend must keep working during API-first release/rollback.
const assert=require('assert/strict'),path=require('path'),fs=require('fs'),{randomUUID}=require('crypto'),{once}=require('events');
const R=path.resolve(__dirname,'..'),req=require('module').createRequire(path.join(R,'api-source/package.json'));
const qa=require('module').createRequire(path.join(R,'api-source/node_modules/.cache/issue640-qa/package.json'));
const url=process.env.COPY_SOCIAL_TEST_URL;if(!/^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/voltex_copy_social_test$/.test(url||''))throw Error('Fixture only');
process.env.JWT_SECRET=randomUUID();const jwt=req('jsonwebtoken'),express=req('express'),{PrismaClient}=req('@prisma/client');const db=new PrismaClient({datasources:{db:{url}}});
async function main(){
 const binding=await db.copyStrategyOwner.findUniqueOrThrow({where:{traderId:'VX-001'}});const session=await db.session.create({data:{userId:binding.ownerUserId}});const token=jwt.sign({sub:binding.ownerUserId,sid:session.id},process.env.JWT_SECRET,{expiresIn:'10m'});
 const app=express();app.use(express.json());
 const {copyPerformanceRouter}=require(path.join(R,'runtime-candidate/dist/api/routes/copyPerformance'));const {CopyPerformanceService}=require(path.join(R,'runtime-candidate/dist/services/copyTrading/CopyPerformanceService'));
 app.use('/api/v1',copyPerformanceRouter(db,new CopyPerformanceService(db,()=>new Date('2026-09-24T12:00:00Z'))));app.use('/api/v1',(_q,r)=>r.status(503).json({error:'isolated unrelated feed'}));
 app.use(express.static(path.join(R,'baseline/frontend-dist')));app.get('*',(_q,r)=>r.sendFile(path.join(R,'baseline/frontend-dist/index.html')));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;const browser=await qa('playwright').chromium.launch();
 try{for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin===origin)return route.continue();if(u.origin!=='https://api.voltextech.net')return route.abort();const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,PATCH,OPTIONS','access-control-allow-credentials':'true'};if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});const response=await route.fetch({url:origin+u.pathname+u.search});return route.fulfill({response,headers:{...response.headers(),...headers}});});
  await context.addInitScript(token=>{localStorage.setItem('exchange_token',token);localStorage.setItem('exchange_lang','ru');},token);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/copy-trading');
  for(const id of ['VX-001','VX-KSENIA']){const card=page.locator(`.trader-card[data-trader-id="${id}"]`);await card.waitFor();await card.click();await page.getByRole('button',{name:'Копировать трейдера',exact:true}).waitFor();assert.equal(await page.locator('.strategy-social-editor').count(),0);await page.getByRole('button',{name:'Назад к копитрейдингу',exact:true}).click();}
  assert.deepEqual(errors,[]);await context.close();
 }
 fs.writeFileSync(path.join(R,'evidence/mixed-version.json'),JSON.stringify({passed:true,frontend:'current production 006f59ee',api:'RC641',widths:[1440,390],bothProfiles:true,copyControlsRetained:true,pageErrors:0},null,2));console.log('PASS: old production frontend + new API at 1440/390, both profiles and Copy controls');
 }finally{await browser.close();await new Promise(r=>server.close(r));await db.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
