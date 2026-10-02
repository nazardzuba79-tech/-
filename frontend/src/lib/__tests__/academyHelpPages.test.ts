import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { compileContent } from '../content/compile';

/**
 * The rendered Academy and Help pages. They open with no request at all —
 * not to the API, not to anything — except «Статус системы», which checks
 * the API and the market Worker once, shows nothing while it waits, and
 * never repeats on a timer. There is no «legal» tab (owner, 2026-10-01).
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const flush = () => new Promise<void>((done) => setImmediate(done));

const contentDir = resolve(frontend, 'content');
function readTree(dir: string, files: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) readTree(full, files);
    else files[relative(contentDir, full).split(sep).join('/')] = readFileSync(full, 'utf8');
  }
  return files;
}
const compiled = compileContent(readTree(contentDir));

const modules = new Map<string, any>();
let RU: Record<string, string>;
let lang = 'ru';
let token: string | null = null;
let dom: any, root: any, host: HTMLElement;
let requests: string[];
let answer: (url: string) => Promise<any>;
const supportOpened = jest.fn();

function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8').replace(/import\.meta\.env/g, '({} as any)'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name === 'virtual:voltex-academy') return { default: compiled.academy };
    if (name === 'virtual:voltex-help') return { default: compiled.help };
    if (name.endsWith('/lib/api')) return { API_BASE: 'https://api.voltextech.net/api/v1', getToken: () => token };
    if (name.endsWith('/lib/i18n')) {
      return {
        useLanguage: () => ({ lang, setLang: () => {}, t: (key: string, params?: Record<string, unknown>) => Object.entries(params ?? {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), (lang === 'ru' ? RU : EN)[key] ?? key) }),
        localeOf: () => 'ru-RU',
      };
    }
    if (name.endsWith('/LanguageSwitcher')) return { LanguageSwitcher: () => null };
    // The site's own header for signed-in visitors; its props are what matters here.
    if (name.endsWith('/components/Nav')) return { Nav: (props: any) => React.createElement('nav', { 'data-site-nav': props.active, 'data-read-profile': String(props.readProfile), 'data-hide-ticker': String(props.hideTicker) }) };
    if (name.endsWith('/Logo')) return { Logo: () => null };
    if (name.endsWith('/lib/supportWidget')) return { openSupportWidget: supportOpened };
    if (name.endsWith('/lib/tradingMode')) return { defaultTradingPath: () => '/futures' };
    if (name.endsWith('/lib/browserActivity')) return { browserFetch: (url: string, init: any) => (globalThis as any).fetch(url, init) };
    if (name.endsWith('/lib/marketEdge')) return { MARKET_EDGE_BASE: 'https://market.voltextech.net' };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}
let EN: Record<string, string>;

beforeAll(() => {
  RU = load(resolve(frontend, 'src/lib/i18n/locales/ru')).RU;
  EN = load(resolve(frontend, 'src/lib/i18n/locales/en')).EN;
});

beforeEach(() => {
  dom = new JSDOM('<!doctype html><head><meta name="description" content="site"><title>VOLTEX</title></head><div id="root"></div>', { pretendToBeVisual: true, url: 'https://voltextech.net/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  requests = [];
  lang = 'ru';
  token = null;
  answer = () => Promise.resolve({ status: 200 });
  (globalThis as any).fetch = jest.fn((url: string) => { requests.push(url); return answer(url); });
  host = document.getElementById('root')!;
  root = req('react-dom/client').createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); jest.useRealTimers(); });

async function open(path: string) {
  const { AcademyPage } = load(resolve(frontend, 'src/pages/knowledge/AcademyPage'));
  const { HelpPage } = load(resolve(frontend, 'src/pages/knowledge/HelpPage'));
  const { MemoryRouter, Routes, Route } = req('react-router-dom');
  const h = React.createElement;
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [path] }, h(Routes, null,
      h(Route, { path: '/academy', element: h(AcademyPage, { home: true }) }),
      h(Route, { path: '/academy/learn', element: h(AcademyPage) }),
      h(Route, { path: '/academy/knowledge', element: h(HelpPage, { view: 'knowledge' }) }),
      h(Route, { path: '/academy/faq', element: h(HelpPage, { view: 'faq' }) }),
      h(Route, { path: '/academy/glossary', element: h(AcademyPage, { glossary: true }) }),
      h(Route, { path: '/academy/:section', element: h(AcademyPage) }),
      h(Route, { path: '/academy/:section/:slug', element: h(AcademyPage) }),
      h(Route, { path: '/help/:tab', element: h(HelpPage) }),
    )));
    await flush(); await flush();
  });
}
const text = () => host.textContent ?? '';
const type = async (selector: string, value: string) => {
  const el = host.querySelector(selector) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush(); });
};

test.each(['/academy', '/academy/learn', '/academy/futures', '/academy/futures/perpetual', '/academy/glossary', '/academy/faq', '/academy/knowledge', '/help/faq', '/help/fees', '/help/rules'])('%s opens with no request at all', async (path) => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  await open(path);
  await act(async () => { jest.advanceTimersByTime(10 * 60_000); await flush(); });
  expect(requests).toEqual([]);
});

test('Academy home: sections in order with counts, «С чего начать», search and level filter', async () => {
  await open('/academy');
  const sections = Array.from(host.querySelectorAll('[data-section]')).map((el) => el.getAttribute('data-section'));
  expect(sections).toEqual(['osnovy', 'futures', 'risk', 'orders', 'ta', 'security', 'glossary']);
  expect(host.querySelector('[data-section="osnovy"]')!.textContent).toContain('Статей: 4');
  expect(text()).toContain('С чего начать');
  expect(document.title).toBe('Академия VOLTEX');
  await type('[data-academy-search]', 'стейбл');
  expect(Array.from(host.querySelectorAll('[data-article]')).map((el) => el.getAttribute('data-article'))).toContain('stablecoins');
  await type('[data-academy-search]', '');
  await act(async () => { (host.querySelector('[data-level="Средний"]') as HTMLElement).click(); await flush(); });
  const shown = Array.from(host.querySelectorAll('[data-article]')).map((el) => el.getAttribute('data-article'));
  const medium = compiled.academy.ru.articles.filter((a) => a.level === 'Средний').map((a) => a.slug);
  expect(shown.sort()).toEqual(medium.sort());
});

test('article: breadcrumbs, its own title and description, section list, related, prev/next and the terminal link', async () => {
  const article = compiled.academy.ru.articles.find((a) => a.slug === 'perpetual')!;
  await open(`/academy/${article.section}/${article.slug}`);
  expect(document.title).toBe(`${article.title} — Академия VOLTEX`);
  expect(document.querySelector('meta[name="description"]')!.getAttribute('content')).toBe(article.summary);
  expect(host.querySelector('.vx-kb-crumbs')!.textContent).toBe(`Академия/Фьючерсы/${article.title}`);
  expect(host.querySelector('.vx-kb-sidebar a[aria-current="page"]')!.textContent).toBe(article.title);
  expect(host.querySelector('[data-try-terminal]')!.getAttribute('href')).toBe('/futures');
  expect(host.querySelector('[data-try-terminal]')!.textContent).toBe('Попробовать в терминале');
  for (const slug of article.related) expect(host.querySelector(`.vx-kb-block [data-article="${slug}"]`)).not.toBeNull();
  expect(host.querySelector('.vx-kb-pager')).not.toBeNull();
  expect(host.querySelector('[data-article-body]')!.innerHTML).toContain('<h2');
});

test('glossary: Latin first, letter index, search, links only to real articles', async () => {
  await open('/academy/glossary');
  const terms = Array.from(host.querySelectorAll('[data-term]')).map((el) => el.getAttribute('data-term')!);
  expect(terms[0]).toBe('Ask');
  const firstCyrillic = terms.findIndex((t) => /^[А-Яа-яЁё]/.test(t));
  expect(terms.slice(firstCyrillic).some((t) => /^[A-Za-z]/.test(t))).toBe(false);
  for (const link of Array.from(host.querySelectorAll('.vx-kb-term-link'))) expect(link.getAttribute('href')).toMatch(/^\/academy\/[a-z]+\/[a-z0-9-]+$/);
  await type('[data-glossary-search]', 'Bid');
  expect(Array.from(host.querySelectorAll('[data-term]')).map((el) => el.getAttribute('data-term'))).toEqual(['Bid']);
});

test('Academy hub exposes Home, Learn, Knowledge Base, FAQ and Glossary', async () => {
  await open('/academy/faq');
  expect(Array.from(host.querySelectorAll('[data-academy-hub-tab]')).map((el) => el.textContent)).toEqual([
    'Главная', 'Обучение', 'База знаний', 'Вопросы и ответы', 'Глоссарий',
  ]);
  expect(host.querySelector('[data-academy-hub-tab="faq"]')?.getAttribute('aria-current')).toBe('page');
  expect(text()).not.toContain('Юридические документы');
  const first = host.querySelector('[data-faq-item] button') as HTMLButtonElement;
  expect(first.getAttribute('aria-expanded')).toBe('false');
  await act(async () => { first.click(); await flush(); });
  expect(first.getAttribute('aria-expanded')).toBe('true');
  await type('[data-faq-search]', 'пароль');
  expect(host.querySelectorAll('[data-faq-item]').length).toBeGreaterThan(0);
  await act(async () => { (host.querySelector('[data-help-support]') as HTMLElement).click(); await flush(); });
  expect(supportOpened).toHaveBeenCalled();
});

test.each([
  ['/help/faq', 'Вопросы и ответы'],
  ['/help/fees', 'База знаний'],
  ['/help/rules', 'База знаний'],
])('legacy %s redirects into the Academy hub', async (path, title) => {
  await open(path);
  expect(text()).toContain(title);
  expect(host.querySelector('[data-academy-hub]')).not.toBeNull();
});

test('fees page: zero fees, the owner note stays hidden', async () => {
  await open('/academy/knowledge');
  const rows = Array.from(host.querySelectorAll('[data-fees-trading] tbody tr')).map((tr) => tr.textContent);
  expect(rows).toEqual(['Фьючерсы0%0%', 'Спот0%0%']);
  expect(text()).toContain('500 USD');
  expect(text()).not.toContain('ЗАПОЛНИТЕ');
  expect(text()).not.toContain('_note');
});

test('status: one check each on open, nothing shown while waiting, then only what the checks prove; no timer', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  const pending: Record<string, (value: any) => void> = {};
  answer = (url) => new Promise((done) => { pending[url] = done; });
  await open('/help/status');
  expect(requests.sort()).toEqual(['https://api.voltextech.net/health', 'https://market.voltextech.net/health']);
  expect(Array.from(host.querySelectorAll('[data-status-probe]')).map((el) => el.getAttribute('data-status-probe'))).toEqual(['api', 'market']);
  expect(host.querySelectorAll('[data-status]').length).toBe(0);
  expect(text()).not.toMatch(/Ожида|Нет ответа|Проверяем/);
  await act(async () => { jest.advanceTimersByTime(60_000); await flush(); });
  expect(host.querySelectorAll('[data-status]').length).toBe(0);
  await act(async () => { pending['https://api.voltextech.net/health']({ status: 200 }); pending['https://market.voltextech.net/health']({ status: 502 }); await flush(); await flush(); });
  const state = (id: string) => host.querySelector(`[data-status-probe="${id}"] [data-status]`)?.textContent;
  expect([state('api'), state('market')]).toEqual(['Отвечает', 'Ответил с ошибкой']);
  // One 200 from /health is not shown as working trading, deposits, withdrawals or sign-in.
  expect(host.querySelectorAll('[data-status-component]').length).toBe(0);
  expect(text()).not.toMatch(/Работает|Торговля фьючерсами|Вывод.*Отвечает/);
  expect(text()).toContain('Она не подтверждает, что каждая операция');
  expect(host.querySelector('[data-no-incidents]')!.textContent).toBe('Опубликованных сообщений о сбоях нет');
  await act(async () => { jest.advanceTimersByTime(60 * 60_000); await flush(); });
  expect(requests).toHaveLength(2);
});

test('status: a request the browser could not complete reads «Не удалось проверить», not an outage', async () => {
  answer = (url) => (url.includes('api.') ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ status: 200 }));
  await open('/help/status');
  await act(async () => { await flush(); await flush(); });
  const state = (id: string) => host.querySelector(`[data-status-probe="${id}"] [data-status]`)?.textContent;
  expect([state('api'), state('market')]).toEqual(['Не удалось проверить', 'Отвечает']);
  expect(text()).not.toMatch(/Проблемы|сбой платформы подтвержд/);
});

test('English: labels translate, the Russian text stays with a short note', async () => {
  lang = 'en';
  await open('/academy/faq');
  expect(host.querySelector('[role="note"]')!.textContent).toBe('This section is available in Russian only for now');
  expect(host.querySelector('[data-academy-hub-tab="faq"]')!.textContent).toBe('FAQ');
  expect(text()).toContain('Как зарегистрироваться?');
});

test('«Академия» is a tab of the site header: lit for guests, and the signed-in Nav runs without its API reads', async () => {
  await open('/academy');
  const tab = host.querySelector('.global-header a[href="/academy"]')!;
  expect(tab.className).toContain('nav-active');
  expect(Array.from(host.querySelectorAll('.global-header .main-nav a')).map((a) => a.getAttribute('href'))).toEqual(['/markets', '/trade', '/futures', '/copy-trading', '/card', '/otc', '/trading-bots', '/academy']);
  await act(async () => root.unmount());
  root = req('react-dom/client').createRoot(host);
  token = 'header.eyJzdWIiOiJ1c2VyLTEifQ.sig';
  await open('/academy/glossary');
  const nav = host.querySelector('[data-site-nav]')!;
  expect([nav.getAttribute('data-site-nav'), nav.getAttribute('data-read-profile'), nav.getAttribute('data-hide-ticker')]).toEqual(['/academy', 'false', 'true']);
  expect(host.querySelector('.vx-kb-guest-header')).toBeNull();
  expect(requests).toEqual([]);
});

test('Nav skips its profile read when asked, and only then', () => {
  const nav = readFileSync(resolve(frontend, 'src/components/Nav.tsx'), 'utf8');
  expect(nav).toContain('readProfile=true}');
  expect(nav).toContain('if(!getToken()||!readProfile)return;api.getMe()');
});
