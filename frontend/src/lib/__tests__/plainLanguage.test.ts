import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { LOCALES, readLocale } from '../../../test-utils/i18nSource';

/**
 * The exchange is shown to people who are not building it. A screen that
 * names the WebSocket, the backend, the database, an env var or a fixture is
 * telling the reader about our plumbing instead of about their money.
 *
 * Important distinction: "demo" / "simulation" are NOT plumbing when they
 * truthfully disclose that a balance or trading mode is simulated. Those
 * labels must remain visible so a user or investor is never led to believe a
 * simulated account is a live-custody account.
 *
 * This guard is the standing version of a sweep done by hand once. It reads
 * the rendered copy — the seven dictionaries, and string/JSX text in the
 * components — and fails on the vocabulary below. It deliberately does NOT
 * look at identifiers, imports, types, CSS classes or comments: naming a
 * variable `nativeDemoApi` is fine; a truthful "Demo balance" / "Симуляция"
 * label is also fine because it describes the product state, not the plumbing.
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
 * Product terms may stay when they are truthful disclosures rather than
 * implementation details. API keys are a product the user creates and revokes.
 * Simulated/demo balances and modes must also stay plainly labeled. The admin
 * test-balance section is staff-only and likewise must not be disguised as
 * ordinary funds.
 */
const ALLOWED = [
  /API[- ]?(key|ключ|кунж|कुंज|キー|키|密钥|клав)/i,
  /claves? API|API कुंज|API 密钥|APIキー|API 키/i,
  /Manage API keys|Управление API-ключами/i,
];

const allowed = (text: string) => ALLOWED.some((r) => r.test(text));

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
    // The admin console keeps its honest "Тестовый баланс" wording; see above.
    if (path.endsWith('admin/AdminUserDetailPage.tsx')) continue;
    const rel = path.slice(resolve(root).length + 1);
    for (const text of visibleStrings(readFileSync(path, 'utf8'))) {
      if (allowed(text)) continue;
      if (PLUMBING.some((r) => r.test(text))) offenders.push(`${rel}: ${text.slice(0, 120)}`);
    }
  }
  expect(offenders).toEqual([]);
});
