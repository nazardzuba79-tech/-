import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import snapshot from '../../../../config/isolated/qvtr-source-20261031.json';
import { parseListingConfig, listingSimulationConfig, checkPublishable } from '../listingConfig';
import { IsolatedScenarioJournal } from '../isolatedScenarioJournal';
import { qvtrIsolatedCandidate, QVTR_PEAK_AT, QVTR_CORRECTION_START, QVTR_CORRECTION_END } from '../qvtrIsolatedCandidate';
import { TestMarketSimulation, aggregateCandles, SIM_INTERVALS } from '../../testMarkets/testMarketSimulation';
import { exactGainFromPrice, exactPriceFraction } from '../../../shared/listingScenarioControls';

jest.setTimeout(120000);
const source = parseListingConfig(snapshot.config), at = Date.parse('2026-10-31T15:00:00Z');
const now = Date.parse(snapshot.observedAt), admin = { id: 'isolated-admin', role: 'ADMIN' as const };
const proposal = qvtrIsolatedCandidate(source, at);
let dir: string, file: string, journal: IsolatedScenarioJournal;
beforeEach(async()=>{ dir=await mkdtemp(join(tmpdir(),'qvtr-journal-'));file=join(dir,'journal.jsonl');journal=new IsolatedScenarioJournal(file,source,()=>now); });
afterEach(async()=>{await rm(dir,{recursive:true,force:true});});

test('live snapshot source fields match GitHub; last completed observed minute reproduces exactly',()=>{
  expect(snapshot.githubDraftFieldsMatch).toBe(true);
  const sim = new TestMarketSimulation(listingSimulationConfig(source));
  const closed = snapshot.history.candles.filter(c=>c.time*1000+60000<=snapshot.history.serverTime);
  for(const c of closed){const local=sim.candles1m(c.time*1000+60000,c.time*1000)[0];
    expect([local.open,local.high,local.low,local.close]).toEqual([c.open,c.high,c.low,c.close]);}
});
test('RED control: original cannot satisfy accelerated peak; GREEN proposal satisfies exact prices and returns',async()=>{
  const baseline=new TestMarketSimulation(listingSimulationConfig(source));
  expect(baseline.priceAt(QVTR_PEAK_AT)).not.toBe(.5383);
  const before=await journal.history();
  const preview=await journal.preview(QVTR_CORRECTION_END,at,'1m',proposal);
  expect(await journal.history()).toEqual(before); // preview never applies
  expect(preview.source).toBe('ISOLATED_MODEL_ONLY');expect(preview.executable).toBe(false);
  expect(preview.candles.find(c=>c.openTime===QVTR_PEAK_AT)!.open).toBe(.5383);
  expect(preview.candles.find(c=>c.openTime===QVTR_CORRECTION_END)!.open).toBe(.32298);
  expect(exactGainFromPrice('0.0140','0.53830')).toBe('3745');
  expect(exactPriceFraction('0.53830',60)).toBe('0.32298');
  expect(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(QVTR_CORRECTION_START)).toBe('04:00');
});
test('history byte-for-byte retained on four intervals; append/restart deterministic; past queries do not reveal future',async()=>{
  const baseline = new TestMarketSimulation(listingSimulationConfig(source));
  await journal.append(admin,0,at,proposal.program,'QVTR offline acceleration preview');
  const reloaded=new IsolatedScenarioJournal(file,source,()=>now);
  for(const interval of ['1m','5m','15m','1h'] as const){
    const from=at-6*3600000;
    const result=await journal.preview(QVTR_CORRECTION_END,from,interval);
    expect(await reloaded.preview(QVTR_CORRECTION_END,from,interval)).toEqual(result);
    const original=(interval==='1m'?baseline.candles1m(at,from):aggregateCandles(baseline.candles5m(at,from),SIM_INTERVALS[interval])).filter(c=>c.openTime<at);
    expect(result.candles.filter(c=>c.openTime+SIM_INTERVALS[interval]<=at)).toEqual(original);
    const past=await journal.preview(at-1,from,interval);
    const forming=interval==='1m'?baseline.candles1m(at-1,from):aggregateCandles(baseline.candles5m(at-1,from),SIM_INTERVALS[interval]);expect(past.candles).toEqual(forming);
  }
});
test('canonical OHLC aggregate across intervals; cap, counter-moves, variable bodies/wicks, WAVES endpoints',async()=>{
  await journal.append(admin,0,at,proposal.program,'offline model');
  const end=Date.parse(source.listingAt)+300*3600000;
  const minutes=(await journal.preview(end,at,'1m')).candles;
  for(const c of minutes){expect(c.low).toBeGreaterThan(0);expect(c.high).toBeLessThanOrEqual(.88858);
    expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open,c.close));expect(c.low).toBeLessThanOrEqual(Math.min(c.open,c.close));}
  const rise=minutes.filter(c=>c.openTime<QVTR_PEAK_AT);
  expect(rise.some(c=>c.close<c.open)).toBe(true);expect(rise.some(c=>c.close>c.open)).toBe(true);
  expect(new Set(rise.map(c=>(c.high-c.low).toFixed(7))).size).toBeGreaterThan(20);
  for(const interval of ['5m','15m','1h'] as const){
    const actual=(await journal.preview(end,at,interval)).candles;
    const aggregated=interval==='5m'?minutes.filter((_,i)=>i%5===0).map((c,i)=>{
      const group=minutes.slice(i*5,i*5+5);return {...c,high:Math.max(...group.map(x=>x.high)),low:Math.min(...group.map(x=>x.low)),close:group[group.length-1].close};
    }):aggregateCandles(minutes,SIM_INTERVALS[interval]);
    expect(actual.length).toBe(Math.floor((end-at)/SIM_INTERVALS[interval])+1);
    expect(actual.map(c=>[c.openTime,c.open,c.high,c.low,c.close])).toEqual(aggregated.map(c=>[c.openTime,c.open,c.high,c.low,c.close]));
  }
  for(const [hour,price] of [[108,.352],[132,.352],[204,.685],[228,.51],[300,.818]]){
    expect(minutes.find(c=>c.openTime===Date.parse(source.listingAt)+hour*3600000)!.open).toBe(price);
  }
  expect(()=>checkPublishable({...source,simulationProgram:proposal.program},source,now)).toThrow(); // HISTORY_LOCKED remains
});
test('authorization, future gates, CAS, anchor, cap, source scope, tampering and truncated journal fail closed',async()=>{
  await expect(journal.append({id:'guest',role:'USER'},0,at,proposal.program,'x')).rejects.toThrow('ADMIN_REQUIRED');
  await expect(journal.append(admin,0,now,proposal.program,'x')).rejects.toThrow('FUTURE_BOUNDARY_REQUIRED');
  await expect(journal.append(admin,1,at,proposal.program,'x')).rejects.toThrow('REVISION_CONFLICT');
  const changed=JSON.parse(JSON.stringify(proposal.program));changed.maxPrice='0.9';
  await expect(journal.append(admin,0,at,changed,'x')).rejects.toThrow('CAP_LOCKED');
  changed.maxPrice='0.88858';changed.stages[2].targetPrice='0.18';
  await expect(journal.append(admin,0,at,changed,'x')).rejects.toThrow('ANCHOR_MISMATCH');
  expect(()=>new IsolatedScenarioJournal(file,{...source,tradable:true})).toThrow('ISOLATED_NON_TRADABLE_ONLY');
  await journal.append(admin,0,at,proposal.program,'x');
  await expect(journal.append(admin,0,at+300000,proposal.program,'duplicate')).rejects.toThrow('REVISION_CONFLICT');
  const bytes=await readFile(file,'utf8');await writeFile(file,bytes.replace('isolated-admin','forged-admin'));
  await expect(journal.history()).rejects.toThrow('INVALID_JOURNAL');
  await writeFile(file,bytes.trim());await expect(journal.history()).rejects.toThrow('INCOMPLETE_JOURNAL');
});
test('second version preserves first version and prior candles, with immutable audit chain',async()=>{
  await journal.append(admin,0,at,proposal.program,'first');const before=await journal.preview(QVTR_CORRECTION_END-1,at);
  const second=JSON.parse(JSON.stringify(proposal.program)); second.stages[second.stages.length-1].targetPrice='0.80';
  await journal.append({...admin,id:'second-admin'},1,QVTR_CORRECTION_END,second,'future recovery only');
  expect(await journal.preview(QVTR_CORRECTION_END-1,at)).toEqual(before);
  const history=await journal.history();expect(history[1].previousHash).toBe(history[0].hash);expect(history.map(r=>r.revision)).toEqual([1,2]);
});
test('concurrent administrators append exactly one revision; existing 5m aggregation contract remains unchanged',async()=>{
  const another=new IsolatedScenarioJournal(file,source,()=>now);
  const results=await Promise.allSettled([journal.append(admin,0,at,proposal.program,'one'),another.append(admin,0,at,proposal.program,'two')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(await journal.history()).toHaveLength(1);
  const base=new TestMarketSimulation(listingSimulationConfig(source)).candles5m(at,at-3600000);
  expect(aggregateCandles(base,300000)).toEqual(base);
});


