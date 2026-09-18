import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { CanonicalAsset } from '../api';
import { filterAndSortAssets } from '../catalogueStore';
function asset(symbol:string,change7d:number|null,change30d:number|null):CanonicalAsset{return {id:`cg:${symbol.toLowerCase()}`,symbol,name:symbol,logoUrl:null,providers:{coingecko:symbol.toLowerCase()},tradingPairs:[],tradable:false,metadataSource:'coingecko',rank:1,ambiguous:false,collidingIds:[],market:{priceUsd:1,changePercent24h:0,changePercent7d:change7d,changePercent30d:change30d,marketCapUsd:1,volume24hUsd:1,circulatingSupply:null}};}
const assets=[asset('GAIN',15,-5),asset('DROP',-30,40),asset('FLAT',0,0),asset('UNKNOWN',null,null)];
describe('Markets 7d/30d performance columns',()=>{
  test('sorts 7d/30d locally, so changing horizon adds no provider request',()=>{
    expect(filterAndSortAssets(assets,{sort:'change7d',direction:'desc'}).map(a=>a.symbol)).toEqual(['GAIN','FLAT','DROP','UNKNOWN']);
    expect(filterAndSortAssets(assets,{sort:'change7d',direction:'asc'}).map(a=>a.symbol)).toEqual(['DROP','FLAT','GAIN','UNKNOWN']);
    expect(filterAndSortAssets(assets,{sort:'change30d',direction:'desc'}).map(a=>a.symbol)).toEqual(['DROP','FLAT','GAIN','UNKNOWN']);
    expect(filterAndSortAssets(assets,{sort:'change30d',direction:'asc'}).map(a=>a.symbol)).toEqual(['GAIN','FLAT','DROP','UNKNOWN']);
  });
  test('table exposes 7d and 30d sortable columns, with no synthetic history calculation',()=>{
    const source=readFileSync(resolve(__dirname,'../../pages/markets-bolt/CatalogueTable.tsx'),'utf8');
    expect(source).toContain("key: 'change7d'"); expect(source).toContain("key: 'change30d'");
    expect(source).toContain("labelKey: 'markets.change7d'"); expect(source).toContain("labelKey: 'markets.change30d'");
    expect(source).not.toContain('sparkline');
  });
});
