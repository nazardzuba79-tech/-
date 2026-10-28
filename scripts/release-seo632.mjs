// Issue #632: single reviewed static frontend publication, no other infrastructure.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const cfg=JSON.parse(fs.readFileSync('ops/pages/seo632-release.json','utf8'));
const out='output/seo632-release';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const commit=process.argv[2]==='smoke' && process.env.SEO632_EXPECTED_SOURCE ? process.env.SEO632_EXPECTED_SOURCE : git('rev-parse','HEAD');
const apiPath=`/accounts/${cfg.account}/pages/projects/${cfg.project}`;
fs.mkdirSync(out,{recursive:true});
const save=(name,body)=>fs.writeFileSync(path.join(out,name),JSON.stringify(body,null,2));

export function assertLease(p) {
  assert.equal(p.name,cfg.project);assert.equal(p.production_branch,'main');
  assert.equal(p.source.type,'github');assert.equal(p.source.config.owner,'nazardzuba79-tech');assert.equal(p.source.config.repo_name,'-');
  assert.equal(p.source.config.production_deployments_enabled,false);assert.equal(p.source.config.preview_deployment_setting,'none');
  const d=p.canonical_deployment;
  assert.equal(d.id,cfg.previousDeployment);assert.equal(d.deployment_trigger.metadata.commit_hash,cfg.base);
  assert.equal(d.latest_stage.status,'success');assert.equal(d.environment,'production');assert.equal(d.uses_functions,false);
  const vars=p.deployment_configs.production.env_vars;
  assert.deepEqual(Object.keys(vars).sort(),Object.keys(cfg.env).sort());
  for(const [k,v] of Object.entries(cfg.env)){assert.equal(vars[k].type,'plain_text');assert.equal(vars[k].value,v);}
}

function verifySource() {
  assert.equal(git('rev-parse','HEAD^'),cfg.base,'Candidate must be a direct child of actual production');
  assert.equal(git('rev-parse','HEAD:frontend'),cfg.frontendTree,'Reviewed frontend tree changed');
  const names=git('diff','--name-only',cfg.base,'HEAD').split('\n');
  assert(names.length>0&&names.every(p=>cfg.allowedPaths.includes(p)),'Out-of-scope source change');
  assert.equal(git('status','--porcelain','--untracked-files=no'),'','Tracked worktree is dirty');
  const baseHeaders=git('show',`${cfg.base}:frontend/public/_headers`);
  assert(fs.readFileSync('frontend/public/_headers','utf8').startsWith(baseHeaders),'Existing cache headers changed');
  for(const f of ['frontend/src/pages/BankingPage.tsx','frontend/src/lib/bankingApi.ts','frontend/src/pages/admin/AdminListingsPage.tsx',
    'frontend/src/pages/admin/adminListingsApi.ts','frontend/src/pages/admin/listingMovementModel.ts','frontend/src/lib/testMarkets.ts',
    'frontend/src/lib/testMarketStore.ts','frontend/src/components/TestMarketTerminal.tsx','frontend/src/lib/api.ts','frontend/src/lib/referralLinks.ts']) {
    assert.equal(git('rev-parse',`HEAD:${f}`),git('rev-parse',`${cfg.base}:${f}`),`Preserved runtime changed: ${f}`);
  }
  save('source.json',{commit,base:cfg.base,frontendTree:cfg.frontendTree,changedFiles:names,preservedRuntimeFiles:10});
}

async function cf(method,suffix='',body) {
  const token=process.env.CF_TOKEN;if(!token)throw Error('Existing CLOUDFLARE_PAGES_TOKEN is unavailable; nothing deployed');
  const r=await fetch('https://api.cloudflare.com/client/v4'+apiPath+suffix,{method,
    headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  const j=await r.json();if(!r.ok||!j.success)throw Error(`Pages ${method} failed (HTTP ${r.status})`);return j.result;
}

function manifest() {
  const files=[];const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else{const b=fs.readFileSync(f);files.push({path:path.relative('frontend/dist',f),bytes:b.length,sha256:digest(b)});}}};
  assert(!fs.existsSync('frontend/dist/_worker.js'));assert(!fs.existsSync('frontend/dist/_worker.bundle'));
  walk('frontend/dist');files.sort((a,b)=>a.path.localeCompare(b.path));
  save('asset-manifest.json',files);return {files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),sha256:digest(JSON.stringify(files))};
}

async function get(relative) {
  const r=await fetch(`https://voltextech.net${relative}${relative.includes('?')?'&':'?'}seo632=${commit}`,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)});
  return {status:r.status,type:r.headers.get('content-type')||'',xRobots:r.headers.get('x-robots-tag'),body:await r.text()};
}
async function smoke() {
  assert(/^[a-f0-9]{40}$/.test(commit));
  assert.equal(git('rev-parse',`${commit}^`),cfg.base);
  assert.equal(git('rev-parse','HEAD:frontend'),cfg.frontendTree);
  assert.equal(git('rev-parse',`${commit}:frontend`),cfg.frontendTree);
  assert.equal(git('rev-parse','HEAD:src/shared'),git('rev-parse',`${commit}:src/shared`));
  const robots=await get('/robots.txt'),sitemap=await get('/sitemap.xml');
  assert.equal(robots.status,200);assert(robots.type.startsWith('text/plain'));assert.equal(robots.body,fs.readFileSync('frontend/dist/robots.txt','utf8'));
  assert.equal(sitemap.status,200);assert(/xml/.test(sitemap.type));assert.equal(sitemap.body,fs.readFileSync('frontend/dist/sitemap.xml','utf8'));
  const urls=[...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);assert.equal(urls.length,42);
  const pages=[];
  for(const u of urls){assert(u.startsWith('https://voltextech.net/'));const r=await get(new URL(u).pathname);
    assert.equal(r.status,200);assert(r.type.startsWith('text/html'));assert.equal([...r.body.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map(m=>m[1]).join(),u);
    assert(!r.xRobots);assert(!/<meta name="robots" content="noindex/.test(r.body));pages.push({path:new URL(u).pathname,status:r.status});}
  for(const p of ['/banking','/admin/listings','/trade?pair=ECLV%2FUSDT','/trade?pair=QVTR%2FUSDT','/trade?pair=NRX%2FBTC']){
    const r=await get(p);assert.equal(r.status,200);assert.equal(r.xRobots,'noindex, nofollow');assert(r.body.includes('<meta name="robots" content="noindex, nofollow"'));
    assert(!r.body.includes('<link rel="canonical"'));pages.push({path:p,status:r.status,noindex:true});}
  const home=await get('/');const entry=/src="([^\"]+\/index-[^\"]+\.js)"/.exec(home.body)?.[1];assert(entry,'Production entry missing');
  const local=fs.readFileSync(path.join('frontend/dist',entry.replace(/^\//,'')));const remote=await fetch(`https://voltextech.net${entry}`,{signal:AbortSignal.timeout(30000)});assert.equal(remote.status,200);
  assert.equal(digest(Buffer.from(await remote.arrayBuffer())),digest(local),'Published entry does not match tested artifact');
  // Native Pages Git builds do not create the Direct Upload-only marker.
  // Their exact source is checked through the authenticated provider API;
  // the actual published JS is still compared byte-for-byte here.
  if(process.env.SEO632_GIT_BUILD!=='true') {const marker=await get('/voltex-seo-release.json');assert.equal(marker.status,200);assert.equal(JSON.parse(marker.body).source,commit);}
  save('live-smoke.json',{checkedAt:new Date().toISOString(),commit,robots:{status:robots.status,type:robots.type,sha256:digest(robots.body)},
    sitemap:{status:sitemap.status,type:sitemap.type,sha256:digest(sitemap.body),urls:urls.length},pages,entry:{path:entry,sha256:digest(local)},sourceChannel:process.env.SEO632_GIT_BUILD==='true'?'Pages Git canonical API plus published JS hash':'Direct Upload marker plus published JS hash',financialRequests:0});
  console.log(JSON.stringify({result:'LIVE_SMOKE_PASS',source:commit,robotsType:robots.type,sitemapType:sitemap.type,urls:urls.length,checkedPages:pages.length,entry,entrySHA256:digest(local)}));
}

async function release() {
  verifySource();const before=await cf('GET');assertLease(before);
  const deployments=await cf('GET','/deployments?per_page=20');
  assert(!deployments.some(d=>!d.is_skipped&&!['success','failure','canceled','skipped'].includes(d.latest_stage?.status)),'Another deployment is active');
  save('rollback.json',{deployment:cfg.previousDeployment,source:cfg.base,method:'POST',path:`${apiPath}/deployments/${cfg.previousDeployment}/rollback`});
  const assets=manifest();fs.writeFileSync('frontend/dist/voltex-seo-release.json',JSON.stringify({source:commit,base:cfg.base,seoPR:634,assets}));
  // Last lease immediately before the only frontend publication.
  assertLease(await cf('GET'));
  try {
    const wrangler=process.env.QA_WRANGLER_BIN;assert(wrangler&&fs.existsSync(wrangler));
    execFileSync(wrangler,['pages','deploy','frontend/dist','--project-name',cfg.project,'--branch','main','--commit-hash',commit,'--commit-dirty=false',
      '--commit-message','Owner-approved Issue632 SEO-only compatible artifact over f8805b00'],{stdio:'inherit',timeout:600000,
      env:{...process.env,CLOUDFLARE_API_TOKEN:process.env.CF_TOKEN,CLOUDFLARE_ACCOUNT_ID:cfg.account,WRANGLER_SEND_METRICS:'false'}});
    const p=await cf('GET'),d=p.canonical_deployment;
    assert.equal(d.deployment_trigger.metadata.commit_hash,commit);assert.equal(d.latest_stage.status,'success');assert.equal(d.environment,'production');assert.equal(d.uses_functions,false);
    assert.equal(p.source.config.production_deployments_enabled,false);assert.equal(p.source.config.preview_deployment_setting,'none');
    save('deployment.json',{checkedAt:new Date().toISOString(),source:commit,deployment:d.id,previous:cfg.previousDeployment,status:'success',assets,rollbackPerformed:false});
    await smoke();console.log(JSON.stringify({result:'PUBLISHED_SMOKE_PASS',source:commit,deployment:d.id}));
  }catch(error){
    const p=await cf('GET');
    if(p.canonical_deployment.deployment_trigger.metadata.commit_hash===commit){
      await cf('POST',`/deployments/${cfg.previousDeployment}/rollback`);const restored=await cf('GET');
      assert.equal(restored.canonical_deployment.id,cfg.previousDeployment);assert.equal(restored.canonical_deployment.deployment_trigger.metadata.commit_hash,cfg.base);
      save('rollback-performed.json',{at:new Date().toISOString(),restored:cfg.previousDeployment,source:cfg.base});
    }
    throw error;
  }
}

if(process.argv[2]==='verify') {verifySource();console.log('Reviewed source and preserved runtime pins PASS');}
else if(process.argv[2]==='release')await release();
else if(process.argv[2]==='smoke')await smoke();
else if(process.argv[2]==='self-test') {
  const good={name:cfg.project,production_branch:'main',source:{type:'github',config:{owner:'nazardzuba79-tech',repo_name:'-',production_deployments_enabled:false,preview_deployment_setting:'none'}},
    canonical_deployment:{id:cfg.previousDeployment,deployment_trigger:{metadata:{commit_hash:cfg.base}},latest_stage:{status:'success'},environment:'production',uses_functions:false},
    deployment_configs:{production:{env_vars:Object.fromEntries(Object.entries(cfg.env).map(([k,value])=>[k,{type:'plain_text',value}]))}}};
  assertLease(good);let rejected=0;
  for(const mutate of [p=>p.canonical_deployment.deployment_trigger.metadata.commit_hash='other',p=>p.canonical_deployment.id='other',
    p=>p.source.config.production_deployments_enabled=true,p=>p.source.config.preview_deployment_setting='all',p=>p.canonical_deployment.uses_functions=true,
    p=>p.deployment_configs.production.env_vars.VITE_STOCKS_ENABLED={type:'plain_text',value:'true'}]){const p=structuredClone(good);mutate(p);assert.throws(()=>assertLease(p));rejected++;}
  console.log(`Production lease: valid PASS; ${rejected} unsafe states rejected`);
}
