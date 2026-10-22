import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The support panel is a clean white panel on every page (owner, 2026-10-01):
 * dark neutral text, grey hairlines, VOLTEX gold for actions. Typed text must
 * stay dark: index.css paints every text field with a white
 * -webkit-text-fill-color for the dark site, so the panel sets its own.
 */
const css = readFileSync(resolve(__dirname, '../../components/SupportWidget.css'), 'utf8');
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
const panel = /\n\.support-panel \{([\s\S]*?)\n\}/.exec(code)![1];

test('the panel is white in every theme', () => {
  expect(panel).toContain('--support-bg:#ffffff');
  expect(panel).toContain('--support-ink:#1e2329');
  expect(panel).toContain('background:var(--support-bg)');
  expect(panel).toContain('color-scheme:only light');
  expect(code).not.toMatch(/prefers-color-scheme|data-theme/);
  // none of the old dark surfaces survive
  expect(code).not.toMatch(/#181c22|#1b1f26|#22262e|#20252d|#30343d/i);
});

test('typed text, placeholders and autofill take the dark ink, not the site\'s white', () => {
  expect(code).toMatch(/\.support-panel \.support-composer textarea \{[^}]*-webkit-text-fill-color:var\(--support-ink\)/);
  expect(code).toMatch(/\.support-panel \.support-composer textarea::placeholder \{[^}]*-webkit-text-fill-color:var\(--support-muted\)/);
  expect(code).toMatch(/\.support-panel \.support-field :is\(input:not\(\[type=radio\]\),textarea\) \{[^}]*-webkit-text-fill-color:var\(--support-ink\)/);
  expect(code).toMatch(/:-webkit-autofill \{[^}]*-webkit-text-fill-color:var\(--support-ink\) !important/);
});

test('layout and terminal docking are untouched', () => {
  expect(panel).toContain('position:fixed; right:24px; bottom:86px; width:412px;');
  expect(code).toContain('body:has(.bottom-nav) .support-panel');
});
