import { AssetRegistry } from '../AssetRegistry';

function ranking(symbol:string, rank:number, change7d:number|null, change30d:number|null){
  return {
    id:symbol.toLowerCase(), symbol, rank, name:symbol, image:'', categories:[], price:1,
    changePercent24h:0, changePercent7d:change7d, changePercent30d:change30d,
    volume24h:1, marketCap:1000-rank, sparkline:[], circulatingSupply:null,
    market:{priceUsd:1,changePercent24h:0,marketCapUsd:1000-rank,volume24hUsd:1,circulatingSupply:null}, collidingIds:[],
  } as any;
}
function symbols(list:string[]){return list.map(symbol=>({baseAsset:symbol,quoteAsset:'USDT',pair:`${symbol}/USDT`})) as any;}

describe('asset catalogue 7d/30d movers',()=>{
  function registry(){return new AssetRegistry(
    {getRankings:jest.fn().mockResolvedValue([ranking('GAIN',1,18.5,-4),ranking('DROP',2,-22,31),ranking('FLAT',3,0,0),ranking('UNKNOWN',4,null,null)])},
    {listSymbols:jest.fn().mockResolvedValue(symbols(['GAIN','DROP','FLAT']))},
  );}
  test('propagates real provider horizon returns without deriving or defaulting them',async()=>{
    const {value}=await registry().getCatalogue();
    expect(value.assets.find(a=>a.symbol==='GAIN')?.market).toMatchObject({changePercent7d:18.5,changePercent30d:-4});
    expect(value.assets.find(a=>a.symbol==='UNKNOWN')?.market).toMatchObject({changePercent7d:null,changePercent30d:null});
  });
  test('sorts 7d gainers and losers with unknown last',async()=>{
    const r=registry();
    expect((await r.query({sort:'change7d',direction:'desc'})).value.assets.map(a=>a.symbol)).toEqual(['GAIN','FLAT','DROP','UNKNOWN']);
    expect((await r.query({sort:'change7d',direction:'asc'})).value.assets.map(a=>a.symbol)).toEqual(['DROP','FLAT','GAIN','UNKNOWN']);
  });
  test('sorts 30d independently',async()=>{
    const r=registry();
    expect((await r.query({sort:'change30d',direction:'desc'})).value.assets.map(a=>a.symbol)).toEqual(['DROP','FLAT','GAIN','UNKNOWN']);
    expect((await r.query({sort:'change30d',direction:'asc'})).value.assets.map(a=>a.symbol)).toEqual(['GAIN','FLAT','DROP','UNKNOWN']);
  });
});
