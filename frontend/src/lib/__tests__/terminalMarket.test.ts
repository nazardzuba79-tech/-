import fs from 'node:fs';
import path from 'node:path';
import { terminalBookMetrics, workspacePreset } from '../terminalMarket';

test('spine and flow share actual ungrouped spread and observed depth', () => {
  const m = terminalBookMetrics([{ price: '99', quantity: '2' }, { price: '100', quantity: '3' }], [{ price: '100.2', quantity: '4' }, { price: '105', quantity: '8' }]);
  expect(m.bestBid).toBe(100); expect(m.bestAsk).toBe(100.2);
  expect(m.spread).toBeCloseTo(.2); expect(m.spreadPercent).toBeCloseTo(.2 /100.1*100);
  expect(m.bidNotional).toBe(300); expect(m.askNotional).toBeCloseTo(400.8); expect(m.depth).toBeCloseTo(700.8);
});
test('missing/crossed/invalid books are unavailable rather than fake zero-quality metrics', () => {
  for (const m of [terminalBookMetrics([], []), terminalBookMetrics([{ price: 'NaN', quantity: '5' }], []), terminalBookMetrics([{ price: '12', quantity: '1' }], [{ price: '11', quantity: '2' }])]) {
    expect(m.spread).toBeNull(); expect(m.depth).toBeNull(); expect(m.bidShare).toBeNull();
  }
});
test('liquidity ratios include only positive finite observed levels', () => {
  const m = terminalBookMetrics([{ price: '1', quantity: '-4' }, { price: '1', quantity: '2' }], [{ price: '1', quantity: '2' }]);
  expect(m.depth).toBe(4); expect(m.bidShare).toBe(.5);
});
test('workspace commands actually reconfigure rail and dock', () => {
  expect(workspacePreset('chart')).toEqual({ railCollapsed: true, dockOpen: false, railTab: 'order' });
  expect(workspacePreset('flow')).toEqual({ railCollapsed: false, dockOpen: true, railTab: 'book' });
  expect(workspacePreset('standard')).toEqual({ railCollapsed: false, dockOpen: true, railTab: 'order' });
});
test('spine contains no duplicate bid/ask labels, financial constants or archive generators', () => {
  const root = path.resolve(__dirname, '../../pages/trade-terminal');
  const spine = fs.readFileSync(path.join(root, 'MarketSpine.tsx'), 'utf8');
  expect(spine).not.toMatch(/Best\s*(Bid|Ask)|Лучший\s*(бид|аск)|book\.best(Bid|Ask)/i);
  expect(spine).not.toMatch(/generate(Candles|OrderBook|Trades)|Math\.random|price\s*\*\s*1\.031/);
  expect(spine).toContain('api.getExternalTicker(pair)'); expect(spine).toContain('terminalBookMetrics');
  expect(spine).toContain("t('trade.spread')");
  const flow = fs.readFileSync(path.join(root, 'FlowContext.tsx'), 'utf8');
  expect(flow).toContain('Best bid'); expect(flow).toContain('Best ask');
});
test('entry and hover props reach the chart; one real order form stays mounted across rail tabs', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../pages/TradePage.tsx'), 'utf8');
  expect(page).toContain('onDraftChange={setDraft}'); expect(page).toContain('guidePrice={guidePrice}');
  expect(page).toContain('onHoverPrice={setGuidePrice}'); expect(page).toContain('draft={draft?.pair === pair ? draft : null}');
  expect(page.match(/<OrderForm /g)).toHaveLength(1);
  expect(page).toContain("hidden={railCollapsed || railTab !== 'order'}");
});

test('market polling retains post-connect fallback and guards late replies', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../pages/TradePage.tsx'), 'utf8');
  const flow = fs.readFileSync(path.resolve(__dirname, '../../pages/trade-terminal/FlowContext.tsx'), 'utf8');
  const spine = fs.readFileSync(path.resolve(__dirname, '../../pages/trade-terminal/MarketSpine.tsx'), 'utf8');
  expect(page).toContain("krakenSocket.getStatus() !== 'connected' || Date.now() - lastWsAt");
  expect(page).toContain('bookVersion.current === version');
  expect(flow).toContain("if (status !== 'connected') received = false");
  expect(flow).toContain('active && version === requestedVersion');
  // Serialized quote reads cannot regress to an older request or starve
  // updates when a valid response takes longer than the polling period.
  expect(spine).toContain('if (pending) return');
  expect(spine).toContain('finally(() => { pending = false; })');
});
