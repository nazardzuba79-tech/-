import { existsSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { getTraderVisual } from '../../pages/copy-trading-bolt/traderVisuals';
import { marketplaceTraders, sortTraders } from '../../pages/copy-trading-bolt/traders';

const catalogueIds = marketplaceTraders.map(trader => trader.id);
const categories = ['mascot', 'digital', 'portrait', 'abstract', 'initials'];

test('real owner, Ksenia and unknown accounts never resolve to fictional catalogue art', () => {
  for (const id of ['VX-001', 'Ksenia', 'ksenia', 'ksenia-real-account', 'new-server-account', 'toString', '__proto__']) {
    expect(getTraderVisual(id)).toEqual({});
  }
  expect(marketplaceTraders.some(t => /ksenia|ксени/i.test(t.name))).toBe(false);
});

test('all 30 ordinary identities are stable, local and have no business-state keys', () => {
  expect(catalogueIds).toHaveLength(30);
  for (const id of catalogueIds) {
    const visual = getTraderVisual(id);
    expect(getTraderVisual(id)).toBe(visual);
    expect(categories).toContain(visual.category);
    expect(Object.keys(visual).every(key => ['category', 'mark', 'avatarSrc', 'initials', 'accent', 'background', 'highlight'].includes(key))).toBe(true);
    if (visual.category === 'initials') {
      expect(visual.avatarSrc).toBeUndefined();
      expect(visual.mark).toBeUndefined();
    } else expect(visual.avatarSrc || visual.mark).toBeTruthy();
    if (visual.avatarSrc) {
      expect(visual.avatarSrc).toMatch(/^\/copy-trading\/avatars\/[a-z-]+\.webp$/);
      expect(visual.mark).toBeTruthy();
      const file = resolve(__dirname, '../../../public' + visual.avatarSrc);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeLessThan(12_000);
      expect(readFileSync(file).subarray(8, 12).toString()).toBe('WEBP');
    }
    expect(JSON.stringify(visual)).not.toMatch(/https?:|data:|\/\//i);
  }
});

test('organic mix includes seven intentional initials, never all polished custom art', () => {
  expect(Object.fromEntries(categories.map(category => [category, catalogueIds.filter(id => getTraderVisual(id).category === category).length])))
    .toEqual({ mascot: 8, digital: 5, portrait: 5, abstract: 5, initials: 7 });
  expect(7 / catalogueIds.length).toBeGreaterThanOrEqual(0.20);
  expect(7 / catalogueIds.length).toBeLessThanOrEqual(0.25);
  for (const roster of [marketplaceTraders, sortTraders(marketplaceTraders, 'Top Performance', '90D')]) {
    expect(new Set(roster.slice(0, 8).map(t => getTraderVisual(t.id).category)).size).toBe(5);
  }
  expect(getTraderVisual('VX-002').category).toBe('initials');
  expect(getTraderVisual('VX-016').category).toBe('mascot');
  expect(getTraderVisual('VX-028').category).toBe('digital');
});

test('good existing art and all existing card treatments are retained', () => {
  expect(getTraderVisual('VX-007').avatarSrc).toBe('/copy-trading/avatars/moon-rabbit.webp');
  expect(getTraderVisual('VX-010').avatarSrc).toBe('/copy-trading/avatars/panda-block.webp');
  expect(['VX-008', 'VX-013', 'VX-014', 'VX-018'].map(id => getTraderVisual(id).mark))
    .toEqual(['mountain', 'river', 'constellation', 'delta']);
  expect(catalogueIds.filter(id => getTraderVisual(id).highlight)).toEqual(['VX-002', 'VX-003', 'VX-007', 'VX-008']);
  expect(['VX-002', 'VX-003', 'VX-007', 'VX-008'].map(id => getTraderVisual(id).highlight)).toEqual(['silver', 'copper', 'copper', 'gold']);
});
