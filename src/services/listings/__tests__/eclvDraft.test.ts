/** ECLAVO (ECLV) scheduled November 3 2026: inert draft only. */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseListingConfig, withStableProfile, checkPublishable, listingSimulationConfig, publishedListingAsset, nextListingCountdown, RESERVED_LISTING_SYMBOLS } from '../listingConfig';
import { exactPriceFromGain, validateScenarioControls } from '../../../shared/listingScenarioControls';
import { DAY_MS, simulationFor } from '../../testMarkets/testMarketSimulation';

const raw = JSON.parse(readFileSync(resolve(__dirname, '../../../../config/test-markets/eclv-20261103.draft.json'), 'utf8'));
const draft = parseListingConfig(raw);
const saved = withStableProfile(draft, null, 8);
const AT = Date.parse('2026-11-03T13:00:00Z');
const HOUR = 3_600_000;
const listing = { id:'eclv-candidate-only', version:1, publishedAt:new Date(AT-5*DAY_MS).toISOString(),
  config:saved, countdown:{state:'running' as const,updatedAt:AT-5*DAY_MS,updatedBy:'fixture'} };

test('candidate is valid, nontrading, UTC-correct, and has an actual compact branded logo', () => {
  expect(draft).toMatchObject({ symbol:'ECLV',name:'ECLAVO',initialPrice:'0.0140',
    listingAt:'2026-11-03T13:00:00Z',displayTimeZone:'Europe/Kyiv',
    seed:'eclavo-20261103-v1',seedMode:'manual',ownerAllocation:'0',tradable:false });
  expect(RESERVED_LISTING_SYMBOLS.has(draft.symbol)).toBe(false);
  expect(draft.logo).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(draft.logo!.length).toBeLessThan(9000);
  expect(new Date(AT).getUTCDay()).toBe(2);
  expect(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(AT))).toBe('15:00');
  expect(listingSimulationConfig(draft)).toMatchObject({pair:'ECLV/USDT',initialPrice:.014,isTradable:false});
});

test('deterministic deep-recovery program and mathematically consistent bounds', () => {
  const program = saved.simulationProgram!;
  if (program.kind !== 'scenario-controls-v2') throw new Error('expected v2');
  expect(program.scenario).toBe('DEEP_RECOVERY');
  expect(() => validateScenarioControls(program,draft.initialPrice)).not.toThrow();
  expect(exactPriceFromGain(draft.initialPrice,program.first24hGainPercent)).toBe('0.1092');
  expect(exactPriceFromGain(draft.initialPrice,'3600')).toBe(program.maxPrice);
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
    expect(price).toBeLessThanOrEqual(.518);
  }
});

test('draft is publishable only before start, timer requires a separate owner action', () => {
  expect(() => checkPublishable(saved,null,AT-7*DAY_MS)).not.toThrow();
  expect(() => checkPublishable(saved,null,AT)).toThrow();
  const staged={...listing,countdown:{state:'staged' as const,updatedAt:AT-5*DAY_MS,updatedBy:'fixture'}};
  expect(nextListingCountdown(staged,'start',AT-DAY_MS)).toBe('running');
  expect(() => nextListingCountdown(staged,'start',AT)).toThrow();
});
