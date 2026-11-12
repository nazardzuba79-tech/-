'use strict';
// Apply only the original-regime branches to the pinned running code. Unknown bases fail closed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const esbuild = require(require.resolve('esbuild', {paths:[path.resolve('workers/market-edge')]}));
const [before, out, fenceFile] = process.argv.slice(2);
if (!before || !out || !fenceFile) throw Error('Expected baseline directory, artifact directory and input manifest');
const fence = JSON.parse(fs.readFileSync(fenceFile));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const result = {};
function input(file) {
  const bytes = fs.readFileSync(path.join(before,file));
  if (!fence[file] || digest(bytes) !== fence[file]) throw Error('Unexpected baseline '+file);
  return bytes.toString();
}
function emit(file, value) {
  const dest = path.join(out,file);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,value);
  result[file] = digest(value);
}
function once(code, anchor, replacement) {
  const at = code.indexOf(anchor);
  if(at === -1 || code.indexOf(anchor,at+anchor.length) !== -1) throw Error('Missing or ambiguous anchor: '+anchor);
  return code.slice(0,at)+replacement+code.slice(at+anchor.length);
}
const compilerOptions = {target:ts.ScriptTarget.ES2021, module:ts.ModuleKind.CommonJS};
const readSource = name => fs.readFileSync('src/'+name+'.ts','utf8').replace(/\r\n/g,'\n');
const compile = source => ts.transpileModule(source,{compilerOptions}).outputText;
const configSource = readSource('services/listings/listingConfig');
const simSource = readSource('services/testMarkets/testMarketSimulation');
const routerSource = readSource('api/routes/adminListings');
function section(source,start,end) {
  const left=source.indexOf(start);
  const right=source.indexOf(end,left+start.length);
  if(left < 0 || right < 0) throw Error('Reviewed source changed: '+start);
  return source.slice(left,right).trim();
}
const validation = compile(section(configSource, 'if (config.originalRegime)', 'if (config.history20Regime)')).trim();
const assignment = compile(section(configSource, 'if (previous?.originalRegime', 'if (previous?.history20Regime')).trim().replaceAll('ORIGINAL_REGIMES','Original.ORIGINAL_REGIMES');
const hour = compile(section(simSource, 'if (this.asset.originalRegime)', 'const scheduled =')).trim().replace('originalModelHour(', 'Original.originalModelHour(');
function config(code, zod) {
  const schema = section(configSource,'originalRegime: z.object','history20Regime: z.object').replaceAll('z.',zod+'.').replaceAll('ORIGINAL_MODEL_VERSION','Original.ORIGINAL_MODEL_VERSION').replaceAll('ORIGINAL_REGIMES','Original.ORIGINAL_REGIMES');
  code=once(code,'wickModel: '+zod+'.literal',schema+'\n    wickModel: '+zod+'.literal');
  code=once(code,'const config = parsed.data;', 'const config = parsed.data;\n    '+validation);
  const anchor='function withStableProfile(next, previous, creationOrdinal) {';
  code=once(code,anchor,anchor+'\n    '+assignment);
  code=once(code,'const at = Date.parse(next.listingAt);',"if (next.originalRegime?.id === 'AUTO') throw new ListingValidationError('INVALID_SCENARIO', 'Сначала сохраните назначенный режим');\n    const at = Date.parse(next.listingAt);");
  code=once(code,'if (next.symbol !== active.symbol)',"if (JSON.stringify(next.originalRegime) !== JSON.stringify(active.originalRegime)) throw new ListingValidationError('HISTORY_LOCKED', 'Оригинальную модель опубликованного листинга изменить нельзя');\n    if (next.symbol !== active.symbol)");
  return once(code,'isTradable: config.tradable,','isTradable: config.tradable,\n    ...(config.originalRegime ? { originalRegime: config.originalRegime } : {}),');
}
function engine(code){
  code=once(code,'hourPlan(hour) {','hourPlan(hour) {\n    '+hour);
  const key='const key = `'+'$'+'{asset.pair}|';
  return once(code,key,'const key = `'+'$'+"{asset.originalRegime ? JSON.stringify(asset.originalRegime) + '|' : ''}"+'$'+'{asset.pair}|');
}
function catalogue(code) {
  code=once(code,'    managed: true,','    managed: true,\n    ...(listing.config.originalRegime ? {provenance: Original.ORIGINAL_PROVENANCE} : {}),');
  const a='? null : JSON.stringify(body),';
  return once(code,a,'? null : JSON.stringify(listing?.config.originalRegime ? {...body, provenance: Original.ORIGINAL_PROVENANCE} : body),');
}
function api(file, mutate){
  const code=input('dist/'+file+'.js');
  emit('api/'+file+'.js',mutate(code));
}
const definitions='shared/originalSimulationRegimes';
const generator='services/testMarkets/originalSimulation';
emit('api/'+definitions+'.js',compile(readSource(definitions)));
emit('api/'+generator+'.js',compile(readSource(generator)));
function withImport(code, module) {
  return once(code,'"use strict";','"use strict";\nconst Original = require('+JSON.stringify(module)+');');
}
api('services/listings/listingConfig',s=>config(withImport(s,'../../'+definitions),'zod_1.z'));
api('services/listings/listingPublic',s=>catalogue(withImport(s,'../../'+definitions)));
api('services/listings/store',s=>once(s,'body: { config }, ifMatch, actor','body: config.originalRegime ? { originalRegimeConfig: config } : { config }, ifMatch, actor'));
api('services/testMarkets/testMarketSimulation',s=>engine(withImport(s,'./originalSimulation')));
api('api/routes/adminListings',s=>{
  const compiled=compile(routerSource);
  const route=section(compiled,"router.get('/admin/listings/original-regimes/:regimeId'","router.post('/admin/listings/:id/reschedule'");
  const preview=route.replaceAll('originalSimulationRegimes_1.', 'Original.').replaceAll('listingConfig_1.listingPreviewAssetConfig','listingConfig_1.listingSimulationConfig');
  const anchor="router.post('/admin/listings/:id/reschedule'";
  return once(withImport(s,'../../'+definitions),anchor,preview+'\n    '+anchor);
});
api('services/testMarkets/nrxSpot',s=>once(s,'if (!managed.listingArmed)','if (managed.originalRegime || !managed.listingArmed)'));
api('services/listings/ownerAllocation',s=>once(s,'const asset = listing.config.symbol;', "if (listing.config.originalRegime) throw new Error('Original markets have no inventory to allocate');\n    const asset = listing.config.symbol;"));
api('services/WalletPortfolioService',s=>once(s,'const held = managedListingAssets().filter((asset) => wanted.has(asset.symbol));',
  `const managed = managedListingAssets();
        for (const asset of managed) if (asset.originalRegime) byBase.delete(asset.symbol);
        const held = managed.filter((asset) => !asset.originalRegime && wanted.has(asset.symbol));`));
const helper = esbuild.buildSync({stdin:{contents:`export * from './src/${definitions}'; export * from './src/${generator}';`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'Original',platform:'browser',target:'es2022'}).outputFiles[0].text;
const worker = once(input('worker.js'),'this.saveDraft(match[1], ifMatch, body.value?.config, actor','this.saveDraft(match[1], ifMatch, body.value?.originalRegimeConfig ?? body.value?.config, actor');
emit('worker.js',helper+'\n'+catalogue(engine(config(worker,'external_exports'))));
emit('manifest.json',JSON.stringify({files:result,baseApi:'sha256:1ba06ac77cd203767dea411ccb683b4d2628b55633411053d7cf46fc1f89ca5a',baseWorker:'f13215c0-4767-47df-a901-673770569570',inputs:fence},null,2)+'\n');
