import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The owner, 2026-09-23: «текст дальше налазить один на одне» — the positions
 * table wrapped «Цена / Входа», «Цена / маркировки», «Цена / ликвид.» onto two
 * lines beside one-line titles. Every heading now stays on one line; the row
 * scrolls under the pinned columns instead (measured: fits 1274px at a 1600
 * viewport, scrolls at 1440).
 */
const css = readFileSync(resolve(__dirname, '../../pages/trade-terminal/ArchiveTerminalPreview.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const RU = readFileSync(resolve(__dirname, '../i18n/locales/ru.ts'), 'utf8');

describe('positions table headings stay on one line', () => {
  it('no rule lets a positions heading wrap', () => {
    expect(css).not.toMatch(/futures-positions-table th[^{]*\{[^}]*white-space:\s*normal/);
  });
  it('keeps the tightened heading metrics that make the row fit at 1600', () => {
    expect(css).toContain('#archive-terminal-preview .futures-positions-table :is(th,td) { width:auto; padding:8px 5px; padding-inline:5px !important;');
    expect(css).toMatch(/\.futures-positions-table th \{[^}]*font-size:11px/);
    expect(RU).toContain("'futures.colMark': 'Цена марк.',");
  });
});
