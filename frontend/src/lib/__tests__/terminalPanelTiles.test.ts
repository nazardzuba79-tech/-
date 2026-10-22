import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * PANELS AS TILES, ON A DARKER GROUND — the owner's «розділення цих панелей
 * чуть дешеві» and «три версії чорнішого» (2026-09-30). One sheet, one
 * import: taking it back is deleting the import. The tone is four tokens,
 * read off the owner's Bybit screenshot.
 */
const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const css = read('frontend/src/pages/trade-terminal/TerminalPanelTiles.css');

it('is one sheet, imported last', () => {
  const order = [...read('frontend/src/pages/FuturesPage.tsx').matchAll(/import '\.\/trade-terminal\/(\w+)\.css';/g)].map(m => m[1]);
  expect(order[order.length - 1]).toBe('TerminalPanelTiles');
});

it('carries the tone as four tokens: Bybit\'s #101014 tiles on #000000, header #17181f', () => {
  expect(css).toContain('--tile-ground:#000000;');
  expect(css).toContain('--tile-fill:#101014;');
  expect(css).toContain('--tile-header:#17181f;');
  expect(css).toContain('--tile-bottom:#101014;');
  expect(css).toContain('#archive-terminal-preview .global-header { background:var(--tile-header); --bg:var(--tile-header); }');
  expect(css).toContain('#archive-terminal-preview .bottom-panel { --panel:var(--tile-bottom); }');
});

it('tiles only on a desktop: 6px corners, 4px apart on the ground', () => {
  const desktop = css.slice(css.indexOf('@media (min-width:901px) {'));
  expect(desktop).toContain('#archive-terminal-preview .terminal { padding:4px; gap:4px; background:var(--tile-ground); }');
  expect(desktop).toContain('background:var(--tile-fill) fixed !important;');
  expect(desktop).toContain('border:0 !important; border-radius:6px;');
  // The phone keeps its own layout and only takes the tone.
  const phone = css.slice(0, css.indexOf('@media (min-width:901px) {'));
  expect(phone).not.toMatch(/border-radius|gap:/);
});
