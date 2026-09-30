import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * PANELS AS TILES — the proposal for «розділення цих панелей чуть дешеві»
 * (owner, 2026-09-30). One sheet, one import: taking it back is deleting the
 * import. Desktop only, and it keeps the approved gradient on the tiles.
 */
const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const css = read('frontend/src/pages/trade-terminal/TerminalPanelTiles.css');

it('is one sheet, imported last', () => {
  const order = [...read('frontend/src/pages/FuturesPage.tsx').matchAll(/import '\.\/trade-terminal\/(\w+)\.css';/g)].map(m => m[1]);
  expect(order[order.length - 1]).toBe('TerminalPanelTiles');
});

it('applies on a desktop only', () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  expect(body.startsWith('@media (min-width:901px) {')).toBe(true);
  expect(body.endsWith('}')).toBe(true);
});

it('stands 6px-cornered tiles 4px apart on a near-black ground, the gradient painted once across them', () => {
  expect(css).toContain('#archive-terminal-preview .terminal { padding:4px; gap:4px; background:var(--tile-ground); }');
  expect(css).toContain('--tile-ground:#060607;');
  expect(css).toContain('--tile-fill:linear-gradient(180deg, #1f2229 0%, #1b1d24 22%, #15161b 50%, #101014 74%, #08080a 100%);');
  // The same stops as the terminal's own gradient, so the tiles continue it.
  expect(read('frontend/src/pages/trade-terminal/ArchiveTerminalPreview.css'))
    .toContain('background: linear-gradient(180deg, #1f2229 0%, #1b1d24 22%, #15161b 50%, #101014 74%, #08080a 100%) !important;');
  expect(css).toContain('background:var(--tile-fill) fixed !important;');
  expect(css).toContain('border:0 !important; border-radius:6px;');
});
