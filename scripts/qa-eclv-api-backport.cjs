#!/usr/bin/env node
'use strict';
// Compile/test the TWO-FILE patch on the actual production API source base.
// No main runtime overlay, server, credentials, database or outbound prices.
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const compat=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('Pass the detached production-source worktree');
require(path.join(compat,'node_modules/ts-node')).register({transpileOnly:true,project:path.join(compat,'tsconfig.json')});
const config=require(path.join(compat,'src/services/listings/listingConfig'));
const {simulationFor,DAY_MS}=require(path.join(compat,'src/services/testMarkets/testMarketSimulation'));
const {controlledScenarioHour}=require(path.join(compat,'src/services/testMarkets/simulationScenarioControls'));
const {defaultScenarioControls,LISTING_SCENARIOS}=require(path.join(compat,'src/shared/listingScenarioControls'));
const root=path.resolve(__dirname,'..');
const raw=JSON.parse(fs.readFileSync(path.join(root,'config/test-markets/eclv-20261103.draft.json'),'utf8'));
const desired=config.parseListingConfig(raw),saved=config.withStableProfile(desired,null,3);
const at=Date.parse(desired.listingAt),HOUR=3600000;
const sim=simulationFor(config.publishedListingAsset({id:'isolated-backport-fixture',version:1,publishedAt:new Date(at-DAY_MS).toISOString(),config:saved,countdown:{state:'running',updatedAt:at-DAY_MS,updatedBy:'synthetic-fixture'}}));
assert.deepEqual(desired,raw);assert.equal(desired.tradable,false);assert.equal(desired.ownerAllocation,'0');
assert.equal(desired.seed,'eclavo-20261103-v1');assert.equal(sim.priceAt(at-1),null);assert.equal(sim.priceAt(at),.014);
for(const [hours,price] of [[24,.1092],[48,.1092],[144,.315],[180,.2142],[252,1.01472]])assert.ok(Math.abs(sim.priceAt(at+hours*HOUR)-price)<1e-9,`phase ${hours}`);
const candles=sim.candles5m(at+300*HOUR,at);
assert.equal(Math.max(...candles.map(c=>c.high)),1.01472);
for(let i=0;i<candles.length;i++){
 const c=candles[i];assert.ok([c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0&&v<=1.01472));
 assert.ok(c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));
 if(i)assert.equal(c.open,candles[i-1].close);
}
const after=candles.filter(c=>c.openTime>=at+252*HOUR);
assert.ok(after.some(c=>c.close<c.open)&&after.some(c=>c.close>c.open));
for(const mutate of [p=>{p.scenario='WAVES';},p=>{p.stages.at(-1).type='growth';},p=>{p.stages.at(-1).targetPrice='1.0147200001';},p=>{p.stages.at(-1).targetPrice='0.9944256';}]){
 const invalid=structuredClone(raw);mutate(invalid.simulationProgram);assert.throws(()=>config.parseListingConfig(invalid));
}
const rows=[];
for(const scenario of LISTING_SCENARIOS){const controls=defaultScenarioControls('0.8',scenario);for(const hour of [0,23,24,100,167,168,200])rows.push(controlledScenarioHour({mode:'scenario-controls-v2',version:2,from:0,initialPrice:'0.8',controls},'unchanged-regression',hour));}
const original=structuredClone(raw);original.listingAt='2026-11-03T13:00:00Z';original.simulationProgram.maxPrice='0.518';original.simulationProgram.stages.at(-1).targetPrice='0.435';
const qvtr=JSON.parse(fs.readFileSync(path.join(root,'config/test-markets/qvtr-20261028.draft.json'),'utf8'));
for(const d of [original,qvtr])for(const hour of [0,23,24,48,143,180,251,252,300])rows.push(controlledScenarioHour({mode:'scenario-controls-v2',version:2,from:Date.parse(d.listingAt),initialPrice:d.initialPrice,controls:d.simulationProgram},d.seed,hour));
const fingerprint=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
assert.equal(fingerprint,'1d9684bcece301c6ca644d3b400ffac27673a29044b63cac9ede7744ffa16840');
console.log(JSON.stringify({scope:'Detached production API source plus two-file patch; no server/DB/financial writes',base:'89c3ac003b44a6a0e7630d2ecbe5d7164e85b683',result:'PASS',first24h:sim.priceAt(at+DAY_MS),actualPeak:sim.priceAt(at+252*HOUR),candles5m:candles.length,prior88HourFingerprint:fingerprint,seed:desired.seed,tradable:false,ownerAllocation:'0'},null,2));
