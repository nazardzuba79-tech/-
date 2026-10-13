import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The Spot/CFD bundle does NOT import FuturesMobile.css. Its mobile-only
 * "•••" chart button must therefore have a desktop default here.
 * Futures owns its own styling; this regression only checks Spot/CFD.
 */
const css = readFileSync(resolve(__dirname, '../../pages/trade-terminal/TerminalMobileParity.css'), 'utf8');

test('Spot and CFD hide the mobile-only overflow toggle at desktop widths', () => {
  const desktop = css.slice(0, css.indexOf('@media (max-width:900px)'));
  expect(desktop).toMatch(/\.trade-terminal\.vx-terminal\s+\.chart-toolbar\s+\.futures-mobile-tools-toggle\s*\{\s*display:\s*none\s*;/);
});

test('Spot and CFD keep the indicator overflow control at mobile widths', () => {
  const mobile = css.slice(css.indexOf('@media (max-width:900px)'));
  expect(mobile).toMatch(/\.chart-toolbar\s+\.futures-mobile-tools-toggle\s*\{\s*display:\s*block\s*;/);
});

test('the desktop default does not change data paths or affect Futures CSS', () => {
  const page = readFileSync(resolve(__dirname, '../../pages/TradePage.tsx'), 'utf8');
  expect(page).toContain("import './trade-terminal/TerminalMobileParity.css'");
  expect(page).not.toContain("import './trade-terminal/FuturesMobile.css'");
});
