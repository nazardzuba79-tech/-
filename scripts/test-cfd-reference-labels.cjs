'use strict';
// Synthetic test-only observations. No network or database.
const {test}=require('node:test');const assert=require('node:assert/strict');
const {publicReferenceDisplay}=require('../dist/services/marketData/cfd/PublicReferenceDisplay');
const now=Date.parse('2026-09-13T12:00:00Z');
const primary=symbol=>({symbol,provider:'twelvedata',last:null,status:'unavailable',stale:false,providerTimestamp:null,fetchedAt:null,executionAllowed:false});
const ref=symbol=>({symbol,provider:'eia',providerSymbol:symbol==='WTIUSD'?'RWTC':'RBRTE',contract:symbol==='WTIUSD'?'WTI:Cushing:spot:daily':'Brent:Europe:spot:daily',currency:'USD',unit:'barrel',kind:'daily_reference',priceDecimal:'1',sourceTimestamp:null,observationDate:'2026-09-11',receivedAt:now,attribution:'U.S. EIA',derivation:null,status:'available',validUntil:now+1000,executionAllowed:false});
test('WTI and Brent labels retain exact benchmark and USD/barrel',()=>{
  for(const [symbol,name]of[['WTIUSD','WTI Cushing'],['XBRUSD','Brent Europe']]){
    const row=publicReferenceDisplay(primary(symbol),symbol,ref(symbol),5000,now);
    assert.ok(row.referenceLabel.includes(name));assert.ok(row.referenceLabel.includes('USD/barrel'));
    assert.ok(row.referenceLabel.includes('2026-09-11'));assert.equal(row.executionAllowed,false);
  }
});
test('unknown metal unit is disclosed rather than labelled as verified ounces',()=>{
  const r={...ref('XAUUSD'),provider:'gold-api',providerSymbol:'XAU',contract:'Gold-API:XAU:indicative',unit:'provider_native_quote',kind:'indicative',sourceTimestamp:now,observationDate:null,attribution:'Gold API'};
  const row=publicReferenceDisplay(primary('XAUUSD'),'Gold',r,5000,now);
  assert.match(row.referenceLabel,/unit unverified/);assert.equal(row.executionAllowed,false);
});
