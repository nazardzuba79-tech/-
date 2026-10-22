import { importHistoricalHourlyCsv, validateHistoricalMoveProgram, historicalReplayBounds, historicalReplayHour } from '../../../shared/listingHistoricalReplay';
import { importHistoricalCsv } from '../../../../frontend/src/pages/admin/listingHistoricalImport';
import { defaultScenarioControls, validateScenarioControls } from '../../../shared/listingScenarioControls';
import { checkPublishable, listingSimulationConfig, parseListingConfig } from '../listingConfig';
import { controlledScenarioHour } from '../../testMarkets/simulationScenarioControls';

const HOUR=3600000;
function csv(steps=72): string {
  let price=100;
  return Array.from({length:steps},(_,i)=>{
    const open=price, close=open*(1+(i%3===0?.015:i%3===1?-.009:.002));
    const high=Math.max(open,close)*1.004,low=Math.min(open,close)*.996;
    price=close;
    return [Date.parse('2018-01-01T00:00:00Z')/1000+i*3600,open,high,low,close,500,12].join(',');
  }).join('\n');
}
const source=()=>importHistoricalHourlyCsv(csv(),'BTC/USDT');
function scenario() {
  const p=defaultScenarioControls('2','CALM');
  return { ...p, stages:[...p.stages,{type:'pullback' as const,durationHours:24,targetPrice:'10'}],
    afterGrowth:'historical' as const,historical:{version:1 as const,clips:[source()]} };
}

describe('Historical hourly movement after the planned growth and fall',()=>{
  test('frontend and backend read the same CSV into identical per-hour PPM moves, never import prices or volume',()=>{
    const server=source(),browser=importHistoricalCsv(csv(),'BTC/USDT');
    expect(browser).toEqual(server);
    expect(server.bars).toHaveLength(72);
    expect(JSON.stringify(server)).not.toContain('"volume"');
    expect(server.sourceStart).toBe('2018-01-01T00:00:00.000Z');
    expect(server.bars[0][2]).toBe(15000);
  });
  test('a 90-day date selection from a longer historical CSV equals exactly the same 2160 real source hours',()=>{
    const raw=csv(3000);
    const selected=raw.split('\n').slice(14*24,14*24+2160).join('\n');
    const fromBrowser=importHistoricalCsv(raw,'BTC/USDT',{startDateUtc:'2018-01-15',hours:2160});
    const fromServer=importHistoricalHourlyCsv(selected,'BTC/USDT');
    expect(fromBrowser).toEqual(fromServer);
    expect(fromBrowser.sourceStart).toBe('2018-01-15T00:00:00.000Z');
    expect(fromBrowser.bars).toHaveLength(2160);
    expect(()=>importHistoricalCsv(csv(72),'BTC/USDT',{hours:2160})).toThrow(/период/);
    expect(()=>importHistoricalCsv(raw,'BTC/USDT',{startDateUtc:'2017-01-01',hours:24})).toThrow(/дат/);
  });

  test('CSV gaps, malformed OHLC and sub-hour timestamps fail closed',()=>{
    const lines=csv().split('\n');
    expect(()=>importHistoricalHourlyCsv(lines.filter((_,i)=>i!==6).join('\n'),'BTC/USDT')).toThrow(/Пропущенный/);
    const bad=lines.slice();bad[4]=bad[4].replace(/^\d+/,String(Date.parse('2018-01-01T04:30:00Z')/1000));
    expect(()=>importHistoricalHourlyCsv(bad.join('\n'),'BTC/USDT')).toThrow(/Пропущенный/);
    expect(()=>importHistoricalCsv('not-a-csv','ETH/USDT')).toThrow();
  });
  test('hourly movement takes exactly one real hour per source hour and joins without a price jump',()=>{
    const p={version:1 as const,clips:[source()]}, anchor=10;
    const first=historicalReplayHour(p,anchor,0,'qax');
    const second=historicalReplayHour(p,anchor,1,'qax');
    expect(first.ticks).toHaveLength(360);
    expect(first.open).toBe(10);
    expect(first.ticks[359].price).toBeCloseTo(10*1.015,9);
    expect(second.open).toBeCloseTo(first.ticks[359].price,9);
    // Hourly OHLC has NO temporal order for high vs low. Assert each source
    // bound is reproduced exactly, regardless of the modeled order.
    const sourceBar = source().bars[0];
    expect(Math.max(...first.ticks.map(t => t.high))).toBeCloseTo(anchor * (1 + sourceBar[0] / 1000000), 9);
    expect(Math.min(...first.ticks.map(t => t.low))).toBeCloseTo(anchor * (1 + sourceBar[1] / 1000000), 9);
    expect(first.ticks.every(t=>t.price>0&&t.high>=t.price&&t.low<=t.price)).toBe(true);
    expect(historicalReplayHour(p,anchor,0,'qax')).toEqual(first);
    expect(historicalReplayHour(p,anchor,72,'qax').open).toBeCloseTo(historicalReplayBounds(p,anchor).close,7);
  });
  test('two different historical assets chain at the previous clip close with no timestamp acceleration',()=>{
    const a=source(),b=importHistoricalHourlyCsv(csv(48),'ETH/USDT');
    const p={version:1 as const,clips:[a,b]};
    validateHistoricalMoveProgram(p);
    const lastOfA=historicalReplayHour(p,10,71,'seed');
    const firstOfB=historicalReplayHour(p,10,72,'seed');
    expect(firstOfB.open).toBeCloseTo(lastOfA.ticks[359].price,7);
    expect(firstOfB.ticks[359].price/firstOfB.open).toBeCloseTo(1.015,6);
  });
  test('program keeps the original growth and final 24-hour fall, without overwriting earlier hours',()=>{
    const p=scenario();
    expect(()=>validateScenarioControls(p,'2')).not.toThrow();
    const base={...p,afterGrowth:'range' as const,historical:undefined};
    const conf={mode:'scenario-controls-v2' as const,version:2 as const,from:Date.parse('2026-11-01T00:00:00Z'),initialPrice:'2',controls:p};
    for(const hour of [0,24,100,167,168,180,191]){
      const original=controlledScenarioHour({...conf,controls:base},'qa-seed',hour);
      const continuation=controlledScenarioHour(conf,'qa-seed',hour);
      expect(continuation).toEqual(original);
    }
    const start=controlledScenarioHour(conf,'qa-seed',192);
    expect(start.open).toBe(10);
    expect(start.ticks[359].price).toBeCloseTo(10*1.015,8);
  });
  test('draft stores for private preview; publication is refused until legal clearance and paper isolation',()=>{
    const config=parseListingConfig({
      schemaVersion:1,symbol:'QAX',name:'Historical review',logo:null,
      initialPrice:'2',listingAt:'2026-11-01T00:00:00Z',displayTimeZone:'UTC',
      ownerAllocation:'0',seedMode:'manual',seed:'review-seed-123',
      tradable:false,simulationProgram:scenario(),
    });
    expect(listingSimulationConfig(config).scheduledScenario?.mode).toBe('scenario-controls-v2');
    expect(()=>checkPublishable(config,null,Date.parse('2026-10-31T00:00:00Z'))).toThrow(/Историческое движение/);
    expect(()=>parseListingConfig({...config,tradable:true})).toThrow(/DEMO|demo/i);
  });
  test('historical mode requires a final drop, a source dataset and valid maximum price',()=>{
    const p=scenario();
    expect(()=>validateScenarioControls({...p,stages:p.stages.slice(0,-1)},'2')).toThrow(/падения/);
    expect(()=>validateScenarioControls({...p,historical:undefined},'2')).toThrow(/CSV/);
    const tooLow={...p,maxPrice:'36.51'};
    expect(()=>validateScenarioControls(tooLow,'2')).toThrow();
  });
});
