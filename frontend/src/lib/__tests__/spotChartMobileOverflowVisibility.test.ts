import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Spot/CFD do not import FuturesMobile.css. The mobile-only chart
 * indicators overflow key must be hidden on DESKTOP by the desktop
 * stylesheet; the existing mobile stylesheet must stay mobile-only.
 */
const desktopCss = readFileSync(resolve(__dirname, '../../pages/trade-terminal/SpotCfdParity.css'), 'utf8');
const mobileCss = readFileSync(resolve(__dirname, '../../pages/trade-terminal/TerminalMobileParity.css'), 'utf8');

test('Spot and CFD hide their mobile overflow key at desktop widths only', () => {
  const postcss = require('postcss');
  const css = postcss.parse(desktopCss);
  const matches: any[] = [];
  css.walkRules((rule: any) => {
    if (rule.selector === '.trade-terminal.vx-terminal:is(.spot-terminal,.cfd-terminal) .chart-toolbar .futures-mobile-tools-toggle') {
      matches.push(rule);
    }
  });
  expect(matches).toHaveLength(1);
  expect(matches[0].parent.name).toBe('media');
  expect(matches[0].parent.params).toBe('(min-width:901px)');
  expect(matches[0].nodes.some((d: any) => d.prop === 'display' && d.value === 'none')).toBe(true);
});

test('mobile stylesheet remains mobile-only and displays the overflow key on phones', () => {
  const postcss = require('postcss');
  const css = postcss.parse(mobileCss);
  const matches: any[] = [];
  css.walkRules((rule: any) => {
    if (rule.selector?.includes('.futures-mobile-tools-toggle')) matches.push(rule);
  });
  expect(matches).toHaveLength(1);
  expect(matches[0].parent.name).toBe('media');
  expect(matches[0].parent.params).toBe('(max-width:900px)');
  expect(matches[0].nodes.some((d: any) => d.prop === 'display' && d.value === 'block')).toBe(true);
});

test('Spot imports both styles without importing the Futures stylesheet', () => {
  const page = readFileSync(resolve(__dirname, '../../pages/TradePage.tsx'), 'utf8');
  expect(page).toContain("import './trade-terminal/TerminalMobileParity.css'");
  expect(page).toContain("import './trade-terminal/SpotCfdParity.css'");
  expect(page).not.toContain("import './trade-terminal/FuturesMobile.css'");
});
