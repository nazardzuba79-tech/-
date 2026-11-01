import {readFileSync} from 'fs';
import {resolve} from 'path';
import {filterAndSortPairs} from '../pairList';
import {validateListingMovement} from '../../pages/admin/listingMovementModel';
import {parseTestMarkets} from '../testMarkets';

test('Spot full-name search preserves ticker search, favorites and quote selection',()=>{
 const rows=[{pair:'NRYIA/USDT',lastPrice:'1',changePercent24h:'0',quoteVolume24h:'0'},
 {pair:'BTC/USDT',lastPrice:'1',changePercent24h:'0',quoteVolume24h:'0'}];
 const opts={search:' neuryvia AI ',nameByPair:new Map([['NRYIA/USDT','Neuryvia AI']]),favoritesOnly:false,favorites:new Set<string>(),quoteFilter:'USD'};
 expect(filterAndSortPairs(rows,opts)).toEqual([rows[0]]);
 expect(filterAndSortPairs(rows,{...opts,search:'nryia/usdt'})).toEqual([rows[0]]);
 expect(filterAndSortPairs(rows,{...opts,favoritesOnly:true})).toEqual([]);
 expect(filterAndSortPairs(rows,{...opts,search:''})).toEqual([]);
 expect(filterAndSortPairs(rows,{...opts,nameByPair:undefined})).toEqual([]);
});
test('private terminal peak is editable; legacy cap validation remains enforced',()=>{
 const c=JSON.parse(readFileSync(resolve(__dirname,'../../../../config/test-markets/nryia-20261115.draft.json'),'utf8'));
 expect(validateListingMovement(c.initialPrice,c.simulationProgram)).toBeNull();
 expect(validateListingMovement(c.initialPrice,{...c.simulationProgram,terminalPeak:undefined})).not.toBeNull();
});

test('new public DEMO provenance is explicit and cannot grant trading or relabel other markets',()=>{
 const raw={managed:true,pair:'NRYIA/USDT',symbol:'NRYIA',name:'Neuryvia AI',isTestAsset:true,isTradable:false,
  listingAt:'2026-11-15T13:00:00Z',initialPrice:1,state:{phase:'pre-listing'},
  provenance:{mode:'DEMO_MODEL',withdrawable:false}};
 const parse=(r:unknown)=>parseTestMarkets({serverTime:1,assets:[r]})!.assets[0];
 expect(parse(raw).provenanceLabel).toBe('DEMO · SIMULATED · NO REAL TRADING');
 expect(parse(raw).isTradable).toBe(false);
 expect(parse({...raw,provenance:undefined}).provenanceLabel).toBeUndefined();
 expect(parse({...raw,isTradable:true}).provenanceLabel).toBeUndefined();
 expect(parse({...raw,provenance:{mode:'DEMO_MODEL',withdrawable:true}}).provenanceLabel).toBeUndefined();
});
