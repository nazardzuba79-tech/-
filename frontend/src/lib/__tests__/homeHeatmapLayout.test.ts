import { heatmapLayout, HeatTile } from '../../pages/home/homeHeatmapLayout';

const quote = (pair: string, volume: number, change = 1) => ({
  pair, base: pair.split('/')[0], quote: pair.split('/')[1],
  price: 123.45, change, quoteVolume: volume, high: 130, low: 120,
});
const area = (tile: HeatTile) => tile.width * tile.height;

function expectTiling(tiles: HeatTile[]) {
  expect(tiles.reduce((total, tile) => total + area(tile), 0)).toBeCloseTo(10_000, 7);
  for (const tile of tiles) {
    expect(tile.width).toBeGreaterThan(0);
    expect(tile.height).toBeGreaterThan(0);
    expect(tile.x).toBeGreaterThanOrEqual(0);
    expect(tile.y).toBeGreaterThanOrEqual(0);
    expect(tile.x + tile.width).toBeLessThanOrEqual(100 + 1e-10);
    expect(tile.y + tile.height).toBeLessThanOrEqual(100 + 1e-10);
  }
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    const a = tiles[i], b = tiles[j];
    const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    expect(overlapX * overlapY).toBeCloseTo(0, 7);
  }
}

test('tile areas equal each selected market’s actual turnover share, without overlap or gaps', () => {
  const rows = [quote('BTC/USDT', 60), quote('ETH/USDT', 25), quote('SOL/USDT', 10), quote('XRP/USDT', 5)];
  const { tiles, volumeWeighted } = heatmapLayout(rows);
  expect(volumeWeighted).toBe(true);
  expectTiling(tiles);
  for (const tile of tiles) expect(area(tile) / 10_000).toBeCloseTo(tile.ticker.quoteVolume / 100, 10);
});

test('selection uses real positive volume and exact tie order without mutating input records', () => {
  const rows = Object.freeze([quote('SOL/USDT', 20), quote('BTC/USDT', 20), quote('ETH/USDT', 40), quote('XRP/USDT', 0)]);
  const before = JSON.stringify(rows);
  const { tiles } = heatmapLayout(rows as any, 2);
  expect(tiles.map(tile => tile.ticker.pair)).toEqual(['ETH/USDT', 'BTC/USDT']);
  expect(tiles[0].ticker).toBe(rows[2]);
  expect(area(tiles[0]) / area(tiles[1])).toBeCloseTo(2, 10);
  expect(JSON.stringify(rows)).toBe(before);
});

test('with no volume data, equal tiles honestly show change instead of manufacturing weights', () => {
  const rows = [quote('BTC/USDT', NaN, -1), quote('ETH/USDT', 0, 3), quote('SOL/USDT', -1, -3)];
  const { tiles, volumeWeighted } = heatmapLayout(rows);
  expect(volumeWeighted).toBe(false);
  expect(tiles.map(tile => tile.ticker.pair)).toEqual(['ETH/USDT', 'SOL/USDT', 'BTC/USDT']);
  expectTiling(tiles);
  for (const tile of tiles) expect(area(tile)).toBeCloseTo(10_000 / 3, 10);
});

test('unknown prices/changes, non-USDT quotes, and duplicate pairs cannot create fabricated tiles', () => {
  const first = quote('BTC/USDT', 3);
  const result = heatmapLayout([first, quote('BTC/USDT', 99), quote('BTC/EUR', 4),
    { ...quote('ETH/USDT', 3), price: 0 }, { ...quote('SOL/USDT', 3), price: Infinity }, quote('XRP/USDT', 3, NaN)]);
  expect(result.tiles).toHaveLength(1);
  expect(result.tiles[0].ticker).toBe(first);
  expect(area(result.tiles[0])).toBe(10_000);
  expect(heatmapLayout([]).tiles).toEqual([]);
  expect(heatmapLayout([first], 0).tiles).toEqual([]);
});

test('large finite turnovers and small legitimate shares keep their proportional areas', () => {
  const rows = [quote('BTC/USDT', Number.MAX_VALUE), quote('ETH/USDT', Number.MAX_VALUE / 2), quote('SOL/USDT', Number.MAX_VALUE / 100_000)];
  const { tiles } = heatmapLayout(rows);
  expectTiling(tiles);
  expect(area(tiles[0]) / area(tiles[1])).toBeCloseTo(2, 7);
  expect(area(tiles[0]) / area(tiles[2])).toBeCloseTo(100_000, 3);
});
