import { readFileSync } from 'fs';
import { resolve } from 'path';
import postcss from 'postcss';

const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const css = read('frontend/src/pages/trade-terminal/SpotCfdGraphite.css');
const rules = postcss.parse(css);

it('only reaches Spot/CFD, never Futures or non-terminal pages', () => {
  rules.walkRules(rule => expect(rule.selector).toContain(':is(#archive-terminal-preview, .vx-terminal).vx-terminal'));
  const trade = read('frontend/src/pages/TradePage.tsx');
  expect(trade).toContain("import './trade-terminal/SpotCfdGraphite.css';");
  expect(read('frontend/src/pages/FuturesPage.tsx')).not.toContain('SpotCfdGraphite');
  rules.walkRules(rule => {
    if (!rule.selector.endsWith('.global-header')) return;
    // Audited header exception changes colour only, never shared geometry.
    rule.walkDecls(decl => expect(['background','--bg']).toContain(decl.prop));
  });
});

it('copies the released Futures font, tile palette and enabled action colours exactly', () => {
  const futures = ['TerminalGraphite','TerminalPanelTiles','ArchiveTerminalPreview']
    .map(name => read(`frontend/src/pages/trade-terminal/${name}.css`)).join('\n');
  for (const declaration of [
    "--font-family:'IBM Plex Sans Terminal','Inter Terminal',Inter,system-ui,sans-serif;",
    '--tile-ground:#000000;', '--tile-fill:#101014;', '--tile-header:#17181f;', '--tile-bottom:#101014;',
    'background:#232227 !important;', 'background:#1ead6a;', 'background:#ea4151;',
  ]) {
    expect(css).toContain(declaration);
    expect(futures).toContain(declaration);
  }
});

it('keeps market-specific tracks, visibility, click targets and data untouched', () => {
  rules.walkDecls(decl => {
    expect(decl.prop).not.toMatch(/^(display|visibility|pointer-events|content|position|grid-template.*|grid-area|order|width|height|min-height)$/);
  });
  expect(css).not.toMatch(/url\(|@keyframes/);
  expect(css).toContain(':not(:disabled)');
  expect(css).toContain(':focus-within');
  expect(css).toContain('[aria-invalid=true]');
  // CFD chart only consumes a font token, retaining its original fallback.
  expect(read('frontend/src/components/CfdChart.tsx')).toContain("fontFamily:token('--voltex-chart-font','Inter, Arial, sans-serif')");
});

it('adds desktop tile spacing without changing the mobile workspace layout', () => {
  const desktop = css.slice(css.indexOf('@media (min-width:901px)'));
  expect(desktop).toContain('padding:4px; gap:4px;');
  expect(desktop).toContain('border-radius:6px;');
  expect(css.slice(0, css.indexOf('@media (min-width:901px)'))).not.toMatch(/padding:|gap:/);
});
