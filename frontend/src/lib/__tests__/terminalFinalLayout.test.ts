import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('one persistent market list preserves its state; desktop has no collapse workflow', () => {
  const source = read('pages/TradePage.tsx');
  expect(source.match(/<PairListSidebar /g)).toHaveLength(1);
  expect(source).toContain('<PairListSidebar periodControls');
  expect(source).not.toContain('onCollapse=');
  expect(source).not.toMatch(/workspacePreset|applyWorkspace|market-commands|data-workspace|FlowDepth|FlowTape/);
  expect(source).toContain("if (!compactMarkets) { pairListRef.current?.focusSearch(); return; }");
  expect(source).toContain("event.key === '/' && !editing");
  expect(source).toContain("if (event.key === 'Tab' && selectorOpen)");
  expect(source).toContain('selectorReturnFocus.current?.focus()');
});

test('only Order and Book are reachable in the rail, and account tabs remain real', () => {
  const source = read('pages/TradePage.tsx');
  expect(source).toContain("useState<'order' | 'book'>('order')");
  expect(source).not.toMatch(/id: 'depth'|id: 'tape'|railTab !== 'depth'|railTab !== 'tape'/);
  expect(source).toContain("type BottomTab = 'open' | 'orderHistory' | 'assets'");
  for (const component of ['OpenOrdersPanel', 'OrderHistoryPanel', 'AssetsPanel']) expect(source).toContain(`<${component} `);
  expect(source).toContain('onCount={setOpenOrderCount}');
  expect(source).toContain('openOrdersRef.current?.cancelAll()');
});

test('desktop is a three-column workspace with a compact full-width dock', () => {
  const css = read('pages/trade-terminal/TerminalPremium.css');
  expect(css).toContain('--premium-markets-width: clamp(220px, 17vw, 256px)');
  expect(css).toContain('grid-template-columns: var(--premium-markets-width) minmax(0, 1fr) var(--premium-rail-width)');
  expect(css).toMatch(/\.trading-dock \{ grid-column: 1 \/ -1; grid-row: 2;[^}]+height: 180px/);
  expect(css).toContain('.markets-panel.is-open { display: flex; position: fixed;');
  expect(css).not.toContain('.workspace-controls');
});

// Frozen ad8ce768 implementation: refinements must not replace chart tools,
// account execution/table logic, real feeds, or Copy Trading math/presentation.
test.each(Object.entries({
  'components/OrderForm.tsx': 'a5945f2caf7e32df17da386d0be52320de3d27ea392c45cf184c51ce71b6cc9b',
  'components/OpenOrdersPanel.tsx': '43e99613c37ade76f1b53e530d1ac4a388e9cd227dd040d2b1309ce6bc148042',
  'components/OrderHistoryPanel.tsx': '2db07eb0d3fab3cfdaa083f33c2f466f1fd5a6de23ac2cdb53c70a339595a334',
  'components/AssetsPanel.tsx': '92981a8f63ae12cb7e20d8f08eec207bad2c0f72480157c4ffa310cecc7171a0',
  'pages/copy-trading-bolt/components.tsx': '6454a338edf6dc56357f5b1e4a2fb28aa90a07d8c64d68cf45250f1cef2b8b35',
  'lib/syntheticCopyTrading.ts': 'f7f9664a0630d3eda53a2ca6ba61c1a20613fb2991d57ae0a5ecc53ed27ca4ea',
  'lib/reviewMarketData.ts': 'f0c6c4936eb0d60d4ab63b65f0f3a4e617ba5dd9cb8e0e7a2c83b53fbb29f197',
  'lib/krakenSocket.ts': 'a78c8a52a38752a91ea20282a25c88a29e35ff355c14505584c7d88ad3715dc3',
}))('%s is preserved exactly', (file, expected) => {
  expect(createHash('sha256').update(read(file)).digest('hex')).toBe(expected);
});

test('chart implementation is unchanged except the explicit stale-market transition guard', () => {
  const source = read('components/PriceChart.tsx');
  const original = source
    .replace("className={premium ? 'spot-chart-empty' : undefined} ", '')
    .replace(/    \/\/ Spot transition guard:[\s\S]*?    \/\/ End Spot transition guard\.\n/, '')
    .replace('        // Initial Spot failure keeps the existing no-data state, not another\n        // pair\'s candles. A same-market background poll keeps last-known data.',
      '        // Chart just stays empty on failure — not worth a full error state\n        // for a background poll.');
  expect(createHash('sha256').update(original).digest('hex')).toBe('001287cfae14c5137adf2811a3817cf6fc80b07c43ff2e204db184a4a19b8d2b');
  expect(read('pages/trade-terminal/TerminalPremium.css')).toContain('.spot-chart-empty { z-index: 5; background: var(--chart-bg); }');
});

test('actual transition guard clears every Spot series; Futures/default remain untouched', () => {
  const source = read('components/PriceChart.tsx');
  const guard = source.match(/    \/\/ Spot transition guard:[\s\S]*?    \/\/ End Spot transition guard\./)![0];
  const refs = ['seriesRef', 'volumeSeriesRef', 'lineSeriesRef', 'areaSeriesRef', 'maSeriesRef', 'bollUpperRef', 'bollMiddleRef', 'bollLowerRef', 'rsiSeriesRef', 'macdLineRef', 'macdSignalRef', 'macdHistRef'];
  const run = new Function('premium', 'candlesRef', 'setEmpty', ...refs, guard);
  const series = refs.map(() => ({ current: { setData: jest.fn() } }));
  const candles = { current: [{ close: 2500 }] };
  const empty = jest.fn();
  run(false, candles, empty, ...series);
  expect(candles.current).toHaveLength(1);
  expect(empty).not.toHaveBeenCalled();
  run(true, candles, empty, ...series);
  expect(candles.current).toEqual([]);
  for (const ref of series) expect(ref.current.setData).toHaveBeenCalledWith([]);
  expect(empty).toHaveBeenCalledWith(true);
});
