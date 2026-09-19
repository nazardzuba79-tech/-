'use strict';
// No production account, no database, no token sent to production.
// Protected screens use a LOCAL read-only failure fixture, never production auth bypass.
const fs=require('node:fs'),path=require('node:path'),{once}=require('node:events');
const express=require('express');
const {chromium}=require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'docs/qa/client-messages/browser');
const BLOCK=/SENTINEL_UI_BACKEND|DATABASE_URL|[A-Z_]+_TREASURY_ADDRESS|PrismaClient\w*|WebSocket|Request failed\s*\(|\[object Object\]|деплоймент|нижняя граница/i;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const app=express();
 app.get('/api/v1/me',(_q,r)=>r.json({id:'local-ui-audit',email:'audit@example.invalid',role:'USER'}));
 app.get('/api/v1/private-trading/access',(_q,r)=>r.json({allowed:false,mode:'ORDINARY',nativeAvailable:false,simulationOnly:false}));
 app.all('/api/*',(_q,r)=>r.status(503).json({error:'SENTINEL_UI_BACKEND PrismaClientError DATABASE_URL'}));
 app.use(express.static(path.join(ROOT,'frontend/dist'),{index:false}));
 app.get('*',(_q,r)=>r.sendFile(path.join(ROOT,'frontend/dist/index.html')));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const local=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({args:['--no-sandbox']});
 const report={scope:'Public production anonymous; protected routes separately in a LOCAL failure fixture',createdAt:new Date().toISOString(),screens:[],findings:[],failures:[]};
 const productionPaths=['/','/login','/register','/markets','/trade','/futures','/wallet','/banking','/copy-trading','/arbitrage','/card','/otc','/settings','/legal/terms'];
 const localPaths=['/markets','/markets?view=analytics','/trade','/trade?market=cfd','/futures','/wallet','/banking','/copy-trading','/arbitrage','/card','/otc','/settings','/settings?tab=deposits'];
 try{
  for(const mode of ['production-public','local-failure']){
   const context=await browser.newContext({viewport:{width:1440,height:960}});
   if(mode==='local-failure')await context.addInitScript(()=>{localStorage.setItem('exchange_token','local-ui-only');localStorage.setItem('exchange_lang','ru');});
   else await context.addInitScript(()=>{localStorage.removeItem('exchange_token');localStorage.setItem('exchange_lang','ru');});
   await context.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(!['GET','HEAD'].includes(request.method()))return route.abort();
    if(mode==='local-failure' && !url.startsWith(local) && !url.startsWith('data:'))return route.abort();
    return route.continue();
   });
   for(const [i,urlPath] of (mode==='local-failure'?localPaths:productionPaths).entries()){
    const page=await context.newPage(),pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(String(e).slice(0,300)));
    const entry={mode,path:urlPath,pageErrors};
    try{
     const response=await page.goto((mode==='local-failure'?local:'https://voltextech.net')+urlPath,{waitUntil:'domcontentloaded',timeout:30000});
     await page.waitForTimeout(mode==='local-failure'?1800:1200);
     entry.status=response?.status();entry.finalUrl=page.url();
     entry.redirected=new URL(page.url()).pathname!==new URL(urlPath,'http://local').pathname;
     const text=await page.locator('body').innerText();
     entry.title=await page.title();entry.textLength=text.length;
     entry.matches=text.split('\n').map(s=>s.trim()).filter(s=>BLOCK.test(s));
     entry.protectedNotVerified=mode==='production-public' && !['/','/login','/register','/legal/terms'].includes(urlPath);
     if(entry.matches.length)report.findings.push({mode,path:urlPath,matches:entry.matches});
     const name=`${mode}-${i}-${urlPath.replace(/[^a-z0-9]/gi,'-')}`;
     fs.writeFileSync(path.join(OUT,name+'.txt'),text);
     await page.screenshot({path:path.join(OUT,name+'.png')});
    }catch(error){entry.error=String(error).slice(0,350);report.failures.push(entry);}
    report.screens.push(entry);await page.close();
   }
   await context.close();
  }
 }finally{
  await browser.close();await new Promise(r=>server.close(r));
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({screens:report.screens.length,findings:report.findings,failures:report.failures.length}));
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
