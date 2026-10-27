/** ECLAVO (ECLV) scheduled November 6 2026: inert draft only. */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { controlledScenarioHour } from '../../testMarkets/simulationScenarioControls';
import { resolve } from 'path';
import { parseListingConfig, withStableProfile, checkPublishable, listingSimulationConfig, publishedListingAsset, nextListingCountdown, RESERVED_LISTING_SYMBOLS, LOGO_MAX_BYTES } from '../listingConfig';
import { exactPriceFromGain, validateScenarioControls, defaultScenarioControls, LISTING_SCENARIOS } from '../../../shared/listingScenarioControls';
import { DAY_MS, simulationFor, aggregateCandles, SIM_INTERVALS } from '../../testMarkets/testMarketSimulation';

const raw = JSON.parse(readFileSync(resolve(__dirname, '../../../../config/test-markets/eclv-20261103.draft.json'), 'utf8'));
const draft = parseListingConfig(raw);
const saved = withStableProfile(draft, null, 8);
const AT = Date.parse('2026-11-06T13:00:00Z');
const HOUR = 3_600_000;
const listing = { id:'eclv-candidate-only', version:1, publishedAt:new Date(AT-5*DAY_MS).toISOString(),
  config:saved, countdown:{state:'running' as const,updatedAt:AT-5*DAY_MS,updatedBy:'fixture'} };

test('candidate is valid, nontrading, UTC-correct, and has an actual compact branded logo', () => {
  expect(draft).toEqual(raw); // Standalone import/update compares canonical saved data.
  expect(draft).toMatchObject({ symbol:'ECLV',name:'ECLAVO',initialPrice:'0.0140',
    listingAt:'2026-11-06T13:00:00Z',displayTimeZone:'Europe/Moscow',
    seed:'eclavo-20261103-v1',seedMode:'manual',ownerAllocation:'0',tradable:false });
  expect(RESERVED_LISTING_SYMBOLS.has(draft.symbol)).toBe(false);
  expect(draft.logo).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(draft.logo!.length).toBeLessThan(9000);
  expect(new Date(AT).getUTCDay()).toBe(5);
  // One instant, 13:00 UTC: shown as 16:00 Moscow (the display zone, as TYVN) and 15:00 Kyiv.
  const clock = (timeZone: string) => new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(AT));
  expect([clock('UTC'), clock('Europe/Moscow'), clock('Europe/Kyiv')]).toEqual(['13:00', '16:00', '15:00']);
  expect(listingSimulationConfig(draft)).toMatchObject({pair:'ECLV/USDT',initialPrice:.014,isTradable:false});
});

test('deterministic deep-recovery program and mathematically consistent bounds', () => {
  const program = saved.simulationProgram!;
  if (program.kind !== 'scenario-controls-v2') throw new Error('expected v2');
  expect(program.scenario).toBe('DEEP_RECOVERY');
  expect(() => validateScenarioControls(program,draft.initialPrice)).not.toThrow();
  expect(exactPriceFromGain(draft.initialPrice,program.first24hGainPercent)).toBe('0.1092');
  expect(exactPriceFromGain(draft.initialPrice,'7148')).toBe(program.maxPrice);
  expect(program.stages.map(s=>s.type)).toEqual(['growth','range','growth','pullback','recovery']);
  expect(program.stages.reduce((n,s)=>n+s.durationHours,0)).toBe(252);
  expect(withStableProfile(draft,null,13).simulationProgram).toEqual(saved.simulationProgram);
  const sim = simulationFor(publishedListingAsset(listing));
  expect(sim.priceAt(AT-1)).toBeNull();
  expect(sim.priceAt(AT)).toBeCloseTo(.014,9);
  expect(sim.priceAt(AT+DAY_MS)).toBeCloseTo(.1092,9);
  for(let t=AT;t<=AT+10*DAY_MS;t+=HOUR){
    const price=sim.priceAt(t)!;
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThanOrEqual(1.01472);
  }
});

test('the logo file is the config logo byte for byte, so «Выбрать файл» reproduces the same data URL', () => {
  const svg = readFileSync(resolve(__dirname, '../../../../config/test-markets/eclv-20261103.logo.svg'));
  expect(draft.logo).toBe(`data:image/svg+xml;base64,${svg.toString('base64')}`);
  expect(svg.length).toBeLessThan(LOGO_MAX_BYTES);
});

test('every value can be entered in Admin → Listings exactly (no hidden or unreachable setting)', () => {
  const program = saved.simulationProgram!;
  if (program.kind !== 'scenario-controls-v2') throw new Error('expected v2');
  // «Разнообразие размеров свечей» is a range input with step 0.05; any other value snaps on the page.
  expect(Math.round(program.candles.diversity * 20) / 20).toBe(program.candles.diversity);
  expect(Number.isInteger(program.pullbacks.durationMinutes)).toBe(true);
  expect(program.stages.every(s => Number.isInteger(s.durationHours))).toBe(true);
  expect(program.stages.length).toBeLessThanOrEqual(12); // «Добавить этап» stops at 12
  expect(program.afterGrowth).toBe('range');
  expect(program.historical).toBeUndefined();
});

test('the chart is the same whatever creation ordinal production assigns, and 5m highs never pass 1.01472', () => {
  const at = (ordinal: number | null) => simulationFor(publishedListingAsset({ ...listing, config: withStableProfile(draft, null, ordinal) }));
  const reference = JSON.stringify(at(8).candles5m(AT + 3 * DAY_MS, AT));
  for (const ordinal of [null, 1, 2, 3, 4, 9]) expect(JSON.stringify(at(ordinal).candles5m(AT + 3 * DAY_MS, AT))).toBe(reference);
  const candles = simulationFor(publishedListingAsset(listing)).candles5m(AT + 12 * DAY_MS, AT);
  expect(candles[0].open).toBeCloseTo(.014, 10);
  expect(Math.max(...candles.map(c => c.high))).toBeLessThanOrEqual(1.01472);
  expect(Math.min(...candles.map(c => c.low))).toBeGreaterThan(0);
});

test('phases: each stage ends on its target, rises and falls inside, day one keeps the approved deep fall; 1m/5m/1h tell one history', () => {
  const program = saved.simulationProgram!;
  if (program.kind !== 'scenario-controls-v2') throw new Error('expected v2');
  const sim = simulationFor(publishedListingAsset(listing));
  const end = program.stages.reduce((n, s) => n + s.durationHours, 0);
  const hourly = aggregateCandles(sim.candles5m(AT + end * HOUR, AT), SIM_INTERVALS['1h']);
  let hours = 0;
  for (const stage of program.stages) {
    const segment = hourly.slice(hours, hours + stage.durationHours);
    hours += stage.durationHours;
    expect(sim.priceAt(AT + hours * HOUR)).toBeCloseTo(Number(stage.targetPrice), 9);
    expect(segment.some(c => c.close > c.open) && segment.some(c => c.close < c.open)).toBe(true);
    expect(Math.max(...segment.map(c => c.high))).toBeLessThanOrEqual(1.01472);
  }
  // DEEP_RECOVERY as approved: inside day one the price falls by more than 60 % from its high before closing at 0.1092.
  let high = 0, drawdown = 0;
  for (const c of hourly.slice(0, 24)) { high = Math.max(high, c.high); drawdown = Math.max(drawdown, 1 - c.low / high); }
  expect(drawdown).toBeGreaterThan(.6);
  // 1m candles: continuous, within bounds, and every five of them are exactly their 5m candle.
  const minutes = sim.candles1m(AT + 3 * HOUR, AT), fives = sim.candles5m(AT + 3 * HOUR, AT);
  for (let i = 1; i < minutes.length; i++) expect(minutes[i].open).toBe(minutes[i - 1].close);
  expect(minutes.every(c => c.low > 0 && c.high <= 1.01472)).toBe(true);
  for (let i = 0; i < 36; i++) {
    const group = minutes.slice(i * 5, i * 5 + 5);
    expect([group[0].open, Math.max(...group.map(c => c.high)), Math.min(...group.map(c => c.low)), group[4].close])
      .toEqual([fives[i].open, fives[i].high, fives[i].low, fives[i].close]);
  }
});

test('draft is publishable only before start, timer requires a separate owner action', () => {
  expect(() => checkPublishable(saved,null,AT-7*DAY_MS)).not.toThrow();
  expect(() => checkPublishable(saved,null,AT)).toThrow();
  const staged={...listing,countdown:{state:'staged' as const,updatedAt:AT-5*DAY_MS,updatedBy:'fixture'}};
  expect(nextListingCountdown(staged,'start',AT-DAY_MS)).toBe('running');
  expect(() => nextListingCountdown(staged,'start',AT)).toThrow();
});

test('the existing recovery actually reaches +7148%, not only a higher unused ceiling',()=>{
  const sim=simulationFor(publishedListingAsset(listing));
  const program=saved.simulationProgram!;
  if(program.kind!=='scenario-controls-v2')throw new Error('expected v2');
  expect(program.stages.map(s=>[s.type,s.durationHours])).toEqual([
    ['growth',24],['range',24],['growth',96],['pullback',36],['recovery',72],
  ]);
  expect(program.stages.slice(0,-1).map(s=>s.targetPrice)).toEqual(['0.1092','0.1092','0.315','0.2142']);
  const peakAt=AT+252*HOUR;
  expect(program.stages.at(-1)!.targetPrice).toBe('1.01472');
  expect(sim.priceAt(peakAt)).toBeCloseTo(1.01472,10);
  const peakMinutes=sim.candles1m(peakAt+HOUR,peakAt-HOUR);
  const peakFives=sim.candles5m(peakAt+HOUR,peakAt-HOUR);
  const peakHours=aggregateCandles(peakFives,SIM_INTERVALS['1h']);
  for(const candles of [peakMinutes,peakFives,peakHours]){
    expect(Math.max(...candles.map(c=>c.high))).toBeCloseTo(1.01472,10);
    expect(candles.every(c=>[c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0&&v<=1.01472))).toBe(true);
    for(let i=1;i<candles.length;i++)expect(candles[i].open).toBe(candles[i-1].close);
    for(const c of candles){expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open,c.close));expect(c.low).toBeLessThanOrEqual(Math.min(c.open,c.close));}
  }
  // It remains a moving bounded range after the recovery; never a straight
  // extrapolation above the owner's cap.
  const after=sim.candles5m(peakAt+48*HOUR,peakAt);
  expect(after.some(c=>c.close<c.open)).toBe(true);
  expect(after.some(c=>c.close>c.open)).toBe(true);
  expect(after.every(c=>c.high<=1.01472&&c.low>0)).toBe(true);
});

test('moving the start preserves seed/profile and all elapsed phase durations',()=>{
  const prior={...saved,listingAt:'2026-11-03T13:00:00Z'};
  const moved=withStableProfile(draft,prior,null);
  expect(moved.seed).toBe(prior.seed);
  expect(moved.simulationProfile).toBe(prior.simulationProfile);
  expect(moved.wickModel).toBe(prior.wickModel);
  const sim=simulationFor(publishedListingAsset({...listing,config:moved}));
  expect(sim.priceAt(Date.parse('2026-11-03T13:00:00Z'))).toBeNull();
  expect(sim.priceAt(AT-1)).toBeNull();
  expect(sim.priceAt(AT)).toBeCloseTo(.014,10);
  for(const [hours,price] of [[24,.1092],[48,.1092],[144,.315],[180,.2142],[252,1.01472]])expect(sim.priceAt(AT+hours*HOUR)).toBeCloseTo(price,9);
});

test('the cap endpoint exception is restricted to a FINAL deep recovery followed by a range',()=>{
  const base=JSON.parse(JSON.stringify(raw));
  expect(()=>parseListingConfig(base)).not.toThrow();
  for(const mutate of [
    (p:any)=>{p.scenario='WAVES';},
    (p:any)=>{p.stages.at(-1).type='growth';},
    (p:any)=>{p.stages.at(-1).targetPrice='1.0147200001';},
    (p:any)=>{p.stages.at(-1).targetPrice='0.9944256';}, // 98% remains invalid.
    (p:any)=>{p.stages[2].targetPrice=p.maxPrice;},
    (p:any)=>{p.afterGrowth='historical';},
  ]){
    const changed=JSON.parse(JSON.stringify(base));mutate(changed.simulationProgram);
    expect(()=>parseListingConfig(changed)).toThrow();
  }
});


test('all previously valid scenario paths and the original ECLAVO/QVTR retain their pre-change 88-hour tick fingerprint',()=>{
  const rows:unknown[]=[];
  for(const scenario of LISTING_SCENARIOS){
    const controls=defaultScenarioControls('0.8',scenario);
    for(const hour of [0,23,24,100,167,168,200])rows.push(controlledScenarioHour({mode:'scenario-controls-v2',version:2,from:0,initialPrice:'0.8',controls},'unchanged-regression',hour));
  }
  const original=JSON.parse(JSON.stringify(raw));original.listingAt='2026-11-03T13:00:00Z';original.simulationProgram.maxPrice='0.518';original.simulationProgram.stages.at(-1).targetPrice='0.435';
  const qvtr=JSON.parse(readFileSync(resolve(__dirname,'../../../../config/test-markets/qvtr-20261028.draft.json'),'utf8'));
  for(const d of [original,qvtr])for(const hour of [0,23,24,48,143,180,251,252,300])rows.push(controlledScenarioHour({mode:'scenario-controls-v2',version:2,from:Date.parse(d.listingAt),initialPrice:d.initialPrice,controls:d.simulationProgram},d.seed,hour));
  // Captured BEFORE the terminal-peak implementation: every tick, wick, volume
  // and regime, not only candle closes. Do not regenerate to mask a regression.
  expect(rows).toHaveLength(88);
  expect(createHash('sha256').update(JSON.stringify(rows)).digest('hex')).toBe('1d9684bcece301c6ca644d3b400ffac27673a29044b63cac9ede7744ffa16840');
});
