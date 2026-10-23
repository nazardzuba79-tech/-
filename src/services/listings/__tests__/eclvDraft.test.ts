/** ECLAVO (ECLV) scheduled November 3 2026: inert draft only. */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseListingConfig, withStableProfile, checkPublishable, listingSimulationConfig, publishedListingAsset, nextListingCountdown, RESERVED_LISTING_SYMBOLS, LOGO_MAX_BYTES } from '../listingConfig';
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
    listingAt:'2026-11-03T13:00:00Z',displayTimeZone:'Europe/Moscow',
    seed:'eclavo-20261103-v1',seedMode:'manual',ownerAllocation:'0',tradable:false });
  expect(RESERVED_LISTING_SYMBOLS.has(draft.symbol)).toBe(false);
  expect(draft.logo).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(draft.logo!.length).toBeLessThan(9000);
  expect(new Date(AT).getUTCDay()).toBe(2);
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

test('the chart is the same whatever creation ordinal production assigns, and 5m highs never pass 0.518', () => {
  const at = (ordinal: number | null) => simulationFor(publishedListingAsset({ ...listing, config: withStableProfile(draft, null, ordinal) }));
  const reference = JSON.stringify(at(8).candles5m(AT + 3 * DAY_MS, AT));
  for (const ordinal of [null, 1, 2, 3, 4, 9]) expect(JSON.stringify(at(ordinal).candles5m(AT + 3 * DAY_MS, AT))).toBe(reference);
  const candles = simulationFor(publishedListingAsset(listing)).candles5m(AT + 12 * DAY_MS, AT);
  expect(candles[0].open).toBeCloseTo(.014, 10);
  expect(Math.max(...candles.map(c => c.high))).toBeLessThanOrEqual(.518);
  expect(Math.min(...candles.map(c => c.low))).toBeGreaterThan(0);
});

test('draft is publishable only before start, timer requires a separate owner action', () => {
  expect(() => checkPublishable(saved,null,AT-7*DAY_MS)).not.toThrow();
  expect(() => checkPublishable(saved,null,AT)).toThrow();
  const staged={...listing,countdown:{state:'staged' as const,updatedAt:AT-5*DAY_MS,updatedBy:'fixture'}};
  expect(nextListingCountdown(staged,'start',AT-DAY_MS)).toBe('running');
  expect(() => nextListingCountdown(staged,'start',AT)).toThrow();
});
