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
    expect(page).toContain("const [mobileTab, setMobileTab] = useState<'chart' | 'trade' | 'account'>('chart')");
    expect(page).toContain("const [mobilePane, setMobilePane] = useState<'chart' | 'book' | 'markets'>('chart')");
    expect(page).toContain('data-mobile-market="spot"');
    expect(page).toContain("setMobilePane('book')");
    expect(page).toContain("setMobilePane('markets')");
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
    expect(css).toContain('.terminal[data-mobile-tab=trade]');
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
  });
});
