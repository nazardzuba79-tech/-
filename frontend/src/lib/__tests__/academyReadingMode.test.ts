import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Academy and Help are always a light «book» (owner's decision, 2026-10-01):
 * page #F7F1E8, article sheet #FFFBF4, text #292723, gold accents; a serif
 * column of 17–18 px at a line height of about 1.7. A dark site, browser or
 * OS theme never turns them dark, and the shared header and footer keep the
 * site's dark tokens, which this stylesheet never redefines.
 */
const css = readFileSync(resolve(__dirname, '../../pages/knowledge/knowledge.css'), 'utf8');
const rule = (selector: string) => {
  const match = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([\\s\\S]*?)\\n?\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
};
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
const token = (name: string) => new RegExp(`--${name}: (#[0-9a-f]{6})`).exec(css)?.[1];

test('the owner\'s colours: paper, article sheet, ink and gold', () => {
  expect(token('kb-paper')).toBe('#f7f1e8');
  expect(token('kb-sheet')).toBe('#fffbf4');
  expect(token('kb-ink-body')).toBe('#292723');
  expect(token('kb-gold')).toBe('#f0c964');
  expect(rule('.vx-kb-page')).toContain('background: var(--kb-paper);');
  expect(rule('.vx-kb')).toContain('color: var(--kb-ink-body);');
  expect(css).toMatch(/\.vx-kb-article,\n\.vx-kb-rules > \.vx-kb-prose,\n\.vx-kb-panel > \.vx-kb-prose \{\n {2}background: var\(--kb-sheet\);/);
});

test('no dark variant: a dark site, browser or OS theme leaves the pages light', () => {
  expect(code).not.toMatch(/prefers-color-scheme/);
  expect(code).not.toMatch(/data-theme/);
  expect(rule('.vx-kb-page')).toContain('color-scheme: only light;');
});

test('a book column: serif, 17–18 px, line height about 1.7, no wider than ~66 characters', () => {
  const prose = rule('.vx-kb-prose');
  expect(prose).toContain('font-family: var(--kb-serif);');
  const size = Number(/font-size: ([\d.]+)px/.exec(prose)![1]);
  expect(size).toBeGreaterThanOrEqual(17);
  expect(size).toBeLessThanOrEqual(18);
  const leading = Number(/line-height: ([\d.]+);/.exec(prose)![1]);
  expect(leading).toBeGreaterThanOrEqual(1.65);
  expect(leading).toBeLessThanOrEqual(1.75);
  expect(Number(/max-width: (\d+)ch/.exec(prose)![1])).toBeLessThanOrEqual(68);
});

test('form controls on paper take the ink, not the site\'s white input text or dark option list', () => {
  // index.css: `input:not([type='checkbox']):not([type='radio'])` sets white `color` and
  // -webkit-text-fill-color; `::placeholder` a grey-blue fill; `select option` a dark list.
  const search = rule('.vx-kb input.vx-kb-search,\n.vx-kb input.vx-kb-search:-webkit-autofill');
  expect(search).toContain('-webkit-text-fill-color: var(--kb-ink);');
  expect(search).toContain('color: var(--kb-ink);');
  expect(rule('.vx-kb input.vx-kb-search::placeholder')).toContain('-webkit-text-fill-color: var(--kb-ink-3);');
  expect(rule('.vx-kb select option')).toContain('color: var(--kb-ink);');
});

test('the site tokens are never redefined here, so the shared header and footer stay dark', () => {
  expect(css).not.toMatch(/^\s*--(bg|panel|panel-alt|border|text-primary|text-secondary|text-tertiary|accent)\s*:/m);
  expect(rule('.vx-kb-footer')).toContain('background: var(--bg);');
  // Links on the paper take the dark ink; the dark chrome keeps its own link colours.
  expect(css).not.toMatch(/\.vx-kb-page a \{/);
});
