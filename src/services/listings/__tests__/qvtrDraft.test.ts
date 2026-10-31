/** QAVENTRA — separate October 28 2026 DEMO candidate. Does not change ECLAVO. */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseListingConfig, withStableProfile, checkPublishable, listingSimulationConfig, publishedListingAsset, LOGO_MAX_BYTES, RESERVED_LISTING_SYMBOLS } from '../listingConfig';
import { exactPriceFromGain, validateScenarioControls } from '../../../shared/listingScenarioControls';
import { DAY_MS, simulationFor } from '../../testMarkets/testMarketSimulation';
const here = (...p: string[]) => resolve(__dirname,'../../../../',...p);
const fresh = JSON.parse(readFileSync(here('config/test-markets/qvtr-20261028.draft.json'),'utf8'));
const original = JSON.parse(readFileSync(here('config/test-markets/eclv-20261103.draft.json'),'utf8'));
const draft = parseListingConfig(fresh);
const saved = withStableProfile(draft,null,7);
const AT = Date.parse('2026-10-28T13:00:00Z');
const item = { id:'qvtr-candidate-only', version:1, publishedAt:new Date(AT-2*DAY_MS).toISOString(), config:saved,
  countdown:{state:'running' as const,updatedAt:AT-2*DAY_MS,updatedBy:'fixture'} };

test('independent ticker, name, date, logo and seed; ECLAVO remains independently scheduled',()=>{
  // The standalone importer compares the saved canonical draft to this file.
  // A numerically equal but noncanonical stage price (e.g.0.510) used to
  // report a false failure after the draft was already created.
  expect(draft).toEqual(fresh);
  expect(draft).toMatchObject({symbol:'QVTR',name:'QAVENTRA',listingAt:'2026-10-28T13:00:00Z',displayTimeZone:'Europe/Moscow',
    initialPrice:'0.0140',seed:'qaventra-20261028-v1',tradable:false,ownerAllocation:'0'});
  expect([draft.symbol,draft.name,draft.seed,draft.listingAt,draft.logo]).not.toContain(null);
  expect(RESERVED_LISTING_SYMBOLS.has(draft.symbol)).toBe(false);
  expect(original.symbol).toBe('ECLV');
  expect(original.name).toBe('ECLAVO');
  expect(original.listingAt).toBe('2026-11-06T13:00:00Z');
  expect(original.seed).toBe('eclavo-20261103-v1');
  expect(original.simulationProgram.maxPrice).toBe('1.01472');
  expect(draft.symbol).not.toBe(original.symbol);
  expect(draft.name).not.toBe(original.name);
  expect(draft.seed).not.toBe(original.seed);
  expect(draft.logo).not.toBe(original.logo);
  expect(listingSimulationConfig(draft)).toMatchObject({pair:'QVTR/USDT',initialPrice:.014,isTradable:false});
});

test('separate +6247% ceiling, day-one +680%, WAVES and coherent independent phases',()=>{
  expect(exactPriceFromGain('0.0140','6247')).toBe('0.88858');
  const p=saved.simulationProgram!;
  if(p.kind!=='scenario-controls-v2')throw new Error('v2 expected');
  expect(p.scenario).toBe('WAVES');
  expect(p.maxPrice).toBe('0.88858');
  expect(exactPriceFromGain('0.0140',p.first24hGainPercent)).toBe('0.1092');
  expect(()=>validateScenarioControls(p,draft.initialPrice)).not.toThrow();
  expect(p.stages.reduce((h,s)=>h+s.durationHours,0)).toBe(300);
  expect(p.stages.map(s=>s.type)).toEqual(['growth','pullback','growth','range','growth','pullback','recovery']);
  expect(p.afterGrowth).toBe('range');
  expect(p.historical).toBeUndefined();
  expect(Math.round(p.candles.diversity*20)/20).toBe(p.candles.diversity);
  expect(withStableProfile(draft,null,17).simulationProgram).toEqual(saved.simulationProgram);
});

test('new image file is exactly the logo stored in the config',()=>{
  const bytes=readFileSync(here('config/test-markets/qvtr-20261028.logo.svg'));
  expect(bytes.length).toBeLessThan(LOGO_MAX_BYTES);
  expect(draft.logo).toBe('data:image/svg+xml;base64,'+bytes.toString('base64'));
  expect(draft.logo).not.toBe(original.logo);
});

test('inert prelisting, explicit publish/timer gates and modeled price bounded',()=>{
  expect(()=>checkPublishable(saved,null,AT-2*DAY_MS)).not.toThrow();
  expect(()=>checkPublishable(saved,null,AT)).toThrow();
  const sim=simulationFor(publishedListingAsset(item));
  expect(sim.priceAt(AT-1)).toBeNull();
  expect(sim.priceAt(AT)).toBeCloseTo(.014,8);
  expect(sim.priceAt(AT+DAY_MS)).toBeCloseTo(.1092,8);
  const candles=sim.candles5m(AT+2*DAY_MS,AT);
  expect(candles.length).toBeGreaterThan(100);
  expect(candles.every(c=>c.low>0&&c.high<=.88858)).toBe(true);
});

test('all seven phase endpoints and the full five-minute path respect the saved cap',()=>{
  const p=saved.simulationProgram!;
  if(p.kind!=='scenario-controls-v2')throw new Error('v2 expected');
  const sim=simulationFor(publishedListingAsset(item));
  let hours=0;
  for(const phase of p.stages){
    hours+=phase.durationHours;
    expect(sim.priceAt(AT+hours*3_600_000)).toBeCloseTo(Number(phase.targetPrice),8);
  }
  const candles=sim.candles5m(AT+(hours+24)*3_600_000,AT);
  expect(candles).toHaveLength(3889);
  for(const c of candles){
    expect([c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0&&v<=.88858)).toBe(true);
    expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open,c.close));
    expect(c.low).toBeLessThanOrEqual(Math.min(c.open,c.close));
  }
});

test('the scheduled UTC instant is 15:00 Kyiv and 16:00 Moscow on October28',()=>{
  const clock=(timeZone:string)=>new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(AT));
  expect(clock('UTC')).toBe('13:00');
  expect(clock('Europe/Kyiv')).toBe('15:00');
  expect(clock('Europe/Moscow')).toBe('16:00');
});
