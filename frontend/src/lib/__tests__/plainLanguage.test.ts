import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import { LOCALES, readLocale } from '../../../test-utils/i18nSource';

/**
 * The exchange is shown to people who are not building it. A screen that
 * names the WebSocket, the backend, the database, an env var or a fixture is
 * telling the reader about our plumbing instead of about their money — and
 * "demo", "sandbox" and "synthetic data" are worse, because a reader who
 * sees them on a screen that is in fact live draws the wrong conclusion.
 *
 * This guard is the standing version of a sweep done by hand once. It reads
 * the rendered copy — the seven dictionaries, and string/JSX text in the
 * components — and fails on the vocabulary below. It deliberately does NOT
 * look at identifiers, imports, types, CSS classes or comments: naming a
 * variable `nativeDemoApi` is fine. The dated owner-approved Copy ROI scenario
 * is explicitly simulated: its exact disclosure is required, not hidden.
 */

const root = resolve(__dirname, '../../../..');

/** Words that describe how the exchange is built rather than what it does. */
const PLUMBING = [
  /websocket/i, /веб-?сокет/i,
  /бэкенд|backend|фронтенд/i,
  /эндпоинт|endpoint/i,
  /база данных|в базе данных/i,
  /деплой|deployment/i,
  /синтетическ|synthetic data/i,
  /фикстур|fixture/i,
  /песочниц|sandbox/i,
  /демо|\bdemo\b/i,
  /симуляци|simulation/i,
  /заглушк|\bmock\b/i,
  /снапшот|снимк(ам|ов|и) /i,
  /захардкож|hardcoded/i,
  /\bstale\b/i,
  /server-side/i,
  /\bbcrypt\b/i,
];

/**
 * Only a dictionary value gets this one. A deploy-time variable's name on a
 * screen is a leak; the same shape inside a component is almost always an
 * order status or a colour constant that the reader never sees.
 */
const ENV_VAR_NAME = /[A-Z][A-Z0-9]{3,}_[A-Z0-9_]{3,}/;

/**
 * Two things stay, and both are deliberate.
 *
 * API keys are a product the user creates, uses and revokes on a settings
 * page of their own — the word is the feature's name, not a leak. The admin
 * console's test-balance section is staff-only and must keep saying plainly
 * that the funds it credits are not real; making that read like a normal
 * balance would be the dangerous edit, not the honest one.
 */
const ALLOWED = [
  /API[- ]?(key|ключ|кунж|कुंज|キー|키|密钥|клав)/i,
  /claves? API|API कुंज|API 密钥|APIキー|API 키/i,
  /Manage API keys|Управление API-ключами/i,
];

const allowed = (text: string) => ALLOWED.some((r) => r.test(text));

const demoNoticeFile = 'frontend/src/pages/copy-trading-bolt/DemoRoiContext.tsx';
// Only these exact disclosures in this one component are allowed. Neither
// the general vocabulary rules nor any other file receive an exemption.
const demoDisclosures = [
  ['Демо · симуляция', 'Не фактическая доходность. До 22.10.2026 00:00 UTC.'],
  ['Demo · simulated', 'Not actual returns. Until 22 Oct 2026 00:00 UTC.'],
  ['演示 · 模拟', '非实际收益。截止：2026年10月22日 00:00 UTC。'],
  ['Demo · simulación', 'No es rentabilidad real. Hasta 22 oct 2026 00:00 UTC.'],
  ['डेमो · सिमुलेटेड', 'वास्तविक रिटर्न नहीं। 22 अक्टूबर 2026 00:00 UTC तक।'],
  ['デモ · シミュレーション', '実際の収益ではありません。2026年10月22日 00:00 UTCまで。'],
  ['데모 · 시뮬레이션', '실제 수익이 아닙니다. 2026년 10월 22일 00:00 UTC까지.'],
];
const allowedDemoDisclosure = (file: string, text: string) =>
  file === demoNoticeFile && demoDisclosures.some(pair => pair.includes(text));

test('dated simulated ROI keeps all seven disclosures and the exception stays exact and file-scoped', () => {
  const notice = readFileSync(resolve(root, demoNoticeFile), 'utf8');
  for (const pair of demoDisclosures) for (const text of pair) {
    expect(notice).toContain("'" + text + "'");
    expect(allowedDemoDisclosure(demoNoticeFile, text)).toBe(true);
    expect(allowedDemoDisclosure('frontend/src/pages/CopyTradingPage.tsx', text)).toBe(false);
    expect(allowedDemoDisclosure(demoNoticeFile, text + ' backend')).toBe(false);
  }
  expect(notice).toContain('{label} · {demo.period} (UTC)');
  expect(notice).toContain('<small>{description}</small>');
  expect(allowedDemoDisclosure(demoNoticeFile, 'Demo guaranteed profit')).toBe(false);
  expect(PLUMBING.some(rule => rule.test('Demo guaranteed profit'))).toBe(true);
});

/** Every `'key': 'value'` row of a dictionary, values only. */
function localeStrings(source: string): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  const re = /^\s*'([a-zA-Z0-9._]+)':\s*\n?\s*(['"])((?:[^\\]|\\.)*?)\2,?\s*$/gm;
  for (const m of source.matchAll(re)) rows.push({ key: m[1], value: m[3] });
  return rows;
}

describe.each(LOCALES)('%s dictionary', (code) => {
  test('speaks about the product, not about the plumbing', () => {
    const offenders = localeStrings(readLocale(code))
      .filter(({ value }) => !allowed(value)
        && [...PLUMBING, ENV_VAR_NAME].some((r) => r.test(value)))
      .map(({ key, value }) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});

/** Source files whose copy reaches a screen. Tests and generated output are not copy. */
function uiFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') uiFiles(path, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

/**
 * Only text a reader can see. A quoted string in a `.tsx` file is far more
 * often an identifier than a sentence, so everything that is recognisably
 * NOT copy is dropped before the vocabulary is applied: module paths, CSS
 * class lists, translation keys, enum members, and the code fragments that
 * fall out of scanning dense single-line JSX for `>text<`.
 */
const NOT_COPY = [
  /^[./@#]/,                                   // module paths, selectors
  /^[a-z0-9]+$/,                               // status values: 'stale', 'loading'
  /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+$/,   // translation keys
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,           // enum members
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?: [a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/, // class lists
  /[=;{}]|=>|&&|\|\||\?\.|\breturn\b|\bconst\b/,   // code, not prose
];

/** The candidate with surrounding punctuation and whitespace removed. */
const core = (value: string) => value.trim().replace(/^[\s,:;.[\]()]+|[\s,:;.[\]()]+$/g, '');

const isCopy = (value: string) => {
  const text = core(value);
  return text.length >= 4 && /[A-Za-zА-Яа-яЁё]/.test(text) && !NOT_COPY.some((r) => r.test(text));
};

function visibleStrings(source: string): string[] {
  const out: string[] = [];
  for (const line of source.split('\n')) {
    if (/^\s*(import|export)\s/.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const m of line.matchAll(/>([^<>{}\n]{4,300})</g)) out.push(m[1].trim());
    for (const m of line.matchAll(/(['"`])((?:[^'"`\\\n]|\\.){4,300}?)\1/g)) out.push(m[2]);
  }
  return out.filter(isCopy);
}

test('hardcoded component copy speaks about the product, not about the plumbing', () => {
  const offenders: string[] = [];
  for (const path of uiFiles(resolve(root, 'frontend/src'))) {
    const rel = relative(root, path).replace(/\\/g, '/');
    // This is the customer presentation contract. The ADMIN-only console
    // must identify simulated data, destructive deletion scope and deployment
    // controls honestly; it is not part of customer product copy.
    if (rel.startsWith('frontend/src/pages/admin/')) continue;
    // The separate, loopback-only mobile review must label its fixtures and
    // unavailable auth honestly. Its entry and build are isolated from the
    // production app; only this exact directory is outside customer copy.
    if (rel.startsWith('frontend/src/mobile-review/')) continue;
    // lib/customerError.ts holds no copy at all. Its string literals are
    // the SERVER's own sentences, listed so that each can be answered in
    // the customer's language instead — reading them as product copy would
    // flag the very phrases the module exists to keep off the screen. What
    // it actually shows is the `serverError.*` wording in the seven
    // dictionaries, which __tests__/customerFacingErrors.test.ts checks
    // against this same vocabulary, in every language.
    if (rel === 'frontend/src/lib/customerError.ts') continue;
    for (const text of visibleStrings(readFileSync(path, 'utf8'))) {
      if (allowed(text) || allowedDemoDisclosure(rel, text)) continue;
      if (PLUMBING.some((r) => r.test(text))) offenders.push(`${rel}: ${text.slice(0, 120)}`);
    }
  }
  expect(offenders).toEqual([]);
});
