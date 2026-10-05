import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Spot/CFD mobile parity with Futures', () => {
  test('desktop stays untouched: parity layout rules exist only at mobile widths', () => {
    const postcss = require('postcss');
    const css = postcss.parse(read('frontend/src/pages/trade-terminal/TerminalMobileParity.css'));
    css.walkRules((rule: any) => {
      if (rule.parent.type === 'root') {
        expect(rule.toString()).toMatch(/display:\s*none/);
        for (const selector of rule.selectors) expect(selector).toMatch(/terminal-mobile-/);
        return;
      }
      expect(rule.parent.name).toBe('media');
      expect(rule.parent.params).toMatch(/^\(max-width:(900|359)px\)$/);
      for (const selector of rule.selectors) expect(selector).toContain('.trade-terminal');
    });
  });

  test('Spot has Futures-style Chart / Trade / Account workspaces without changing order logic', () => {
    const page = read('frontend/src/pages/TradePage.tsx');
    // A tradable pair opens on Trade (owner, 2026-10-04); an upcoming listing
    // (countdown card), a display-only test market and CFD stay chart-first.
    expect(page).toContain("const [mobileTabChoice, setMobileTab] = useState<'chart' | 'trade' | 'account' | null>(null)");
    expect(page).toContain("const prelisting = testPair && testMarket.asset?.state.phase !== 'live';");
    expect(page).toContain("const displayOnly = testPair && testMarket.asset?.isTradable === false;");
    expect(page).toContain("const mobileTab = mobileTabChoice ?? (marketType === 'cfd' || prelisting || displayOnly ? 'chart' : 'trade');");
    expect(page).toContain("const [mobilePane, setMobilePane] = useState<'chart' | 'book' | 'markets'>('chart')");
    expect(page).toContain('data-mobile-market="spot"');
    expect(page).toContain("setMobilePane('book')");
    expect(page).toContain("setMobilePane('markets')");
    expect(page).toContain("const selectSpotPair = useCallback((nextPair: string) => {");
    expect(page).toContain("setMobileTab('trade')");
    expect(page).toContain("params.set('pair', nextPair)");
    expect(page).toContain('onChange={selectSpotPair}');
    expect(page).toContain('<OrderForm key={pair} pair={pair} onPlaced={handleOrderPlaced}');
    expect(page).toContain('<OrderBookPanel');
  });

  test('CFD keeps its no-order-book architecture while gaining mobile Chart / Trade / Account', () => {
    const page = read('frontend/src/pages/TradePage.tsx');
    const cfdStart = page.indexOf('// CFD uses the same shell');
    const spotStart = page.indexOf('<div className="trade-terminal spot-terminal', cfdStart);
    const cfd = page.slice(cfdStart, spotStart);
    expect(cfd).toContain('data-mobile-market="cfd"');
    expect(cfd).toContain('<CfdInstrumentList');
    expect(cfd).toContain('<CfdChart');
    expect(cfd).toContain('<CfdOrderForm');
    expect(cfd).toContain('<CfdPositionsPanel');
    expect(cfd).not.toContain('<OrderBookPanel');
  });

  test('mobile workspaces preserve mounted DOM and use CSS visibility instead of duplicating trade components', () => {
    const page = read('frontend/src/pages/TradePage.tsx');
    expect((page.match(/<OrderForm\b/g) ?? []).length).toBe(1);
    expect((page.match(/<CfdOrderForm\b/g) ?? []).length).toBe(1);
    expect((page.match(/<OrderBookPanel\b/g) ?? []).length).toBe(1);

    const css = read('frontend/src/pages/trade-terminal/TerminalMobileParity.css');
    const compact = read('frontend/src/pages/trade-terminal/SpotMobileCompact.css');
    expect(css).toContain('.terminal[data-mobile-tab=trade]');
    expect(compact).toContain('.terminal[data-mobile-tab=trade] .main-grid');
    // Book left (~40%), ticket right (~60%), as on the owner's references.
    expect(compact).toContain('grid-template-columns:minmax(0,40fr) minmax(0,60fr)');
    expect(compact).toContain('.orderbook-col-headers .ob-col:last-child');
    expect(compact).toContain('.info-section');
    expect(compact).toContain('display:none');
    expect(css).toContain('.terminal[data-mobile-tab=account]');
    expect(css).toContain('[data-mobile-pane=book]');
    expect(css).toContain('[data-mobile-pane=markets]');
  });

  test('mobile controls inherit the approved Futures touch target sizes', () => {
    const css = read('frontend/src/pages/trade-terminal/TerminalMobileParity.css');
    expect(css).toContain('min-height:48px');
    expect(css).toContain('min-height:44px');
    expect(css).toContain('min-height:52px');
    expect(css).toContain('font-size:16px !important');
    expect(css).toContain('height:clamp(360px,59dvh,600px)');
    expect(css).toContain('display:none !important');
    expect(css).toContain('display:flex !important');
    expect(css).toContain('.cfd-market-state { display:none !important; }');
  });
});
