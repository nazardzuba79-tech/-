import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const postcss = require('postcss');
const prefix = '.trade-terminal.vx-terminal.spot-terminal .terminal[data-mobile-tab=trade]';

// CSS contract, supplementing (not replacing) the production-bundle browser
// matrix. The old trade-workspace hide selector has seven class/attribute
// components, so a six-component display:flex selector cannot override it.
describe('compact Spot book survives the earlier mobile cascade', () => {
  test('form and book use equally specific direct grid children and the same explicit row', () => {
    const oldCss = read('frontend/src/pages/trade-terminal/TerminalMobileParity.css');
    expect(oldCss).toContain(`${prefix} .main-grid > :not(.order-form-area)`);
    const css = postcss.parse(read('frontend/src/pages/trade-terminal/SpotMobileCompact.css'));
    for (const panel of ['order-form-area', 'orderbook-area']) {
      const matches: any[] = [];
      css.walkRules((rule: any) => {
        if (rule.selectors.includes(`${prefix} .main-grid > .${panel}`)) matches.push(rule);
      });
      expect(matches).toHaveLength(1);
      const rule = matches[0];
      expect(rule.parent.name).toBe('media');
      expect(rule.parent.params).toBe('(max-width:900px)');
      const declarations: Record<string, string> = {};
      rule.walkDecls((decl: any) => { declarations[decl.prop] = decl.value; });
      expect(declarations.display).toBe('flex');
      expect(declarations['grid-row']).toBe('1');
    }
    const page = read('frontend/src/pages/TradePage.tsx');
    expect(page.indexOf("import './trade-terminal/SpotMobileCompact.css'")).toBeGreaterThan(page.indexOf("import './trade-terminal/TerminalMobileParity.css'"));
  });

  test('all compact layout overrides are mobile-only and Spot-scoped', () => {
    const css = postcss.parse(read('frontend/src/pages/trade-terminal/SpotMobileCompact.css'));
    css.walkRules((rule: any) => {
      expect(rule.parent.name).toBe('media');
      expect(rule.parent.params).toMatch(/^\(max-width:(900|359)px\)$/);
      for (const selector of rule.selectors) expect(selector).toContain('.spot-terminal');
    });
  });
});
