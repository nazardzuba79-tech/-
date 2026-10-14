import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 2026-10-13 audit: on a 1025–1365px desktop (a 1280×720 laptop, or 1366px at
 * 110–125 % zoom) the Spot grid kept all four columns and the chart plot came
 * out 126–316px wide. The market list now starts folded there — the same
 * «Рынки» restore key the user already has brings it back — and nothing
 * changes at 1366px and above or in the stacked ≤1024px layout.
 */
const page = readFileSync(resolve(__dirname, '../../pages/TradePage.tsx'), 'utf8');

test('the market list starts folded only on 1025–1365px desktops', () => {
  expect(page).toContain("const NARROW_DESKTOP_QUERY = '(min-width: 1025px) and (max-width: 1365px)';");
  expect(page).toContain('window.matchMedia(NARROW_DESKTOP_QUERY).matches');
  // zoom/resize across the edge folds or unfolds the list too
  expect(page).toContain("narrow.addEventListener('change', onChange);");
  expect(page).toContain('const onChange = (event: MediaQueryListEvent) => setMarketPanelCollapsed(event.matches);');
  expect(page).toContain('useState(() => startsWithMarketListFolded())');
  expect(page).toContain("if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;");
});

test('the CFD three-column grid is scoped to 1025px and above, so the tablet stack keeps its two columns', () => {
  const css = readFileSync(resolve(__dirname, '../../pages/trade-terminal/SpotCfdParity.css'), 'utf8');
  const scoped = css.match(/@media \(min-width:1025px\) \{\s*:is\(#archive-terminal-preview,\.vx-terminal\)\.trade-terminal\.vx-terminal\.cfd-terminal \.cfd-workspace \{ grid-template-columns:278px minmax\(0,1fr\) 300px; \}\s*\}/);
  expect(scoped).not.toBeNull();
  // and no unscoped copy of that column rule remains
  const unscoped = css.replace(scoped![0], '').match(/\.cfd-terminal \.cfd-workspace \{[^}]*grid-template-columns:278px/);
  expect(unscoped).toBeNull();
});
