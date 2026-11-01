'use strict';
/** Build ONLY the listing changes over the captured live binaries, not all of main.
 * The fixture contains code, no config, sessions, accounts or financial data.
 * Existing ECLV terminal-peak runtime changes must retain their exact legacy path.
 */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const cp=require('node:child_process');
const ts=require('typescript');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..');
const {build}=createRequire(path.join(root,'workers/market-edge/package.json'))('esbuild');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fixtureFile=path.join(root,'scripts/qa/fixtures/ai-live-runtime-20261101.json.gz');
const fixtureBytes=fs.readFileSync(fixtureFile);
if(hash(fixtureBytes)!=='5413977574993737db7dcaa45da486a3de2aceb8461b583133fbe44da1567c1d')throw Error('Live fixture identity changed');
const fixture=JSON.parse(zlib.gunzipSync(fixtureBytes));
const out=path.resolve(process.env.AI_RELEASE_OUT||path.join(root,'artifacts/ai-listing-release'));
const parse=s=>ts.createSourceFile('runtime.js',s,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
function single(items,label){if(items.length!==1)throw Error(label+': expected one match, got '+items.length);return items[0];}
function replaceOnce(s,a,b){if(s.split(a).length!==2)throw Error('Runtime fence not unique: '+a.slice(0,90));return s.replace(a,b);}
function functionInsert(s,name,which,text){const ast=parse(s),f=single(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name),name);const at=which==='start'?f.body.getStart(ast)+1:f.body.end-1;return s.slice(0,at)+'\n'+text+'\n'+s.slice(at);}
function addPublicProvenance(s){
  const ast=parse(s),f=single(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='publicListingAsset'),'publicListingAsset');
  const ret=single(f.body.statements.filter(ts.isReturnStatement),'public asset return');
  if(!ts.isObjectLiteralExpression(ret.expression))throw Error('public asset shape');
  const at=ret.expression.getStart(ast)+1;
  return s.slice(0,at)+`\n...(listing.config.simulationProgram?.terminalPeak === 'bounded-v1' ? {provenance:{mode:'DEMO_MODEL',withdrawable:false,label:'DEMO · SIMULATED · NO REAL TRADING'}} : {}),\n`+s.slice(at);
}
function addOptInPrice(s){
  s=functionInsert(s,'baseline','start',`if(config.controls.terminalPeak==='bounded-v1' && stage.index===config.controls.stages.length) return stage.open*(1-.04*(1-Math.exp(-(at-stage.start)/HOUR)));`);
  s=functionInsert(s,'priceAt','end',''); // Assert the expected canonical function exists.
  const ast=parse(s),f=single(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='priceAt'),'priceAt');
  const ret=single(f.body.statements.filter(n=>ts.isReturnStatement(n)&&n.expression?.getText(ast).startsWith('displaced(')),'price displacement');
  const at=ret.getStart(ast);
  return s.slice(0,at)+`if(c.terminalPeak==='bounded-v1' && base===cap) return cap;\n`+s.slice(at);
}
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const emitted={};
function emit(p,s){const f=path.join(out,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s);emitted[p]=hash(s);}

async function main(){
  const controlsIife=(await build({absWorkingDir:root,entryPoints:['src/shared/listingScenarioControls.ts'],bundle:true,write:false,format:'iife',globalName:'AiListingScenarioControls',platform:'browser',target:'es2022'})).outputFiles[0].text;
  const timeIife=(await build({absWorkingDir:root,entryPoints:['src/shared/listingSchedule.ts'],bundle:true,write:false,format:'iife',globalName:'AiListingSchedule',platform:'browser',target:'es2022'})).outputFiles[0].text;
  const candidate=(await build({absWorkingDir:path.join(root,'workers/market-edge'),entryPoints:['src/worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*']})).outputFiles[0].text;
  let worker=fixture.worker;
  worker=replaceOnce(worker,'function validateScenarioControls(program, initialPrice) {','function legacyValidateScenarioControls(program, initialPrice) {');
  worker+='\n'+controlsIife+'\n'+timeIife+`\nfunction validateScenarioControls(program, initialPrice){return program.terminalPeak==='bounded-v1'?AiListingScenarioControls.validateScenarioControls(program,initialPrice):legacyValidateScenarioControls(program,initialPrice);}\n`;
  worker=replaceOnce(worker,'var scenarioControlsSchema = external_exports.object({',`var scenarioControlsSchema = external_exports.object({\nterminalPeak: external_exports.literal('bounded-v1').optional(),`);
  worker=replaceOnce(worker,'const config = parsed.data;',`const config = parsed.data;\nif(config.simulationProgram?.terminalPeak && (config.tradable || Number(config.ownerAllocation)!==0))throw new ListingValidationError('DEMO_ONLY','Terminal models require non-tradable zero allocation');`);
  worker=addOptInPrice(worker);
  worker=addPublicProvenance(worker);
  const a=parse(candidate);let method;
  function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(a)==='reschedule'){if(method)throw Error('duplicate reschedule');method=n.getText(a)}ts.forEachChild(n,visit);}visit(a);
  if(!method)throw Error('source reschedule method missing');
  method=replaceOnce(method,'shiftListingDate(', 'AiListingSchedule.shiftListingDate(');
  worker=replaceOnce(worker,'(draft|publish|replace-prelisting|countdown|delete)', '(draft|publish|replace-prelisting|countdown|delete|reschedule)');
  worker=replaceOnce(worker,'if (body.error) return body.error;',`if (body.error) return body.error;\nif(match[2]==='reschedule' && request.method==='POST')return this.reschedule(match[1],body.value,actor,Date.now());`);
  const wa=parse(worker);let cls;
  function findClass(n){if(ts.isVariableDeclaration(n)&&n.name.getText(wa)==='ManagedListingsDO'&&ts.isClassExpression(n.initializer))cls=n.initializer;ts.forEachChild(n,findClass);}findClass(wa);
  if(!cls)throw Error('live Durable Object not found');
  worker=worker.slice(0,cls.end-1)+'\n'+method+'\n'+worker.slice(cls.end-1);
  emit('worker.js',worker);
  // Build pure helpers once; old unflagged validator/price paths stay byte-preserved.
  const controlsCjs=(await build({absWorkingDir:root,entryPoints:['src/shared/listingScenarioControls.ts'],bundle:true,write:false,format:'cjs',platform:'node',target:'es2021'})).outputFiles[0].text;
  emit('api/shared/aiListingScenarioControls.js',controlsCjs);
  emit('api/shared/listingSchedule.js',transpile(fs.readFileSync(path.join(root,'src/shared/listingSchedule.ts'),'utf8')));
  let config=fixture.api['services/listings/listingConfig.js'];
  config=replaceOnce(config,'exports.scenarioControlsSchema = zod_1.z.object({',`exports.scenarioControlsSchema = zod_1.z.object({\nterminalPeak: zod_1.z.literal('bounded-v1').optional(),`);
  config=replaceOnce(config,'const config = parsed.data;',`const config = parsed.data;\nif(config.simulationProgram?.terminalPeak && (config.tradable || Number(config.ownerAllocation)!==0))throw new ListingValidationError('DEMO_ONLY','Terminal models require non-tradable zero allocation');`);
  emit('api/services/listings/listingConfig.js',config);
  emit('api/shared/listingScenarioControls.js',fixture.api['shared/listingScenarioControls.js']+`\nconst aiControls=require('./aiListingScenarioControls');\nconst legacyValidate=exports.validateScenarioControls;\nexports.validateScenarioControls=(program,price)=>program.terminalPeak==='bounded-v1'?aiControls.validateScenarioControls(program,price):legacyValidate(program,price);\n`);
  emit('api/services/testMarkets/simulationScenarioControls.js',addOptInPrice(fixture.api['services/testMarkets/simulationScenarioControls.js']));
  emit('api/services/listings/listingPublic.js',addPublicProvenance(fixture.api['services/listings/listingPublic.js']));
  for(const p of ['api/routes/adminListings','services/listings/store'])emit('api/'+p+'.js',transpile(fs.readFileSync(path.join(root,'src',p+'.ts'),'utf8')));
  // Approved #668 is the prerequisite, based on exactly the four live modules.
  // Compile only those four, never a generic API build or Prisma migration.
  const normalized=s=>ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed}).printFile(parse(s)).trim();
  for(const p of ['api/routes/auth','api/routes/account','api/routes/adminUsers','api/routes/adminPagedReads']){
    const sourceAt=sha=>cp.execFileSync('git',['show',`${sha}:src/${p}.ts`],{cwd:root,encoding:'utf8'});
    if(normalized(transpile(sourceAt('3636cf80a44b68cfe023a05618f9ad6d1c2e0a11')))!==normalized(fixture.api[p+'.js']))throw Error('Security parent differs from live '+p);
    emit('api/'+p+'.js',transpile(sourceAt('1b8d34c83ac91a96d364f53348699189d1fcad32')));
  }
  const manifest={scope:'PINNED_LIVE_LISTING_OVERLAY_ONLY',beforeWorkerSha256:hash(fixture.worker),beforeApi:Object.fromEntries(Object.entries(fixture.api).map(([p,s])=>[p,hash(s)])),after:{...emitted}};
  emit('manifest.json',JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({output:out,workerBytes:worker.length,apiFiles:Object.keys(manifest.after).filter(p=>p.startsWith('api/')).length,beforeWorker:manifest.beforeWorkerSha256},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
