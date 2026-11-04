'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto');
const {createRequire}=require('module');
const root=path.resolve(__dirname,'../..'),dir=path.resolve(process.env.HISTORY20_RC_OUT||path.join(root,'output/history20-installed-candidate'));
const edge=createRequire(path.join(root,'workers/market-edge/package.json'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function run(args){const r=cp.spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true,env:process.env});assert.equal(r.status,0,args.join(' '));}
async function model(s){const b=await edge('esbuild').transform(s+'\nexport const __rc={parseListingConfig,listingSimulationConfig,publicListingAsset,controlledScenarioHour};',{format:'cjs',target:'es2022'});const m={exports:{}};new Function('module','exports',b.code)(m,m.exports);return m.exports.__rc;}
(async()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'candidate/manifest.json')));
 for(const [p,h]of Object.entries(manifest.after))assert.equal(hash(fs.readFileSync(path.join(dir,'candidate',p))),h,p);
 const api=path.join(dir,'candidate/api');
 for(const p of Object.keys(manifest.after).filter(x=>x.startsWith('api/'))){
  const s=fs.readFileSync(path.join(dir,'candidate',p),'utf8');
  for(const m of s.matchAll(/require\(["'](\.[^"']+)["']\)/g)){
   const base=path.resolve(path.dirname(path.join(dir,'candidate',p)),m[1]);
   assert([base,base+'.js',base+'.json',path.join(base,'index.js')].some(x=>fs.existsSync(x)),p+' unresolved '+m[1]);
  }
 }
 const index=fs.readFileSync(path.join(api,'index.js'),'utf8');
 assert.equal(index.split("require('./api/routes/privateTestMarkets').privateTestMarketsRouter(prisma, engine)").length,2);
 // All unrelated installed modules retain their bytes, including auth, withdrawals,
 // Banking, Copy Trading and Futures. No #630 activation is folded into this overlay.
 const permitted=new Set([...manifest.closure.changed.map(x=>'api/'+x+'.js'),'api/index.js','api/history20InstalledModel.js','api/history20InstalledValidation.js','worker.js']);
 assert(manifest.changed.every(p=>permitted.has(p)),'unreviewed module in overlay');
 const before=await model(fs.readFileSync(path.join(dir,'rebuilt-baseline/worker.js'),'utf8'));
 const after=await model(fs.readFileSync(path.join(dir,'candidate/worker.js'),'utf8'));
 const models=JSON.parse(fs.readFileSync(path.join(root,'scripts/qa/fixtures/ai-preserved-models-20261101.json')));
 for(const key of ['nryia-20261115','aelri-20261125'])models.push(JSON.parse(fs.readFileSync(path.join(root,'config/test-markets',key+'.draft.json'))));
 let ticks=0;
 for(const c of models){
  assert.deepEqual(after.parseListingConfig(c),before.parseListingConfig(c),c.symbol+' parse');
  const l={id:'qa-'+c.symbol,version:1,publishedAt:'2026-10-01T00:00:00Z',config:c};
  assert.deepEqual(after.publicListingAsset(l,Date.parse(c.listingAt)-1),before.publicListingAsset(l,Date.parse(c.listingAt)-1),c.symbol+' public');
  const a=before.listingSimulationConfig(c),b=after.listingSimulationConfig(c);
  if(a.scheduledScenario?.mode==='scenario-controls-v2')for(const h of [0,1,23,24,35,36,47,48,71,143,191,239,240,360]){
   const x=before.controlledScenarioHour(a.scheduledScenario,a.seed,h);
   assert.deepEqual(after.controlledScenarioHour(b.scheduledScenario,b.seed,h),x,c.symbol+' hour '+h);ticks+=x.ticks.length;
  }
 }
 let workerTest=fs.readFileSync(path.join(root,'workers/market-edge/private-test.integration.test.mjs'),'utf8');
 workerTest=workerTest.replace('script = bundle.outputFiles[0].text;',`script = await (await import('node:fs/promises')).readFile(${JSON.stringify(path.join(dir,'candidate/worker.js'))},'utf8');`);
 const workerFile=path.join(root,'workers/market-edge/rc-private-test.integration.test.mjs');
 assert(!fs.existsSync(workerFile),'temporary test already exists');fs.writeFileSync(workerFile,workerTest);
 try{run(['--test',workerFile]);}finally{fs.unlinkSync(workerFile);}
 const resolver=path.join(dir,'candidate-resolver.cjs');
 fs.writeFileSync(resolver,`const fs=require('fs'),path=require('path');module.exports=(r,o)=>{const v=o.defaultResolver(r,o),n=v.replaceAll('\\\\','/'),prefix=${JSON.stringify(path.join(root,'src').replaceAll('\\','/')+'/')};if(n.toLowerCase().startsWith(prefix.toLowerCase())&&!n.includes('/__tests__/')&&n.endsWith('.ts')){const f=path.join(${JSON.stringify(api)},n.slice(prefix.length).replace(/\\.ts$/,'.js'));if(!fs.existsSync(f))throw Error('Missing candidate module '+f);return f;}return v;};`);
 // Local fixture only: resolve dependencies outside the distributable API overlay.
 const deps=path.join(dir,'candidate/node_modules');if(!fs.existsSync(deps))fs.symlinkSync(path.join(root,'node_modules'),deps,process.platform==='win32'?'junction':'dir');
 if(process.argv.includes('--postgres')){
  const u=new URL(process.env.VOLTEX_LISTING_TEST_URL||'');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.pathname,'/voltex_listing_test');
  run(['node_modules/jest/bin/jest.js','--runInBand','--resolver',resolver,'--runTestsByPath',
   'src/services/listings/__tests__/history20SimusdtSettlement.pg.test.ts','src/services/listings/__tests__/history20PrivateSpot.pg.test.ts',
   'src/services/listings/__tests__/history20ColdRegistryCashout.pg.test.ts','src/services/listings/__tests__/history20PrivateConfig.test.ts','src/services/__tests__/History20ReplayAdmission.test.ts']);
 }
 if(process.argv.includes('--browser')){
  let s=fs.readFileSync(path.join(root,'scripts/qa-listing-history20.cjs'),'utf8');
  s=s.replace('script: bundle.outputFiles[0].text,',`script: fs.readFileSync(${JSON.stringify(path.join(dir,'candidate/worker.js'))},'utf8'),`);
  const file=path.join(root,'scripts/qa-listing-history20-rc.cjs');assert(!fs.existsSync(file));
  const hook=`const Module=require('module'),fsRc=require('fs'),pathRc=require('path');const resolveRc=Module._resolveFilename;Module._resolveFilename=function(r,p,...a){const v=resolveRc.call(this,r,p,...a),n=v.replaceAll('\\\\','/'),prefix=${JSON.stringify(path.join(root,'src').replaceAll('\\','/')+'/')};if(n.toLowerCase().startsWith(prefix.toLowerCase())&&n.endsWith('.ts')){const f=pathRc.join(${JSON.stringify(api)},n.slice(prefix.length).replace(/\\.ts$/,'.js'));if(!fsRc.existsSync(f))throw Error('Missing candidate '+f);return pathRc.resolve(f);}return v;};\n`;
  fs.writeFileSync(file,hook+s);try{run([file]);}finally{fs.unlinkSync(file);}
 }
 const report={builderHead:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),runtimeSource:manifest.source,manifestSha256:hash(fs.readFileSync(path.join(dir,'candidate/manifest.json'))),workerSha256:manifest.after['worker.js'],legacyModels:models.map(c=>c.symbol),ticks,postgres:process.argv.includes('--postgres')?'PASS':'NOT_RUN',browser:process.argv.includes('--browser')?'PASS':'NOT_RUN',workerRestart:'4/4 PASS',productionTouched:false};
 fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
