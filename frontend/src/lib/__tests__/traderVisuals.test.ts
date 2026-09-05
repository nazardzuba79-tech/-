import { getTraderVisual } from '../../pages/copy-trading-bolt/traderVisuals';

const catalogueIds = Array.from({ length: 30 }, (_, index) => `VX-${String(index + 2).padStart(3, '0')}`);

test('operator upload and unknown accounts are never replaced with demo artwork', () => {
  expect(getTraderVisual('VX-001')).toEqual({});
  expect(getTraderVisual('new-server-account')).toEqual({});
  expect(getTraderVisual('toString')).toEqual({});
  expect(getTraderVisual('__proto__')).toEqual({});
});

test('every existing fictional alias has stable decorative art, without account claims', () => {
  for (const id of catalogueIds) {
    const visual = getTraderVisual(id);
    expect(getTraderVisual(id)).toEqual(visual);
    expect(Boolean(visual.mark) !== Boolean(visual.avatarSrc)).toBe(true);
    expect(visual.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(visual).every(key => ['mark', 'avatarSrc', 'initials', 'accent', 'background', 'highlight'].includes(key))).toBe(true);
  }
  expect(new Set(catalogueIds.map(id => getTraderVisual(id).mark).filter(Boolean)).size).toBeGreaterThanOrEqual(20);
});

test('generated mascots and fictional portraits map uniquely to their intended aliases', () => {
  const expected = {
    'VX-004': '/copy-trading/avatars/sakura-quant.webp',
    'VX-005': '/copy-trading/avatars/seoul-sigma.webp',
    'VX-007': '/copy-trading/avatars/moon-rabbit.webp',
    'VX-010': '/copy-trading/avatars/panda-block.webp',
  };
  const images = catalogueIds.filter(id => getTraderVisual(id).avatarSrc);
  expect(images).toEqual(Object.keys(expected));
  for (const [id, path] of Object.entries(expected)) expect(getTraderVisual(id).avatarSrc).toBe(path);
  expect(new Set(images.map(id => getTraderVisual(id).avatarSrc)).size).toBe(4);
});

test('restrained highlights decorate only the four chosen catalogue cards', () => {
  expect(catalogueIds.filter(id => getTraderVisual(id).highlight))
    .toEqual(['VX-002', 'VX-003', 'VX-007', 'VX-008']);
  expect(getTraderVisual('VX-002').highlight).toBe('silver');
  expect(getTraderVisual('VX-003').highlight).toBe('copper');
  expect(getTraderVisual('VX-007').highlight).toBe('copper');
  expect(getTraderVisual('VX-008').highlight).toBe('gold');
});
