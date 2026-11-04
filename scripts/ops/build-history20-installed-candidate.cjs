'use strict';
// Local-only composition. No upload, database connection, migration or activation.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const {createRequire}=require('module');
const root=path.resolve(__dirname,'../..'),dir=path.resolve(process.env.HISTORY20_RC_OUT||path.join(root,'output/history20-installed-candidate')),out=path.join(dir,'candidate');
const zlib=require('zlib');
const {build}=createRequire(root+'/workers/market-edge/package.json')('esbuild');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const identity='20972f4e343ff4d3df3ab53fa0fb0e6af5285d75';
const historical=`function history20(c){const p=c?.simulationProgram||c?.controls||c?.scheduledScenario?.controls||c;return !!c?.privateTest||/^VHX[0-9]{2}$/.test(c?.symbol||'')||c?.symbol==='SIMUSDT'||p?.growth==='historical-window'||p?.afterGrowth==='historical';}`;
function put(p,s){const f=path.join(out,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof s==='string'?s.replace(/\r\n/g,'\n'):s);}
function once(s,a,b){if(s.split(a).length!==2)throw Error('Non-unique index anchor');return s.replace(a,b);}
(async()=>{
  if(cp.execFileSync('git',['diff',identity,'--','src','workers/market-edge/src'],{cwd:root,encoding:'utf8'}).trim())throw Error('Runtime source differs from reviewed identity');
  fs.mkdirSync(dir,{recursive:true});
  const archive=path.join(root,'scripts/qa/fixtures/history20-installed-api-41a755a9.tgz');
  if(hash(fs.readFileSync(archive))!=='5049ca8fdb87181bd36c27219797b8486598673c806cab7e005aaf33fb9b3d8e')throw Error('API capture identity mismatch');
  const names=cp.execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);
  if(names.some(n=>n.startsWith('/')||n.split('/').includes('..')||!(/^(dist(?:\/|$)|package(?:-lock)?\.json$|prisma\/schema\.prisma$)/.test(n))))throw Error('Unsafe archive entry');
  cp.execFileSync('tar',['-xzf',archive,'-C',dir]);
  fs.mkdirSync(path.join(dir,'rebuilt-baseline'),{recursive:true});
  fs.writeFileSync(path.join(dir,'rebuilt-baseline/worker.js'),zlib.gunzipSync(fs.readFileSync(path.join(root,'scripts/qa/fixtures/history20-installed-worker-41a755a9.js.gz'))));
  const built=(await build({absWorkingDir:path.join(root,'workers/market-edge'),entryPoints:['src/worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*']})).outputFiles[0].text;
  fs.writeFileSync(path.join(dir,'main-worker.js'),built);
  const closure=JSON.parse(fs.readFileSync(path.join(root,'scripts/qa/fixtures/history20-installed-closure.json')));
  fs.writeFileSync(path.join(dir,'closure.json'),JSON.stringify(closure));
  const baselineWorker=fs.readFileSync(path.join(dir,'rebuilt-baseline/worker.js'),'utf8');
  if(hash(baselineWorker)!=='38de0f2aa96056df1a2ef2d4b9a741c29fa52fd139bcc64e75d4d8c9a9d0dede')throw Error('Worker baseline mismatch');
  fs.mkdirSync(out,{recursive:true});
  fs.cpSync(path.join(dir,'dist'),path.join(out,'api'),{recursive:true,filter:p=>!p.endsWith('.main')});
  // closure was verified and pinned before copying reviewed runtime modules.
  for(const p of closure.changed)put('api/'+p+'.js',fs.readFileSync(root+'/dist/'+p+'.js','utf8'));
  put('api/services/listings/listingPublic.js',fs.readFileSync(root+'/dist/services/listings/listingPublic.js','utf8'));
  const legacy=(await build({stdin:{contents:`module.exports={...require(${JSON.stringify(path.join(dir,'dist/services/listings/listingConfig.js'))}),publicListingAsset:require(${JSON.stringify(path.join(dir,'dist/services/listings/listingPublic.js'))}).publicListingAsset,controlledScenarioHour:require(${JSON.stringify(path.join(dir,'dist/services/testMarkets/simulationScenarioControls.js'))}).controlledScenarioHour};`,resolveDir:root},bundle:true,write:false,minifyWhitespace:true,legalComments:'none',format:'cjs',platform:'node',target:'es2021',nodePaths:[root+'/node_modules'],external:['zod','bignumber.js','crypto','node:crypto']})).outputFiles[0].text;
  put('api/history20InstalledModel.js',legacy);
  const wrapper=`\n// Keep the installed model for every non-History20 listing.\n${historical}\nconst installed=require('../../history20InstalledModel');\n`;
  let config=fs.readFileSync(path.join(out,'api/services/listings/listingConfig.js'),'utf8');
  config+=wrapper+`const currentParse=exports.parseListingConfig,currentSimulation=exports.listingSimulationConfig;\nparseListingConfig=exports.parseListingConfig=(c)=>{if(history20(c))return currentParse(c);try{return installed.parseListingConfig(c);}catch(e){if(e instanceof installed.ListingValidationError)throw new ListingValidationError(e.code,e.message);throw e;}};\nlistingSimulationConfig=exports.listingSimulationConfig=(c)=>history20(c)?currentSimulation(c):installed.listingSimulationConfig(c);\n`;
  put('api/services/listings/listingConfig.js',config);
  let pub=fs.readFileSync(path.join(out,'api/services/listings/listingPublic.js'),'utf8');
  pub+=wrapper+`const currentPublic=exports.publicListingAsset;publicListingAsset=exports.publicListingAsset=(l,...a)=>history20(l.config)?currentPublic(l,...a):installed.publicListingAsset(l,...a);\n`;
  put('api/services/listings/listingPublic.js',pub);
  for(const [p,name]of [['shared/listingScenarioControls','validateScenarioControls'],['services/testMarkets/simulationScenarioControls','controlledScenarioHour']]){
    let s=fs.readFileSync(path.join(out,'api',p+'.js'),'utf8');
    const rel=p.startsWith('shared/')?'../history20InstalledModel':'../../history20InstalledModel';
    // validator is captured from the installed pure module separately below.
    s+=`\n${historical}\nconst installedModel=require('${rel}');const history20Function=exports.${name};${name}=exports.${name}=(c,...args)=>history20(c)?history20Function(c,...args):installedModel.${name}(c,...args);\n`;
    put('api/'+p+'.js',s);
  }
  // The baseline validator lives outside listingConfig's public exports.
  const validation=(await build({entryPoints:[path.join(dir,'dist/shared/listingScenarioControls.js')],bundle:true,write:false,minifyWhitespace:true,legalComments:'none',format:'cjs',platform:'node',target:'es2021',nodePaths:[root+'/node_modules']})).outputFiles[0].text;
  put('api/history20InstalledValidation.js',validation);
  fs.appendFileSync(path.join(out,'api/history20InstalledModel.js'),"\nmodule.exports.validateScenarioControls=require('./history20InstalledValidation').validateScenarioControls;\n");
  let index=fs.readFileSync(path.join(dir,'dist/index.js'),'utf8');
  const anchor="app.use('/api/v1', (0, testMarkets_1.testMarketsRouter)());";
  index=once(index,anchor,anchor+"\napp.use('/api/v1', require('./api/routes/privateTestMarkets').privateTestMarketsRouter(prisma, engine));");
  put('api/index.js',index);
  const exposes='export const __installed={parseListingConfig,listingSimulationConfig,publicListingAsset,controlledScenarioHour,validateScenarioControls,ListingValidationError,index_default};';
  const installedWorker=(await build({stdin:{contents:baselineWorker+'\n'+exposes,loader:'js'},bundle:true,write:false,format:'iife',globalName:'InstalledHistory20Baseline',platform:'browser',target:'es2022'})).outputFiles[0].text;
  let worker=fs.readFileSync(path.join(dir,'main-worker.js'),'utf8');
  worker+='\n'+installedWorker+'\n'+historical+`\nconst installedModel=InstalledHistory20Baseline.__installed;\nconst currentParse=parseListingConfig,currentSimulation=listingSimulationConfig,currentHour=controlledScenarioHour,currentValidate=validateScenarioControls,currentPublic=publicListingAsset;\nparseListingConfig=(c)=>{if(history20(c))return currentParse(c);try{return installedModel.parseListingConfig(c);}catch(e){if(e instanceof installedModel.ListingValidationError)throw new ListingValidationError(e.code,e.message);throw e;}};\nlistingSimulationConfig=(c)=>history20(c)?currentSimulation(c):installedModel.listingSimulationConfig(c);\ncontrolledScenarioHour=(c,...a)=>history20(c)?currentHour(c,...a):installedModel.controlledScenarioHour(c,...a);\nvalidateScenarioControls=(c,...a)=>history20(c)?currentValidate(c,...a):installedModel.validateScenarioControls(c,...a);\npublicListingAsset=(l,...a)=>history20(l.config)?currentPublic(l,...a):installedModel.publicListingAsset(l,...a);\n// Keep the installed non-listing market-data router (Spot/CFD/other feeds).\nindex_default=installedModel.index_default;\n`;
  put('worker.js',worker);
  const entries={};function walk(base,p=''){for(const f of fs.readdirSync(path.join(base,p),{withFileTypes:true})){const n=path.posix.join(p,f.name);if(f.isDirectory())walk(base,n);else if(f.name.endsWith('.js'))entries[n]=hash(fs.readFileSync(path.join(base,n)));}}walk(out);
  const before={};for(const p of Object.keys(entries)){if(!p.startsWith('api/'))continue;const f=path.join(dir,'dist',p.slice(4));before[p]=fs.existsSync(f)?hash(fs.readFileSync(f)):null;}
  const changed=Object.keys(entries).filter(p=>p==='worker.js'||before[p]!==entries[p]);
  const manifest={source:identity,installedApiCommit:'41a755a9e163d278e786202be61627697149eb2a',installedImage:'sha256:a5311f57832b0ba59eaf2db39324bb462e6ee71cff3083cd0d6e8402d8d20c35',installedWorkerVersion:'f13215c0-4767-47df-a901-673770569570',installedWorkerSha256:hash(baselineWorker),scope:'HISTORY20_PINNED_COMPOSITION_OFF',postgresMigrations:[],workerMigrations:[],activate:false,closure,changed,before,after:entries};
  put('manifest.json',JSON.stringify(manifest,null,2));
  put('Dockerfile',`FROM ${manifest.installedImage}\nCOPY api/ /app/dist/\n`);
  console.log(JSON.stringify({apiModules:Object.keys(entries).length-1,changed:changed.length,workerSha256:entries['worker.js'],manifestSha256:hash(fs.readFileSync(path.join(out,'manifest.json')))}));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
