import { compareMarketValues, MarketColumnSort, nextMarketColumnSort } from '../marketColumnSort';

test.each(['price','change'] as const)('%s cycles through both directions and restores product default', field=>{
  let sort:MarketColumnSort=null;
  sort=nextMarketColumnSort(sort,field);expect(sort).toEqual({field,dir:-1});
  sort=nextMarketColumnSort(sort,field);expect(sort).toEqual({field,dir:1});
  expect(nextMarketColumnSort(sort,field)).toBeNull();
});
test('switching column starts descending instead of inheriting the prior direction',()=>{
  expect(nextMarketColumnSort({field:'price',dir:1},'change')).toEqual({field:'change',dir:-1});
});
test.each([-1,1] as const)('unknowns remain last for direction %s while real zero participates',dir=>{
  const values=[null,NaN,3,0,-1,Infinity];
  const sorted=[...values].sort((a,b)=>compareMarketValues(a,b,dir));
  expect(sorted.slice(0,3)).toEqual(dir===-1?[3,0,-1]:[-1,0,3]);
  expect(sorted.slice(3)).toEqual([null,NaN,Infinity]);
});
