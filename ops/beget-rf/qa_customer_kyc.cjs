// Isolated real browser → opaque Nginx stream → trusted TLS Nginx → actual
// KYC Worker. API metadata/session adapters and email are SYNTHETIC sinks.
// No PostgreSQL, production host connection, real document, email or account.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const {once}=require('node:events');
const {webcrypto,randomUUID,createHash}=require('node:crypto');
const tls=require('node:tls'),assert=require('node:assert/strict');
const express=require('express'),ts=require('typescript');
const {chromium}=require(process.env.QA_PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.env.QA_OUT||path.join(root,'output/ru-customer-kyc'));
// A localhost alias ensures the browser cannot resolve/contact production,
// including in environments that enforce hostname-based outbound policy.
const HOST='localhost',RELAY_PORT=19443,ORIGIN='https://'+HOST+':'+RELAY_PORT;
const nginx=process.env.NGINX_BIN,streamModule=process.env.NGINX_STREAM_MODULE,executablePath=process.env.QA_CHROMIUM_EXECUTABLE;
if(!nginx||!streamModule||!executablePath)throw Error('Explicit isolated Nginx/module/browser paths required');
if(process.env.DATABASE_URL||process.env.KYC_QA_DATABASE_URL)throw Error('No database is allowed in this fixture');
fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'voltex-ru-kyc-browser-'));
const report={scope:'isolated real browser/Nginx/Worker; synthetic API metadata and email',steps:[],widths:[],outbound:[],stubbedPublicFontStylesheets:0,errors:[],apiMultipart:0,worker:[],mailCount:0};
let server,nginxProcess,browser;
const users=new Map(),cache=new Map(),tasks=[];
const check=(name,condition)=>{assert.ok(condition,name);report.steps.push({name,pass:true});};
async function main(){
  const core=await import(require('node:url').pathToFileURL(path.join(root,'workers/kyc-edge/src/core.js')).href);
  const {privateKey}=await webcrypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
  const jwk=await webcrypto.subtle.exportKey('jwk',privateKey);process.env.KYC_EDGE_PUBLIC_KEY=jwk.x;
  // The real signature verifier; its key is generated here, never production.
  const trustExports={};new Function('require','exports',ts.transpileModule(fs.readFileSync(path.join(root,'src/services/KycEdgeTrust.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,trustExports);
  const trust=new trustExports.KycEdgeTrust();
  const app=express();
  let base;
  const edgeEnv={KYC_EDGE_SIGNING_JWK:JSON.stringify(jwk),ALLOWED_ORIGINS:'https://voltextech.net',RU_GATEWAY_PEER_IP:'138.199.227.130'};
  app.all(['/v1/submit','/v1/materials','/v1/confirm'],async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
    const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
    headers.set('cf-connecting-ip','138.199.227.130');
    report.worker.push({path:req.path,lengthMatches:Number(headers.get('content-length'))===body.length,origin:headers.get('origin'),clientIp:headers.get('x-voltex-ru-client-ip'),bearerPresent:headers.has('authorization')});
    const response=await core.handle(new Request('https://kyc.voltextech.net'+req.url,{method:req.method,headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:body}),edgeEnv,{waitUntil:p=>tasks.push(p)},{
      now:()=>Date.now(),fetch:(url,init)=>{if(!url.startsWith(base+'/api/v1/internal/kyc/'))throw Error('Unexpected metadata destination');return fetch(url,init);},
      sendEmail:async()=>{report.mailCount++;},
      cache:{match:async r=>cache.has(r.url)?new Response(cache.get(r.url)):undefined,put:async(r,v)=>cache.set(r.url,await v.text())},
    });
    res.status(response.status);for(const[k,v]of response.headers)res.set(k,v);res.end(Buffer.from(await response.arrayBuffer()));
  });
  app.use('/api/v1/internal/kyc',express.raw({type:()=>true,limit:'32kb'}),async(req,res)=>{
    if(req.headers['content-type']?.startsWith('multipart'))report.apiMultipart++;
    if(await trust.verify(req.originalUrl,req.body,req.headers['x-voltex-kyc-edge-ts'],req.headers['x-voltex-kyc-edge-sig'])!=='ok')return res.status(403).json({code:'invalid_signature'});
    const d=JSON.parse(req.body.toString()),token=String(req.headers.authorization||'').replace(/^Bearer /,''),user=users.get(token);
    if(req.path==='/authorize'){
      if(!user||user.revoked)return res.status(401).json({});
      return res.json({submissionId:user.sub,userId:user.id,email:user.email,alreadySubmitted:user.status==='PENDING'});
    }
    if(req.path==='/materials/authorize'){
      if(!user||user.revoked)return res.status(401).json({});
      if(!user.material||d.materialRequestId!==user.material.id)return res.status(404).json({code:'kyc_material_request_not_found'});
      user.delivery??=randomUUID();return res.json({deliveryId:user.delivery,userId:user.id,email:user.email,fullName:'SYNTHETIC QA ONLY',submissionId:user.sub,alreadyReceived:user.material.selfieReceived});
    }
    const owner=[...users.values()].find(u=>u.id===d.userId);
    if(!owner)return res.status(404).json({});
    if(req.path==='/submission-confirmed'){
      if(owner.failConfirm){owner.failConfirm--;return res.status(503).json({});}
      owner.status='PENDING';owner.latest={id:owner.sub,country:d.country,fullName:d.fullName,documentType:d.documentType,status:'PENDING',createdAt:new Date().toISOString()};
      return res.status(201).json({status:'created'});
    }
    if(req.path==='/materials/confirmed'){owner.material.selfieReceived=true;return res.status(201).json({status:'created',complete:true});}
    return res.status(404).json({});
  });
  app.use(express.json());
  app.use('/api/v1',(req,res,next)=>{
    const token=String(req.headers.authorization||'').replace(/^Bearer /,''),user=users.get(token);
    if(!user||user.revoked)return res.status(401).json({error:'Missing bearer token'});
    req.qaUser=user;next();
  });
  app.get('/api/v1/me',(req,res)=>res.json({id:req.qaUser.id,email:req.qaUser.email,displayName:'SYNTHETIC QA ONLY',isAdmin:false,kycStatus:req.qaUser.status,twoFactorEnabled:false,createdAt:'2026-01-01T00:00:00Z'}));
  app.get('/api/v1/kyc/me',(req,res)=>{
    const u=req.qaUser;if(u.failRead){u.failRead--;return res.status(503).json({error:'synthetic outage'});}
    res.set('Cache-Control','no-store').json({kycStatus:u.status,latestSubmission:u.latest??null,materialRequest:u.material??null,reviewStage:u.material?(u.material.selfieReceived?'MATERIALS_RECEIVED':'SELFIE_REQUIRED'):undefined});
  });
  app.post('/api/v1/auth/logout',(req,res)=>{req.qaUser.revoked=true;res.json({ok:true});});
  app.use('/api/v1',(_req,res)=>res.status(404).json({error:'outside fixture'}));
  app.use(express.static(path.join(root,'frontend/dist'),{index:false}));app.get('*',(_req,res)=>res.sendFile(path.join(root,'frontend/dist/index.html')));
  server=app.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;edgeEnv.VOLTEX_API_ORIGIN=base;
  for(const d of ['client','proxy','logs'])fs.mkdirSync(path.join(temp,d));
  const cert=path.join(temp,'cert.pem'),key=path.join(temp,'key.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN='+HOST,'-addext','subjectAltName=DNS:'+HOST],{stdio:'ignore'});
  const tlsPort=19445;
  const renderer=`import sys;sys.path.insert(0,'ops/beget-rf');from endpoint import render;print(render(${JSON.stringify(temp)},${tlsPort},${server.address().port},${JSON.stringify(cert)},${JSON.stringify(key)},proxy_protocol=True),end='')`;
  // An exact isolated-port Origin alias only. Production continues to
  // accept exactly https://ru.voltextech.net; never a wildcard or arbitrary port.
  const vhost=execFileSync('python3',['-c',renderer],{cwd:root,encoding:'utf8'})
    .replaceAll('ru.voltextech.net',HOST).replaceAll('ru\\.voltextech\\.net',HOST)
    .replaceAll('https://'+HOST,ORIGIN)
    .replace('https://localhost$', 'https://localhost:'+RELAY_PORT+'$')
    .replaceAll('access_log off;',`access_log ${temp}/http.log qa;`);
  const username=os.userInfo().username;
  const conf=`load_module ${streamModule};\nuser ${username};\nmaster_process off;\npid ${temp}/pid;\nerror_log ${temp}/error.log crit;\nevents {}\nhttp {\nlog_format qa '$status|$host|$http_origin|$voltex_ru_foreign|$voltex_ru_unsafe|$proxy_protocol_addr';\nfastcgi_temp_path ${temp}/fastcgi;uwsgi_temp_path ${temp}/uwsgi;scgi_temp_path ${temp}/scgi;${vhost}}\nstream {log_format qp '$ssl_preread_server_name|$status';access_log ${temp}/stream.log qp;map $ssl_preread_server_name $fixed {default "";${HOST} 127.0.0.1:${tlsPort};}server {listen 127.0.0.1:${RELAY_PORT};ssl_preread on;proxy_protocol on;proxy_pass $fixed;proxy_timeout 60s;}}\n`;
  const confFile=path.join(temp,'nginx.conf');fs.writeFileSync(confFile,conf);execFileSync(nginx,['-p',temp,'-t','-c',confFile]);
  nginxProcess=spawn(nginx,['-p',temp,'-c',confFile,'-g','daemon off;'],{stdio:['ignore','ignore','pipe']});
  await new Promise((resolve,reject)=>{let tries=0;const connect=()=>{const s=tls.connect({host:'127.0.0.1',port:RELAY_PORT,servername:HOST,ca:fs.readFileSync(cert)},()=>{s.end();resolve();});s.on('error',e=>{if(++tries>25)reject(e);else setTimeout(connect,100);});};connect();});
  await new Promise((resolve,reject)=>{let result='';const s=tls.connect({host:'127.0.0.1',port:RELAY_PORT,servername:HOST,ca:fs.readFileSync(cert)},()=>s.write('GET /settings?tab=verification HTTP/1.1\r\nHost: '+HOST+':'+RELAY_PORT+'\r\nConnection: close\r\n\r\n'));s.on('data',d=>result+=d);s.on('error',reject);s.on('end',()=>{report.fixtureHttpStatus=result.split('\r\n')[0];resolve();});});
  const pub=execFileSync('openssl',['x509','-in',cert,'-pubkey','-noout']);const der=execFileSync('openssl',['pkey','-pubin','-outform','der'],{input:pub});const pin=createHash('sha256').update(der).digest('base64');
  // No environment proxy for this loopback-only fixture. Browser requests
  // to every other host are independently rejected below.
  browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--no-proxy-server','--ignore-certificate-errors-spki-list='+pin]});
  for(const width of [1440,390]){
    const token='synthetic-session-'+randomUUID(),user={id:randomUUID(),sub:randomUUID(),email:'synthetic-'+width+'@example.invalid',status:'NOT_STARTED',failRead:1,failConfirm:width===1440?1:0};users.set(token,user);
    const ctx=await browser.newContext({viewport:{width,height:width===390?844:900}});
    await ctx.route('**/*',route=>{
      const url=new URL(route.request().url());
      // The existing login page imports Google Fonts. Fulfil that known,
      // nonfunctional stylesheet locally; no network request is allowed.
      if(url.origin==='https://fonts.googleapis.com'&&route.request().resourceType()==='stylesheet'){
        report.stubbedPublicFontStylesheets++;return route.fulfill({status:200,contentType:'text/css',body:'/* isolated QA uses system fonts */'});
      }
      if(url.hostname!==HOST){report.outbound.push(url.origin);return route.abort();}return route.continue();
    });
    const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(ORIGIN+'/settings?tab=verification');await page.waitForURL(/\/login/);check(width+': guest uses ordinary login',true);
    await page.evaluate(token=>localStorage.setItem('exchange_token',token),token);
    await page.goto(ORIGIN+'/settings?tab=verification');await page.getByRole('alert').waitFor();
    await page.getByRole('button',{name:'Повторить',exact:true}).click();await page.locator('[data-kyc-state=NOT_STARTED]').waitFor();check(width+': network error and retry',true);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);check(width+': no page overflow',!overflow);
    await page.getByLabel('Полное имя (как в документе)',{exact:true}).fill('SYNTHETIC QA ONLY');await page.getByLabel('Дата рождения',{exact:true}).fill('1990-01-01');
    await page.locator('input[type=file]').setInputFiles({name:'SYNTHETIC-NOT-A-PASSPORT.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nSYNTHETIC QA ONLY — NOT AN ID\n%%EOF')});
    await page.screenshot({path:path.join(out,'synthetic-'+width+'-document.png'),fullPage:true});
    const before=report.mailCount;
    await page.getByRole('button',{name:'Отправить на проверку',exact:true}).dblclick();await page.locator('[data-kyc-state=PENDING]').waitFor();
    for(let n=0;n<50&&user.status!=='PENDING';n++)await new Promise(r=>setTimeout(r,100));
    check(width+': one synthetic email and pending metadata',report.mailCount===before+1&&user.status==='PENDING');
    user.material={id:randomUUID(),kind:'SELFIE',documentReason:null,documentReasonText:null,selfieComment:'SYNTHETIC FIXTURE REQUEST',documentRequested:false,selfieRequested:true,documentReceived:false,selfieReceived:false,createdAt:new Date().toISOString()};
    await page.reload();await page.getByRole('button',{name:'Сделать селфи',exact:true}).click();
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1000;c.height=800;const x=c.getContext('2d');for(let y=0;y<800;y+=25)for(let n=0;n<1000;n+=25){x.fillStyle=`rgb(${n%255},${y%255},${(n+y)%255})`;x.fillRect(n,y,25,25);}x.fillStyle='white';x.font='40px sans-serif';x.fillText('SYNTHETIC QA — NO REAL FACE',80,400);return c.toDataURL('image/png').split(',')[1];});
    const card=page.locator('[data-kyc-material-part=SELFIE]');await card.locator('input[type=file]').first().setInputFiles({name:'SYNTHETIC-NOT-A-SELFIE.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await card.getByRole('checkbox').check();await card.getByRole('button',{name:'Отправить на проверку',exact:true}).click();await page.locator('[data-kyc-material-part=SELFIE][data-received=true]').waitFor();
    check(width+': synthetic selfie accepted only with consent',user.material.selfieReceived&&report.mailCount===before+2);
    await page.screenshot({path:path.join(out,'synthetic-'+width+'-received.png'),fullPage:true});
    user.revoked=true;await page.reload();await page.waitForURL(/\/login/);check(width+': revoked session closes protected view',true);
    report.widths.push(width);await ctx.close();
  }
  check('multipart Content-Length and canonical Origin preserved',report.worker.every(r=>r.lengthMatches&&r.origin==='https://voltextech.net'));
  check('session header preserved for submit/materials',report.worker.filter(r=>r.path!=='/v1/confirm').every(r=>r.bearerPresent));
  check('transport client IP supplied to Worker',report.worker.every(r=>r.clientIp==='127.0.0.1'));
  check('receipt confirmation route exercised',report.worker.some(r=>r.path==='/v1/confirm'));
  check('documents never sent to metadata API',report.apiMultipart===0);
  check('no browser production or external connections',report.outbound.length===0);
  check('no page errors',report.errors.length===0);
  report.status='PASS';
}
main().catch(e=>{report.status='FAIL';report.failure=e.stack;console.error(e.message);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(nginxProcess){nginxProcess.kill('SIGTERM');await once(nginxProcess,'exit').catch(()=>{});}if(server)await new Promise(r=>server.close(r));
  if(report.status!=='PASS'&&fs.existsSync(path.join(temp,'error.log')))report.nginxDiagnostic=fs.readFileSync(path.join(temp,'error.log'),'utf8').slice(-4000);
  if(report.status!=='PASS')for(const n of ['http.log','stream.log'])if(fs.existsSync(path.join(temp,n)))report[n]=fs.readFileSync(path.join(temp,n),'utf8').slice(-4000);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));fs.rmSync(temp,{recursive:true,force:true});console.log(JSON.stringify({status:report.status,steps:report.steps.length,widths:report.widths,mailCount:report.mailCount,outbound:report.outbound.length,failure:report.failure?.split('\n')[0],nginxDiagnostic:report.nginxDiagnostic}));
});
