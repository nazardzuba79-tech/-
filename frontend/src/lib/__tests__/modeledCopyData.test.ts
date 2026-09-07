import { isModeledResponse, isModeledCatalogueTrader, isModeledTraderData, isModeledAggregate, preserveModeledSource } from '../modeledCopyData';
import { marketplaceTraders, nazarTrader } from '../../pages/copy-trading-bolt/traders';
import { HOME_COPY_TRADERS } from '../../pages/home/homeContent';

const simulation = { seed: 0, simulatedAt: '2026-09-06T12:00:00Z', mode: 'REAL_TIME' };

test.each(['REAL_TIME', 'FAST_FORWARD'])('%s clock remains modeled without an expiration or display-name heuristic', mode => {
  expect(isModeledResponse({ simulation: { ...simulation, mode } })).toBe(true);
  expect(isModeledResponse({ simulation: { ...simulation, simulatedAt: '2030-01-01T00:00:00Z' } })).toBe(true);
});
test.each(['SYNTHETIC_REVIEW', 'SYNTHETIC', 'MODELED', 'FIXTURE'])('%s explicit provenance is modeled', provenance => {
  expect(isModeledResponse({ provenance })).toBe(true);
});
test.each(['REAL', 'LIVE', 'REAL_EXECUTION', 'LIVE_API'])('%s explicit provenance overrides simulation metadata', provenance => {
  expect(isModeledResponse({ provenance, simulation })).toBe(false);
  expect(isModeledTraderData(nazarTrader, { trader: { id: nazarTrader.id }, provenance, simulation })).toBe(false);
});
test.each([null, undefined, {}, [], 'SYNTHETIC_REVIEW', { simulation: {} },
  { simulation: { ...simulation, seed: NaN } }, { simulation: { ...simulation, seed: Infinity } },
  { simulation: { ...simulation, seed: '12' } }, { simulation: { ...simulation, simulatedAt: 'invalid' } },
  { simulation: { ...simulation, simulatedAt: undefined } }, { name: 'Nazar', id: 'VX-001' },
])('missing/invalid/unknown source does not receive a modeled label (%j)', value => {
  expect(isModeledResponse(value)).toBe(false);
  expect(isModeledCatalogueTrader(value)).toBe(false);
});
test('fixture identity is actual object provenance, not a name, id, or copied field set', () => {
  for (const trader of marketplaceTraders) {
    expect(isModeledCatalogueTrader(trader)).toBe(true);
    expect(isModeledCatalogueTrader({ ...trader })).toBe(false);
    expect(isModeledTraderData({ ...trader, provenance: 'LIVE' })).toBe(false);
  }
  expect(isModeledCatalogueTrader(nazarTrader)).toBe(false);
  expect(isModeledTraderData({ id: 'VX-KSENIA', name: 'Ksenia' })).toBe(false);
  expect(HOME_COPY_TRADERS.every(isModeledCatalogueTrader)).toBe(true);
});
test('matching canonical response wins; unrelated synthetic response cannot label another real trader', () => {
  const fixture = marketplaceTraders[0];
  const real = { ...fixture };
  expect(isModeledTraderData(real, { trader: { id: 'VX-001' }, simulation })).toBe(false);
  expect(isModeledTraderData(real, { trader: { id: real.id }, simulation })).toBe(true);
  expect(isModeledTraderData(fixture, { trader: { id: fixture.id }, provenance: 'LIVE', simulation })).toBe(false);
  expect(isModeledTraderData(fixture, { trader: { id: fixture.id } })).toBe(false);
  expect(isModeledTraderData(fixture, { trader: { id: 'VX-001' }, simulation })).toBe(true);
});
test('view projections retain fixture source for cards and opened profiles without mutating any data', () => {
  const fixture = marketplaceTraders[0];
  const before = JSON.stringify(fixture);
  const projected = { ...fixture, drawdown: fixture.drawdown / 2 };
  const projectionBefore = JSON.stringify(projected);
  const projectedKeys = Reflect.ownKeys(projected);
  expect(preserveModeledSource(fixture, projected)).toBe(projected);
  expect(isModeledTraderData(projected)).toBe(true);
  expect(isModeledTraderData(preserveModeledSource(projected, { ...projected }))).toBe(true);
  expect(JSON.stringify(fixture)).toBe(before);
  expect(JSON.stringify(projected)).toBe(projectionBefore);
  expect(Reflect.ownKeys(projected)).toEqual(projectedKeys);
  const fresh = { ...fixture };
  expect(isModeledTraderData(preserveModeledSource(fresh, { ...fresh }))).toBe(false);
  expect(isModeledTraderData(preserveModeledSource(fixture, { ...fixture, provenance: 'LIVE' }))).toBe(false);
});
test('aggregate identifies only actual modeled contributors, not every review-page statistic', () => {
  expect(isModeledAggregate(HOME_COPY_TRADERS)).toBe(true);
  expect(isModeledAggregate([{ provenance: 'LIVE' }, marketplaceTraders[0]])).toBe(true);
  expect(isModeledAggregate(HOME_COPY_TRADERS.map(trader => ({ ...trader })))).toBe(false);
  expect(isModeledAggregate([{ provenance: 'LIVE' }, nazarTrader])).toBe(false);
  expect(isModeledAggregate([])).toBe(false);
  expect(isModeledAggregate()).toBe(false);
});
