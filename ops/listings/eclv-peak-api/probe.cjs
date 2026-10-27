const assert=require('node:assert/strict');
const {parseListingConfig,withStableProfile,publishedListingAsset}=require('/app/dist/services/listings/listingConfig');
const {simulationFor}=require('/app/dist/services/testMarkets/testMarketSimulation');
const raw=require('./desired-config.json'),c=parseListingConfig(raw),at=Date.parse(c.listingAt);
const saved=withStableProfile(c,null,3),sim=simulationFor(publishedListingAsset({id:'isolated-image-probe',version:1,publishedAt:new Date(at-86400000).toISOString(),config:saved,countdown:{state:'running',updatedAt:at-86400000,updatedBy:'synthetic-probe'}}));
assert.equal(c.tradable,false);assert.equal(c.ownerAllocation,'0');assert.equal(c.seed,'eclavo-20261103-v1');
assert.ok(Math.abs(sim.priceAt(at+86400000)-.1092)<1e-9);assert.equal(sim.priceAt(at+252*3600000),1.01472);
console.log(JSON.stringify({isolatedImageProbe:'PASS',node:process.version,first24h:sim.priceAt(at+86400000),actualPeak:sim.priceAt(at+252*3600000),databaseAccess:false}));
