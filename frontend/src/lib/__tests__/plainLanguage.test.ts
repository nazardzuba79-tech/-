import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import { LOCALES, readLocale } from '../../../test-utils/i18nSource';

/** Customer-facing copy must not leak infrastructure detail. An actual
 * simulation must, however, identify its non-real funds honestly. The single
 * NRX demo-account marker is permitted below by exact file and literal, not
 * by exempting OrderForm or relaxing the guard for real trading screens. */
const root = resolve(__dirname, '../../../..');
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
const ENV_VAR_NAME = /[A-Z][A-Z0-9]{3,}_[A-Z0-9_]{3,}/;
const ALLOWED = [
  /API[- ]?(key|ключ|кунж|कुंज|キー|키|密钥|клав)/i,
  /claves? API|API कुंज|API 密钥|APIキー|API 키/i,
  /Manage API keys|Управление API-ключами/i,
];
const allowed = (text: string) => ALLOWED.some((r) => r.test(text));
function localeStrings(source: string): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  const re = /^\s*'([a-zA-Z0-9._]+)':\s*\n?\s*(['"])((?:[^\\]|\\.)*?)\2,?\s*$/gm;
  for (const m of source.matchAll(re)) rows.push({ key: m[1], value: m[3] });
  return rows;
}
describe.each(LOCALES)('%s dictionary', (code) => {
  test('speaks about the product, not about the plumbing', () => {
    const offenders = localeStrings(readLocale(code))
      .filter(({ value }) => !allowed(value) && [...PLUMBING, ENV_VAR_NAME].some((r) => r.test(value)))
      .map(({ key, value }) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});
function uiFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') uiFiles(path, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}
const NOT_COPY = [
  /^[./@#]/,
  /^[a-z0-9]+$/,
  /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+$/,
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?: [a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/,
  /[=;{}]|=>|&&|\|\||\?\.|\breturn\b|\bconst\b/,
];
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
    if (rel.startsWith('frontend/src/pages/admin/')) continue;
    if (rel.startsWith('frontend/src/mobile-review/')) continue;
    if (rel === 'frontend/src/lib/customerError.ts') continue;
    for (const text of visibleStrings(readFileSync(path, 'utf8'))) {
      if (allowed(text)) continue;
      if (rel === 'frontend/src/components/OrderForm.tsx' && text === 'NRX · DEMO') continue;
      if (PLUMBING.some((r) => r.test(text))) offenders.push(`${rel}: ${text.slice(0, 120)}`);
    }
  }
  expect(offenders).toEqual([]);
});
test('the NRX demo marker is scoped to an actual separate simulation account', () => {
  const form = readFileSync(resolve(root, 'frontend/src/components/OrderForm.tsx'), 'utf8');
  expect(form).toContain("const privateNrx = pair.toUpperCase() === 'NRX/USDT'");
  expect(form).toContain('{privateNrx && <div className="terminal-account-state" data-account-scope="SIMULATION_SPOT">');
  expect(form).toContain('<span>NRX · DEMO</span>');
  expect(form).toContain('useVtaSpotAccount(privateVta, pair)');
});
