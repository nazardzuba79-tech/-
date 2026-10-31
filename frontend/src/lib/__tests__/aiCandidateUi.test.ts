import {readFileSync} from 'fs';
import {resolve} from 'path';
import {filterAndSortPairs} from '../pairList';
import {validateListingMovement} from '../../pages/admin/listingMovementModel';

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
