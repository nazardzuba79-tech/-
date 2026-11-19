import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LANDING_COPY, type LandingCopy } from '../landingCopy';

/**
 * The landing candidate's own copy, held to the writing rules of
 * .claude/skills/landing-page-design (Part B8) and to the product's language
 * policy. The rendered page is measured in a browser by scripts/qa-landing-page.cjs.
 */
const LANGS = ['ru', 'en', 'es', 'zh', 'hi', 'ja', 'ko'] as const;
const landing = resolve(__dirname, '..');
const source = (file: string) => readFileSync(resolve(landing, file), 'utf8');

/** Every string of one language, with the path it sits at. */
function strings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((entry, i) => strings(entry, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => strings(entry, path ? `${path}.${key}` : key));
  return [];
}
const shape = (copy: LandingCopy) => strings(copy).map(([path]) => path).sort();

test('the copy exists in exactly the seven product languages, and Ukrainian is not one of them', () => {
  expect(Object.keys(LANDING_COPY).sort()).toEqual([...LANGS].sort());
  expect(Object.keys(LANDING_COPY)).not.toContain('uk');
});

test('every language has the same fields, none of them empty', () => {
  const reference = shape(LANDING_COPY.ru);
  for (const lang of LANGS) {
    expect(shape(LANDING_COPY[lang])).toEqual(reference);
    for (const [path, text] of strings(LANDING_COPY[lang])) expect([lang, path, text.trim().length > 0]).toEqual([lang, path, true]);
  }
});

test('the offer is written as three lines, with four benefits and three steps', () => {
  for (const lang of LANGS) {
    const copy = LANDING_COPY[lang];
    expect(copy.heroTitle).toHaveLength(3);
    expect(copy.benefits).toHaveLength(4);
    expect(copy.steps).toHaveLength(3);
  }
});

test('no hyphen or dash is used in the copy, and no exclamation mark', () => {
  for (const lang of LANGS) for (const [path, text] of strings(LANDING_COPY[lang])) {
    // TP/SL and Crypto Card are product names; neither carries a hyphen.
    expect([lang, path, /[-‐-―−]/.test(text)]).toEqual([lang, path, false]);
    expect([lang, path, /[!！]/.test(text)]).toEqual([lang, path, false]);
  }
});

test('the only number promised is the count of listed markets, filled in from live data', () => {
  for (const lang of LANGS) {
    const copy = LANDING_COPY[lang];
    expect(copy.proof).toContain('{n}');
    for (const [path, text] of strings(copy)) {
      if (path === 'proof') continue;
      // «24» (round the clock), «7» (the seven interface languages) and the hero line «1つの» are the only figures;
      // there is no volume, user count, percentage, fee or yield anywhere in the copy.
      const figures = (text.match(/\d+(?:[.,]\d+)?\s*%?/g) ?? []).map(figure => figure.trim());
      expect([lang, path, figures.filter(figure => !['24', '7', '1'].includes(figure))]).toEqual([lang, path, []]);
    }
  }
});

test('filler and hype words are kept out of the English and Russian copy', () => {
  const banned = /\b(seamless|revolutionary|cutting[ -]edge|world[ -]class|best in class|unlock|supercharge|next[ -]generation|guaranteed?|risk[ -]free)\b|лучш(ая|ий|ие) в мире|гарантир|без риска|революцион|уникальн/i;
  for (const lang of ['en', 'ru'] as const) for (const [path, text] of strings(LANDING_COPY[lang])) expect([lang, path, banned.test(text)]).toEqual([lang, path, false]);
});

test('sentence case: English headings do not capitalise every word', () => {
  const copy = LANDING_COPY.en;
  for (const heading of [copy.heroTitle.join(' '), copy.benefitsTitle, copy.stepsTitle, copy.finalTitle, ...copy.benefits.map(b => b.title), ...copy.steps.map(s => s.title)]) {
    const words = heading.split(/\s+/).slice(1).filter(word => !/^(VOLTEX|Crypto|Card|TP\/SL)/.test(word));
    expect([heading, words.some(word => /^[A-Z]/.test(word))]).toEqual([heading, false]);
  }
});

test('the page keeps the visual rules in its stylesheet: one typeface, one curve, no italic, no background gradient, tokens only', () => {
  const css = source('landing.css');
  expect(css).not.toMatch(/font-style:\s*italic/);
  expect(css.match(/font-family:\s*([^;]+);/g)?.filter(rule => !/inherit/.test(rule))).toEqual(["font-family: 'Manrope', system-ui, sans-serif;"]);
  expect(css).toContain('--ease: cubic-bezier(0.22, 1, 0.36, 1)');
  // Every transition and animation names its curve through the one token; no keyword easing is left.
  const timed = css.match(/(?:transition|animation):\s*[^;]+;/g) ?? [];
  expect(timed.length).toBeGreaterThan(10);
  for (const rule of timed) {
    if (/:\s*none;/.test(rule)) continue;
    expect([rule, /var\(--ease\)/.test(rule), /\b(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)\b(?!\))/.test(rule.replace(/var\(--ease\)/g, ''))]).toEqual([rule, true, false]);
  }
  // The one gradient is the hero heading's text, white to #9B9B9B.
  expect(css.match(/gradient\(/g)).toHaveLength(1);
  expect(css).toMatch(/\.vxl-hero-title[^}]*linear-gradient\([^)]*#FFFFFF[^)]*#9B9B9B/i);
  expect(css).not.toMatch(/font-weight:\s*(800|900|bolder)/);
  // Every selector stays inside the page's own root, so nothing leaks into the exchange.
  const outside = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(block => block.split('{')[0].trim()).filter(selector => selector && !selector.startsWith('@') && !/^(from|to|\d+%)/.test(selector))
    .flatMap(selector => selector.split(/,(?![^()]*\))/).map(part => part.trim())).filter(part => part && !part.startsWith('.vxl'));
  expect(outside).toEqual([]);
});

test('the candidate lives on its own unlisted address and leaves the approved home page where it is', () => {
  const app = readFileSync(resolve(landing, '../../App.tsx'), 'utf8');
  expect(app).toContain('<Route path="/home-preview" element={<LandingPage />} />');
  expect(app).toMatch(/<Route path="\/" element=\{<(?!LandingPage)/);
  expect(readFileSync(resolve(landing, '../../lib/seo/site.ts'), 'utf8')).toContain("'/home-preview'");
  expect(readFileSync(resolve(landing, '../../../public/_headers'), 'utf8')).toMatch(/\/home-preview\n\s+X-Robots-Tag: noindex, nofollow/);
  const page = source('LandingPage.tsx');
  // One action, the same at the top and at the bottom; no market or account write from this page.
  expect(page).not.toMatch(/\bfetch\(|api\.(post|put|patch|delete)\b/);
  expect(page).toContain("to: '/register'");
});
