'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=require('node:path').resolve(__dirname,'../..');
require(root+'/node_modules/ts-node').register({transpileOnly:true,project:root+'/tsconfig.json'});
const {defaultScenarioControls,LISTING_SCENARIOS}=require(root+'/src/shared/listingScenarioControls');
const exportsLine='\nexport { parseListingConfig, withStableProfile, publishedListingAsset, simulationFor, controlledScenarioHour };\n';
for(const kind of ['current','eclv-peak'])fs.writeFileSync('/tmp/eclv-'+kind+'-probe.mjs',fs.readFileSync('/tmp/voltex-worker-'+kind+'-20261027.mjs','utf8')+exportsLine);
(async()=>{
 const old=await import('file:///tmp/eclv-current-probe.mjs'),next=await import('file:///tmp/eclv-eclv-peak-probe.mjs');
 const raw=JSON.parse(fs.readFileSync(root+'/config/test-markets/eclv-20261103.draft.json','utf8'));
 assert.throws(()=>old.parseListingConfig(raw));const desired=next.parseListingConfig(raw),at=Date.parse(desired.listingAt),HOUR=3600000;
 const saved=next.withStableProfile(desired,null,3),sim=next.simulationFor(next.publishedListingAsset({id:'isolated-actual-worker-fixture',version:1,publishedAt:new Date(at-86400000).toISOString(),config:saved,countdown:{state:'running',updatedAt:at-86400000,updatedBy:'synthetic-fixture'}}));
 for(const [h,p] of [[0,.014],[24,.1092],[48,.1092],[144,.315],[180,.2142],[252,1.01472]])assert.ok(Math.abs(sim.priceAt(at+h*HOUR)-p)<1e-9,'phase '+h);
 const cs=sim.candles5m(at+300*HOUR,at);assert.equal(Math.max(...cs.map(c=>c.high)),1.01472);
 for(let i=0;i<cs.length;i++){const c=cs[i];assert.ok([c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0&&v<=1.01472));assert.ok(c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));if(i)assert.equal(c.open,cs[i-1].close);}
 const after=cs.filter(c=>c.openTime>=at+252*HOUR);assert.ok(after.some(c=>c.close<c.open)&&after.some(c=>c.close>c.open));
 for(const mutate of [p=>{p.scenario='WAVES';},p=>{p.stages.at(-1).type='growth';},p=>{p.stages.at(-1).targetPrice='1.0147200001';},p=>{p.stages.at(-1).targetPrice='0.9944256';}]){const invalid=structuredClone(raw);mutate(invalid.simulationProgram);assert.throws(()=>next.parseListingConfig(invalid));}
 const before=[],afterRows=[];
 const row=(m,c,seed,h)=>m.controlledScenarioHour(c,seed,h);
 for(const scenario of LISTING_SCENARIOS){const c={mode:'scenario-controls-v2',version:2,from:0,initialPrice:'0.8',controls:defaultScenarioControls('0.8',scenario)};for(const h of [0,23,24,100,167,168,200]){before.push(row(old,c,'unchanged-regression',h));afterRows.push(row(next,c,'unchanged-regression',h));}}
 const original=structuredClone(raw);original.listingAt='2026-11-03T13:00:00Z';original.simulationProgram.maxPrice='0.518';original.simulationProgram.stages.at(-1).targetPrice='0.435';
 const qvtr=JSON.parse(fs.readFileSync(root+'/config/test-markets/qvtr-20261028.draft.json','utf8'));
 for(const d of [original,qvtr])for(const h of [0,23,24,48,143,180,251,252,300]){const c={mode:'scenario-controls-v2',version:2,from:Date.parse(d.listingAt),initialPrice:d.initialPrice,controls:d.simulationProgram};before.push(row(old,c,d.seed,h));afterRows.push(row(next,c,d.seed,h));}
 assert.deepEqual(afterRows,before);const fingerprint=crypto.createHash('sha256').update(JSON.stringify(afterRows)).digest('hex');assert.equal(fingerprint,'1d9684bcece301c6ca644d3b400ffac27673a29044b63cac9ede7744ffa16840');
 const report={scope:'Downloaded actual Worker bundle; pure-function execution; no remote requests, DB, publication or financial writes',result:'PASS',oldExactCap:'RED reproduced',first24h:sim.priceAt(at+24*HOUR),actualPeak:sim.priceAt(at+252*HOUR),candles5m:cs.length,unchangedPriorHours:before.length,fingerprint,invalidCasesRejected:4,tradable:desired.tradable,ownerAllocation:desired.ownerAllocation};
 fs.writeFileSync('/tmp/eclv-actual-worker-qa.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
