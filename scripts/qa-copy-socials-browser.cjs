'use strict';
// Production bundle + real API + disposable PostgreSQL. No external navigation/network.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {once}=require('node:events'), {randomUUID}=require('node:crypto');
const {createRequire}=require('node:module');
const qa=createRequire(path.resolve('node_modules/.cache/issue640-qa/package.json'));
const {chromium}=qa('playwright');
const url=process.env.COPY_SOCIAL_TEST_URL;
if(!/^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/voltex_copy_social_test$/.test(url||'')) throw Error('Disposable loopback database required');
process.env.JWT_SECRET=randomUUID();
const {PrismaClient}=require('@prisma/client'), express=require('express'), jwt=require('jsonwebtoken');
const {copyPerformanceRouter}=require('../dist/api/routes/copyPerformance');
const {CopyPerformanceService}=require('../dist/services/copyTrading/CopyPerformanceService');
const db=new PrismaClient({datasources:{db:{url}}});
const out=path.resolve('output/copy-socials');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const identities=await db.copyStrategyOwner.findMany({where:{traderId:{in:['VX-001','VX-KSENIA']}}});
 const tokens={};
 for(const identity of identities){
  await db.copyStrategyOwner.update({where:{traderId:identity.traderId},data:{xUrl:null,telegramUrl:null,socialOwnerUserId:identity.ownerUserId}});
  const session=await db.session.create({data:{userId:identity.ownerUserId}});
  tokens[identity.traderId]=jwt.sign({sub:identity.ownerUserId,sid:session.id},process.env.JWT_SECRET,{expiresIn:'20m'});
 }
 const app=express();app.use(express.json());
 const service=new CopyPerformanceService(db,()=>new Date('2026-09-24T12:00:00Z'));
 app.get('/api/v1/me',(_q,r)=>r.json({id:'qa-owner',displayName:'QA',email:'qa@example.invalid',isAdmin:false,kycStatus:'NOT_STARTED',twoFactorEnabled:false,createdAt:'2026-01-01T00:00:00Z'}));
 app.use('/api/v1',copyPerformanceRouter(db,service));
 app.get('/api/v1/wallet/portfolio-history',(_q,r)=>r.json({points:[]}));
 app.get(['/api/v1/balances','/api/v1/futures/balances'],(_q,r)=>r.json([]));
 app.get('/api/v1/support/conversations/mine',(_q,r)=>r.json({conversation:null}));
 app.use('/api/v1',(_q,r)=>r.status(503).json({error:'Unrelated feed unavailable in isolated QA'}));
 app.use(express.static(path.resolve('frontend/dist')));app.get('*',(_q,r)=>r.sendFile(path.resolve('frontend/dist/index.html')));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch(process.env.QA_CHROMIUM_PATH?{executablePath:process.env.QA_CHROMIUM_PATH}:{});
 const report=[];
 try{
  for(const width of [1440,390]) for(const id of ['VX-001','VX-KSENIA']){
   const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await context.addInitScript(token=>{localStorage.setItem('exchange_token',token);localStorage.setItem('exchange_lang','ru');},tokens[id]);
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/copy-trading');
   const card=page.locator(`.trader-card[data-trader-id="${id}"]`);await card.waitFor();
   await card.click();
   const editor=page.locator('.strategy-social-editor');await editor.waitFor({timeout:60000});await editor.locator('summary').click();
   await editor.getByLabel('X (Twitter)',{exact:true}).fill('@qa_owner');
   await editor.getByRole('button',{name:'Сохранить ссылки',exact:true}).click();
   await editor.getByRole('status').filter({hasText:'Ссылки сохранены'}).waitFor();
   let links=page.locator(`.trader-profile-identity [data-social-trader="${id}"]`);
   assert.equal(await links.locator('a').count(),1);assert.equal(await links.locator('a').getAttribute('href'),'https://x.com/qa_owner');
   assert.equal(await links.locator('a').getAttribute('rel'),'noopener noreferrer');assert.equal(await links.locator('a').getAttribute('target'),'_blank');
   await editor.getByLabel('Telegram',{exact:true}).fill('@qa_telegram');await editor.getByRole('button',{name:'Сохранить ссылки',exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.trader-profile-identity .strategy-socials a').length===2);
   await editor.getByLabel('X (Twitter)',{exact:true}).fill('');await editor.getByRole('button',{name:'Сохранить ссылки',exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.trader-profile-identity .strategy-socials a').length===1);
   assert.equal(await links.locator('a').getAttribute('href'),'https://t.me/qa_telegram');
   assert.equal(await links.locator('button[disabled]').count(),1);
   await page.screenshot({path:path.join(out,`${id}-${width}-profile.png`),fullPage:false});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
   await page.getByRole('button',{name:'Назад к копитрейдингу',exact:true}).click();
   assert.equal(await card.locator('.strategy-socials a').count(),1,'card reflects saved profile');
   await page.reload();await card.waitFor();
   await page.waitForFunction(id=>document.querySelector(`.trader-card[data-trader-id="${id}"] .strategy-socials a`)?.getAttribute('href')==='https://t.me/qa_telegram',id);
   const disabledGroups=page.locator('[data-social-trader]:not([data-social-trader="VX-001"]):not([data-social-trader="VX-KSENIA"])');
   assert(await disabledGroups.count()>0);
   for(const group of await disabledGroups.all()){assert.equal(await group.locator('a').count(),0);assert.equal(await group.locator('button[disabled]').count(),2);}
   await page.screenshot({path:path.join(out,`${id}-${width}-cards.png`),fullPage:false});
   // The other strategy has no self-service editor for this authenticated owner.
   const other=id==='VX-001'?'VX-KSENIA':'VX-001';await page.locator(`.trader-card[data-trader-id="${other}"]`).click();await page.waitForTimeout(350);
   assert.equal(await page.locator('.strategy-social-editor').count(),0);
   assert(await page.locator('.trader-copy-cta button').count()>0,'existing Copy controls retained');
   assert.deepEqual(errors,[]);report.push({width,id,passed:true});await context.close();
   await db.copyStrategyOwner.update({where:{traderId:id},data:{xUrl:null,telegramUrl:null}});
  }
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({passed:true,cases:report},null,2));console.log('PASS: 1440/390; both owners; update, clear, reload, card/profile consistency, disabled catalogue, cross-owner editor denial; no page errors');
 }finally{await browser.close();await new Promise(r=>server.close(r));await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
