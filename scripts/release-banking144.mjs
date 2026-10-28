// VOLTEX #144: a single reviewed, frontend-only Banking copy release.
// Must run on the exact canonical Pages-derived release branch with owner-authorized credentials.
// The script performs no API/Worker/PostgreSQL/financial operation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const BASE='6118e18e49edd226a6b250154d3893773b4522e2';
const PREVIOUS='95010b1c-b13f-4c52-b08c-a90ffa7d5d60';
const ACCOUNT='c379227476dedde6dff09c787ffdb510';
const PROJECT='voltex-exchange';
const ROOT='https://voltextech.net';
const API_PATH='/accounts/'+ACCOUNT+'/pages/projects/'+PROJECT;
const OUT='output/banking144-release';
const BANKING='frontend/src/pages/BankingPage.tsx';
const ALLOWED=[
  BANKING, '.github/workflows/pages-banking-copy-144-test.yml',
  '.github/workflows/pages-banking-copy-production.yml',
  'scripts/release-banking144.mjs'
];
const FROM=[
  'Размещение создано. Данные сохранены в Banking ledger.',
  'Данные из Banking ledger',
  'Расчёт выполняется на сервере через BigNumber и учитывает только завершённые календарные месяцы.'
];
const TO=[
  'Размещение создано. Оно появилось в разделе «Мои размещения».',
  'По данным вашего счёта Banking',
  'Расчёт выполняется на сервере и учитывает только завершённые календарные месяцы.'
];
const ENV={
  VITE_API_URL:'https://api.voltextech.net/api/v1',
  VITE_DEPOSIT_CATALOGUE_URL:'https://voltex-deposit-catalogue-production.nazardzuba79.workers.dev',
  VITE_MANUAL_DEPOSIT_CATALOGUE:'true'
};
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',timeout:25000}).trim();
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const SHA=git('rev-parse','HEAD');
fs.mkdirSync(OUT,{recursive:true});
const save=(name,data)=>fs.writeFileSync(path.join(OUT,name),JSON.stringify(data,null,2));

function verifySource(){
  assert.equal(git('merge-base',BASE,SHA),BASE,'The candidate must descend from canonical production source');
  const files=git('diff','--name-only',BASE,SHA).split('\n').filter(Boolean);
  assert.deepEqual([...files].sort(),[...ALLOWED].sort(),'Unexpected production diff');
  const parent=git('show',BASE+':'+BANKING);
  let expected=parent;
  for(let i=0;i<FROM.length;i++){
    assert.equal(expected.split(FROM[i]).length-1,1,'Unexpected original text / duplicate');
    expected=expected.replace(FROM[i],TO[i]);
  }
  assert.equal(fs.readFileSync(BANKING,'utf8').trim(),expected.trim(),'Banking must contain EXACT approved customer copy only');
  assert.equal(git('status','--porcelain','--untracked-files=no'),'','Tracked checkout changed');
  const expectedFlags=['VITE_WALLET_CONVERSION_ENABLED','VITE_STOCKS_ENABLED','VITE_STOCKS_ORDER_EXECUTION_ENABLED'];
  for(const key of expectedFlags) assert(!process.env[key]||process.env[key]==='false','Unsafe frontend feature enabled: '+key);
  save('source.json',{sha:SHA,base:BASE,files,bankingFileSha256:sha256(expected),flags:'OFF',financialWrites:0});
}
function assertLease(p){
  assert.equal(p.name,PROJECT);
  assert.equal(p.production_branch,'main');
  assert.equal(p.source?.type,'github');
  assert.equal(p.source?.config?.owner,'nazardzuba79-tech');
  assert.equal(p.source?.config?.repo_name,'-');
  assert.equal(p.source?.config?.production_deployments_enabled,false);
  assert.equal(p.source?.config?.preview_deployment_setting,'none');
  assert.equal(p.canonical_deployment?.id,PREVIOUS,'Another Pages deployment has replaced canonical');
  assert.equal(p.canonical_deployment?.deployment_trigger?.metadata?.commit_hash,BASE);
  assert.equal(p.canonical_deployment?.environment,'production');
  assert.equal(p.canonical_deployment?.latest_stage?.status,'success');
  assert.equal(p.canonical_deployment?.uses_functions,false);
  const vars=p.deployment_configs.production.env_vars;
  assert.deepEqual(Object.keys(vars).sort(),Object.keys(ENV).sort());
  for(const [k,v] of Object.entries(ENV)){
    assert.equal(vars[k]?.type,'plain_text');
    assert.equal(vars[k]?.value,v);
  }
}
async function cf(method,suffix=''){
  const token=process.env.CF_TOKEN;
  assert(token,'No Cloudflare Pages release secret available; no deployment performed');
  const r=await fetch('https://api.cloudflare.com/client/v4'+API_PATH+suffix,{
    method,headers:{Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(30000)
  });
  const json=await r.json();
  assert(r.ok&&json.success,'Cloudflare Pages '+method+' request failed HTTP '+r.status);
  return json.result;
}
async function get(url){
  const r=await fetch(ROOT+url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)});
  return {status:r.status,type:r.headers.get('content-type')||'',text:await r.text()};
}
function findOneAsset(partial){
  const base='frontend/dist/assets';
  const found=fs.readdirSync(base).filter(n=>n.startsWith(partial)&&n.endsWith('.js'));
  assert.equal(found.length,1,'Expected one Banking JS asset: '+partial);
  return '/assets/'+found[0];
}
async function smoke(){
  const banking=findOneAsset('BankingPage-');
  const local=fs.readFileSync('frontend/dist'+banking);
  const remote=await fetch(ROOT+banking,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)});
  assert.equal(remote.status,200,'Missing deployed Banking asset');
  const raw=Buffer.from(await remote.arrayBuffer());
  assert.equal(sha256(raw),sha256(local),'Banking chunk differs from tested static artifact');
  const blob=raw.toString('utf8');
  assert(!blob.includes('Banking ledger')&&!blob.includes('BigNumber'),'Old developer text in live Banking');
  for(const expected of TO) assert(blob.includes(expected),'A Banking copy line was not deployed');
  const [home,bank,robots,sitemap,marker]=await Promise.all([
    get('/'),get('/banking'),get('/robots.txt'),get('/sitemap.xml'),get('/voltex-banking-release.json')
  ]);
  assert.equal(home.status,200);assert.equal(bank.status,200);
  assert.equal(robots.status,200);assert.equal(sitemap.status,200);
  assert(robots.type.startsWith('text/plain'));assert(sitemap.type.includes('xml'));
  assert.equal(robots.text,fs.readFileSync('frontend/dist/robots.txt','utf8'),'Robots changed');
  assert.equal(sitemap.text,fs.readFileSync('frontend/dist/sitemap.xml','utf8'),'Sitemap changed');
  assert.equal(marker.status,200);assert.equal(JSON.parse(marker.text).source,SHA);
  const script=/src="([^"]*\/index-[^"]+\.js)"/.exec(home.text)?.[1];
  assert(script,'Production homepage entry script missing');
  const localMain=fs.readFileSync('frontend/dist'+script);
  const webMain=await fetch(ROOT+script,{signal:AbortSignal.timeout(30000)});
  assert.equal(webMain.status,200);
  assert.equal(sha256(Buffer.from(await webMain.arrayBuffer())),sha256(localMain));
  save('smoke.json',{at:new Date().toISOString(),sha:SHA,bankingAsset:banking,bankingHash:sha256(local),entry:script,robotsHash:sha256(robots.text),sitemapHash:sha256(sitemap.text),financialRequests:0});
}
async function release(){
  verifySource();
  const before=await cf('GET');assertLease(before);
  const deployments=await cf('GET','/deployments?per_page=20');
  assert(!deployments.some(d=>!d.is_skipped&&!['success','failure','canceled','skipped'].includes(d.latest_stage?.status)),'Concurrent Pages deployment in progress');
  assert(fs.existsSync('frontend/dist/robots.txt')&&fs.existsSync('frontend/dist/sitemap.xml'),'Built SEO artifacts absent');
  assert(!fs.existsSync('frontend/dist/_worker.js'),'Unexpected Worker in static artifact');
  fs.writeFileSync('frontend/dist/voltex-banking-release.json',JSON.stringify({source:SHA,base:BASE,issue:144}));
  // Lease immediately before the one production write.
  assertLease(await cf('GET'));
  save('rollback-prepared.json',{previousDeployment:PREVIOUS,source:BASE,release:SHA});
  let published=false;
  try{
    const wrangler=process.env.QA_WRANGLER_BIN;
    assert(wrangler&&fs.existsSync(wrangler),'Wrangler missing');
    execFileSync(wrangler,['pages','deploy','frontend/dist',
      '--project-name',PROJECT,'--branch','main',
      '--commit-hash',SHA,'--commit-dirty=false',
      '--commit-message','Reviewed Banking #144 customer copy only, baseline '+BASE.slice(0,8)],{
      stdio:'inherit',timeout:600000,env:{
        ...process.env,CLOUDFLARE_API_TOKEN:process.env.CF_TOKEN,
        CLOUDFLARE_ACCOUNT_ID:ACCOUNT,WRANGLER_SEND_METRICS:'false'
      }
    });
    published=true;
    const p=await cf('GET'),d=p.canonical_deployment;
    assert.equal(d.deployment_trigger.metadata.commit_hash,SHA);
    assert.equal(d.latest_stage.status,'success');
    assert.equal(d.environment,'production');assert.equal(d.uses_functions,false);
    assert.equal(p.source.config.production_deployments_enabled,false);
    assert.equal(p.source.config.preview_deployment_setting,'none');
    await smoke();
    save('deployment.json',{status:'PUBLISHED_SMOKE_PASS',sha:SHA,id:d.id,rollback:false});
    console.log('BANKING144_PRODUCTION_PASS '+SHA);
  }catch(e){
    // Never roll back a different operator's later publication.
    const p=await cf('GET');
    if(p.canonical_deployment?.deployment_trigger?.metadata?.commit_hash===SHA){
      const restored=await cf('POST','/deployments/'+PREVIOUS+'/rollback');
      const check=await cf('GET');
      assert.equal(check.canonical_deployment?.deployment_trigger?.metadata?.commit_hash,BASE,'Rollback did not restore expected source');
      save('rollback-executed.json',{at:new Date().toISOString(),previous:PREVIOUS,restored:restored?.id||null,sha:BASE});
    }
    save('error.json',{message:String(e),afterUpload:published});
    throw e;
  }
}
const command=process.argv[2];
if(command==='verify'){verifySource();console.log('BANKING144_SOURCE_PASS '+SHA);}
else if(command==='release'){await release();}
else if(command==='self-test'){
  const baseline={name:PROJECT,production_branch:'main',source:{type:'github',config:{owner:'nazardzuba79-tech',repo_name:'-',production_deployments_enabled:false,preview_deployment_setting:'none'}},
    canonical_deployment:{id:PREVIOUS,deployment_trigger:{metadata:{commit_hash:BASE}},environment:'production',latest_stage:{status:'success'},uses_functions:false},
    deployment_configs:{production:{env_vars:Object.fromEntries(Object.entries(ENV).map(([k,value])=>[k,{type:'plain_text',value}]))}}};
  assertLease(baseline);
  for(const modify of [p=>p.canonical_deployment.id='bad',p=>p.canonical_deployment.deployment_trigger.metadata.commit_hash='bad',p=>p.source.config.production_deployments_enabled=true,p=>p.deployment_configs.production.env_vars.VITE_STOCKS_ENABLED={type:'plain_text',value:'true'}]){
    const p=structuredClone(baseline);modify(p);assert.throws(()=>assertLease(p));
  }
  console.log('BANKING144_LEASE_SELFTEST_PASS');
}
else throw Error('Expected verify / self-test / release');
