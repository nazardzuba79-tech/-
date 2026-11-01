/** Isolated candidate acceptance; uses the existing canonical tick engine. */
import {readFileSync} from 'fs';
import {resolve} from 'path';
import {parseListingConfig,withStableProfile,publishedListingAsset,LOGO_MAX_BYTES,nextListingCountdown} from '../../src/services/listings/listingConfig';
import {exactPriceFromGain} from '../../src/shared/listingScenarioControls';
import {simulationFor,aggregateCandles,SIM_INTERVALS} from '../../src/services/testMarkets/testMarketSimulation';

export function candidateContract(id:string,hours:number,gain:string,peakDate:string) {
 const raw=JSON.parse(readFileSync(resolve(__dirname,`../../config/test-markets/${id}.draft.json`),'utf8'));
 const config=withStableProfile(parseListingConfig(raw),null,7);
 const p=config.simulationProgram!;
 if(p.kind!=='scenario-controls-v2')throw Error('v2 required');
 const at=Date.parse(config.listingAt),H=3600000;
 const listing={id,version:1,publishedAt:new Date(at-3*24*H).toISOString(),config,countdown:{state:'running' as const,updatedAt:at-3*24*H,updatedBy:'synthetic'}};
 const sim=simulationFor(publishedListingAsset(listing));
 test('schema, exact growth, duration, UTC/Kyiv and zero financial admission',()=>{
  expect(raw.tradable).toBe(false);expect(raw.ownerAllocation).toBe('0');expect(raw.seedMode).toBe('manual');
  expect(exactPriceFromGain(raw.initialPrice,gain)).toBe(p.maxPrice);
  expect(p.stages.reduce((n,s)=>n+s.durationHours,0)).toBe(hours);
  expect(new Date(at+hours*H).toISOString()).toBe(peakDate);
  expect(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at)).toBe('15:00');
  expect(()=>parseListingConfig({...raw,tradable:true})).toThrow();
  expect(()=>parseListingConfig({...raw,ownerAllocation:'1'})).toThrow();
  expect(()=>parseListingConfig({...raw,simulationProgram:{...p,terminalPeak:undefined}})).toThrow();
  expect(()=>parseListingConfig({...raw,simulationProgram:{...p,afterGrowth:'historical'}})).toThrow();
 });
 test('approved logo variants, exact embedded bytes and no oversized asset',()=>{
  for(const size of [20,24,48,128,256]){
   const b=readFileSync(resolve(__dirname,`../../config/test-markets/${id}/logo-${size}.png`));
   expect(b.subarray(1,4).toString()).toBe('PNG');expect(b.readUInt32BE(16)).toBe(size);expect(b.readUInt32BE(20)).toBe(size);expect(b.length).toBeLessThanOrEqual(LOGO_MAX_BYTES);
   if(size===128)expect(raw.logo).toBe('data:image/png;base64,'+b.toString('base64'));
  }
 });
 test('all endpoints and transition neighborhoods are continuous and bounded',()=>{
  expect(sim.priceAt(at-1)).toBeNull();expect(sim.priceAt(at)).toBe(Number(raw.initialPrice));
  let elapsed=0;
  for(const s of p.stages){elapsed+=s.durationHours;const t=at+elapsed*H;
   expect(sim.priceAt(t)).toBeCloseTo(Number(s.targetPrice),8);
   for(const dt of [-10000,0,10000]){const v=sim.priceAt(t+dt)!;expect(v).toBeGreaterThan(0);expect(v).toBeLessThanOrEqual(Number(p.maxPrice));expect(Math.abs(v/Number(s.targetPrice)-1)).toBeLessThan(.01);}
  }
 });
 test('entire model, canonical OHLCV, immutable closed candles and deterministic ordinal',()=>{
  const end=at+(hours+72)*H, cap=Number(p.maxPrice);
  const five=sim.candles5m(end,at);
  for(let i=0;i<five.length;i++){
   const c=five[i];expect([c.open,c.close,c.high,c.low,c.volume].every(Number.isFinite)).toBe(true);
   expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open,c.close));expect(c.low).toBeLessThanOrEqual(Math.min(c.open,c.close));
   expect(c.high).toBeLessThanOrEqual(cap);expect(c.low).toBeGreaterThan(0);expect(c.volume).toBeGreaterThanOrEqual(0);
   if(i)expect(c.open).toBe(five[i-1].close);
  }
  const minute=sim.candles1m(at+3*H,at);
  for(let i=1;i<minute.length;i++)expect(minute[i].open).toBe(minute[i-1].close);
  for(const [tf,count] of [['5m',5],['15m',15],['1h',60]] as const){
   const candles=tf==='5m'?sim.candles5m(at+3*H,at):aggregateCandles(sim.candles5m(at+3*H,at),SIM_INTERVALS[tf]);
   for(let i=0;i<180/count;i++){
    const g=minute.slice(i*count,(i+1)*count),c=candles[i];
    expect([g[0].open,Math.max(...g.map(c=>c.high)),Math.min(...g.map(c=>c.low)),g[g.length-1].close]).toEqual([c.open,c.high,c.low,c.close]);
    expect(Math.abs(g.reduce((n,c)=>n+c.volume,0)-c.volume)).toBeLessThan(.01);
   }
  }
  const old=sim.candles5m(at+3*H,at).filter(c=>c.openTime<at+3*H);
  expect(five.slice(0,old.length)).toEqual(old);
  const fresh=simulationFor(publishedListingAsset({...listing,config:withStableProfile(parseListingConfig(raw),null,19)}));
  expect(fresh.candles5m(at+3*H,at).filter(c=>c.openTime<at+3*H)).toEqual(old);
  const after=five.filter(c=>c.openTime>=at+hours*H+24*H);
  expect(after.length).toBeGreaterThan(0);expect(Math.min(...after.map(c=>c.low))).toBeGreaterThan(cap*.8);
  expect(new Set(after.map(c=>c.close)).size).toBeGreaterThan(20);
 },120000);
 test('staged/running transitions refuse double start; independent seeds',()=>{
  const staged={...listing,countdown:{...listing.countdown,state:'staged' as const}};
  expect(nextListingCountdown(staged,'start',at-H)).toBe('running');
  expect(nextListingCountdown(listing,'start',at-H)).toBe('running'); // idempotent, never resets listingAt
  const other=simulationFor(publishedListingAsset({...listing,config:{...config,seed:config.seed+'-other'}}));
  expect(other.candles5m(at+H,at)).not.toEqual(sim.candles5m(at+H,at));
 });
}
