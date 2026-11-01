'use strict';
/** Code-only parity: captured live ECLV/QVTR/AITH versus the additive release. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..');
const {transform}=createRequire(path.join(root,'workers/market-edge/package.json'))('esbuild');
require('ts-node').register({transpileOnly:true,project:path.join(root,'tsconfig.json')});
const canonical=require('../../src/services/testMarkets/simulationScenarioControls');
const {listingSimulationConfig,parseListingConfig}=require('../../src/services/listings/listingConfig');
const fixture=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'scripts/qa/fixtures/ai-live-runtime-20261101.json.gz'))));
async function load(code){
  const expose=code+'\nexport const __qa={parseListingConfig,listingSimulationConfig,publicListingAsset,controlledScenarioHour};';
  const cjs=await transform(expose,{format:'cjs',target:'es2022'});
  const m={exports:{}};new Function('module','exports',cjs.code)(m,m.exports);return m.exports.__qa;
}
(async()=>{
  const out=path.resolve(process.env.AI_RELEASE_OUT||path.join(root,'artifacts/ai-listing-release'));
  const before=await load(fixture.worker),after=await load(fs.readFileSync(path.join(out,'worker.js'),'utf8'));
  const models=JSON.parse(fs.readFileSync(path.join(root,'scripts/qa/fixtures/ai-preserved-models-20261101.json'),'utf8'));
  let oldTicks=0,newTicks=0;
  for(const config of models){
    assert.deepEqual(after.parseListingConfig(config),before.parseListingConfig(config));
    const listing={id:'qa-'+config.symbol.toLowerCase(),version:1,publishedAt:'2026-10-01T00:00:00Z',config};
    assert.deepEqual(after.publicListingAsset(listing,Date.parse(config.listingAt)-1),before.publicListingAsset(listing,Date.parse(config.listingAt)-1));
    const a=before.listingSimulationConfig(config),b=after.listingSimulationConfig(config);
    if(a.scheduledScenario?.mode!=='scenario-controls-v2')continue;
    for(const h of [0,1,23,24,35,36,47,48,71,143,191,239,240,360]){
      const first=before.controlledScenarioHour(a.scheduledScenario,a.seed,h);
      assert.deepEqual(after.controlledScenarioHour(b.scheduledScenario,b.seed,h),first,config.symbol+' hour '+h);
      oldTicks+=first.ticks.length;
    }
  }
  const candidates=[];
  for(const key of ['nryia-20261115','aelri-20261125']){
    const file=path.join(root,'config/test-markets',key+'.draft.json');if(!fs.existsSync(file))continue;
    const config=JSON.parse(fs.readFileSync(file,'utf8')),asset=after.listingSimulationConfig(after.parseListingConfig(config));
    const expected=listingSimulationConfig(parseListingConfig(config));
    for(const h of [0,1,23,24,41,42,71,95,143,191,192,239,240,250]){
      const actual=after.controlledScenarioHour(asset.scheduledScenario,asset.seed,h);
      assert.deepEqual(actual,canonical.controlledScenarioHour(expected.scheduledScenario,expected.seed,h),key+' hour '+h);newTicks+=actual.ticks.length;
    }
    const listing={id:key,version:1,publishedAt:'2026-11-01T00:00:00Z',config};
    assert.equal(after.publicListingAsset(listing,Date.parse(config.listingAt)-1).provenance.mode,'DEMO_MODEL');
    assert.throws(()=>after.parseListingConfig({...config,tradable:true}));assert.throws(()=>after.parseListingConfig({...config,ownerAllocation:'1'}));
    candidates.push(config.symbol);
  }
  const report={passed:true,scope:'code-only isolated live-runtime overlay parity',oldModels:models.map(x=>x.symbol),oldTicks,newTicks,candidates};
  fs.writeFileSync(path.join(out,'parity.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
