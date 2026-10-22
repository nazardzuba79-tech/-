import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import ts from 'typescript';

/** Real About/Legal components; existing shared header is stubbed to avoid its
 * unrelated profile reads. Full shared navigation is exercised by browser QA. */
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const flush = () => new Promise<void>(done => setImmediate(done));
const modules = new Map<string, any>();
let token: string | null = null;
let ru: Record<string, string>;
let dom: any, root: any, host: HTMLElement;
const fetchFixture = jest.fn();

function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const output: any = {}; modules.set(file, output);
  const code = ts.transpileModule(readFileSync(file, 'utf8').replace(/import\.meta\.env/g, '({} as any)'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('exports', 'require', code)(output, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/lib/api')) return { getToken: () => token };
    if (name.endsWith('/lib/i18n')) return { useLanguage: () => ({ lang: 'ru', t: (key: string) => ru[key] ?? key }) };
    if (name.endsWith('/components/Nav')) return { Nav: () => React.createElement('header', { 'data-shared-header': 'account' }, 'VOLTEX') };
    if (name.endsWith('/home/HomeHeader')) return { HomeHeader: () => React.createElement('header', { 'data-shared-header': 'guest' }, 'VOLTEX') };
    if (name.endsWith('/Logo')) return { Logo: () => React.createElement('span', null, 'VOLTEX') };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return output;
}

beforeAll(() => { ru = load(resolve(frontend, 'src/lib/i18n/locales/ru')).RU; });
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head><title>VOLTEX</title></head><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/legal/about' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  token = null; fetchFixture.mockReset(); (globalThis as any).fetch = fetchFixture;
  host = document.getElementById('root')!;
  root = req('react-dom/client').createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); });

async function open(path = '/legal/about') {
  const { LegalPage } = load(resolve(frontend, 'src/pages/LegalPage'));
  const { MemoryRouter, Routes, Route } = req('react-router-dom');
  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(Routes, null,
      React.createElement(Route, { path: '/legal/:doc', element: React.createElement(LegalPage) }))));
    await flush();
  });
}

test('the existing public About route renders its complete Russian composition and one H1', async () => {
  await open();
  const main = host.querySelector('main.about-main')!;
  expect(main).not.toBeNull();
  expect(main.querySelectorAll('h1')).toHaveLength(1);
  expect(main.querySelector('h1')!.textContent!.replace(/\s+/g, ' ')).toMatch(/Больше понимания\.\s*Больше возможностей\./);
  for (const heading of ['Знакомьтесь, VOLTEX', 'Разные инструменты.', 'Целостный подход.', 'Наши ориентиры', 'Что лежит в основе VOLTEX', 'Наш подход к платформе', 'Единый подход к разным задачам', 'VOLTEX — на экране']) expect(main.textContent).toContain(heading);
  expect(main.querySelectorAll('.about-markets-grid > *')).toHaveLength(4);
  expect(main.querySelectorAll('.about-approach-grid > *')).toHaveLength(6);
  expect(main.querySelectorAll('.about-accordion-trigger')).toHaveLength(4);
  expect(fetchFixture).not.toHaveBeenCalled();
});

test.each([false, true])('About reuses shared header/footer for account=%s without changing destinations', async signedIn => {
  token = signedIn ? 'qa-not-a-real-token' : null;
  await open();
  expect(host.querySelector('[data-shared-header]')?.getAttribute('data-shared-header')).toBe(signedIn ? 'account' : 'guest');
  expect(host.querySelectorAll('header')).toHaveLength(1);
  expect(host.querySelectorAll('footer')).toHaveLength(1);
  for (const href of ['/legal/about', '/legal/terms', '/legal/privacy', '/legal/risk', '/academy', '/academy/faq', '/trade', '/futures']) expect(host.querySelector(`footer a[href="${href}"]`)).not.toBeNull();
  expect(fetchFixture).not.toHaveBeenCalled();
});

test('accordion starts with the first answer expanded and state/ARIA stay in sync', async () => {
  await open();
  const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.about-accordion-trigger'));
  expect(buttons.map(button => button.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false', 'false']);
  for (const button of buttons) {
    expect(button.type).toBe('button');
    expect(button.id).toBeTruthy();
    const target = document.getElementById(button.getAttribute('aria-controls')!);
    expect(target).not.toBeNull();
    expect(target?.getAttribute('aria-labelledby')).toBe(button.id);
  }
  await act(async () => { buttons[1].click(); await flush(); });
  expect(buttons[1].getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(buttons[1].getAttribute('aria-controls')!)?.getAttribute('aria-hidden')).toBe('false');
  await act(async () => { buttons[1].click(); await flush(); });
  expect(buttons[1].getAttribute('aria-expanded')).toBe('false');
});

test('hero anchor resolves locally and platform CTAs retain existing /markets route', async () => {
  await open();
  expect(host.querySelector('.about-hero a[href="#overview"]')).not.toBeNull();
  expect(host.querySelector('#overview')).not.toBeNull();
  const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('main a'));
  for (const text of ['Перейти к платформе', 'Открыть VOLTEX']) expect(links.find(link => link.textContent?.includes(text))?.getAttribute('href')).toBe('/markets');
  expect(readFileSync(resolve(frontend, 'src/App.tsx'), 'utf8')).toContain('path="/markets"');
});

test('photos are local, sized, described and lazy below the hero', async () => {
  await open();
  const images = Array.from(host.querySelectorAll<HTMLImageElement>('main img'));
  expect(images.length).toBeGreaterThanOrEqual(5);
  for (const image of images) {
    const src = image.getAttribute('src')!;
    expect(src).toMatch(/^\/about\/[a-z0-9-]+\.webp$/);
    expect(existsSync(resolve(frontend, 'public', src.slice(1)))).toBe(true);
    if (image.closest('.about-laptop-background')) expect(image.alt).toBe('');
    else expect(image.alt.trim().length).toBeGreaterThan(10);
    expect(Number(image.getAttribute('width'))).toBeGreaterThan(0);
    expect(Number(image.getAttribute('height'))).toBeGreaterThan(0);
    if (!image.closest('.about-hero')) expect(image.loading || image.getAttribute('loading')).toBe('lazy');
  }
  for (const source of Array.from(host.querySelectorAll('main source[srcset]'))) {
    for (const candidate of source.getAttribute('srcset')!.split(',')) {
      const src = candidate.trim().split(/\s+/)[0];
      expect(existsSync(resolve(frontend, 'public', src.slice(1)))).toBe(true);
    }
  }
});

test.each(['terms', 'privacy', 'risk', 'support'])('other legal document /legal/%s keeps its original content', async doc => {
  await open(`/legal/${doc}`);
  const { LEGAL_CONTENT } = load(resolve(frontend, 'src/lib/legalContent'));
  expect(host.querySelector('.about-page')).toBeNull();
  expect(host.querySelector('h1')?.textContent).toBe(LEGAL_CONTENT.ru[doc].title);
  expect(host.textContent).toContain(LEGAL_CONTENT.ru[doc].intro);
  for (const section of LEGAL_CONTENT.ru[doc].sections) expect(host.textContent).toContain(section.heading);
});

test('About stylesheet is isolated and provides focus, reduced motion and responsive rules', () => {
  const css = readFileSync(resolve(frontend, 'src/pages/about/AboutPage.css'), 'utf8');
  const postcss = req('postcss');
  const parsed = postcss.parse(css);
  parsed.walkRules((rule: any) => {
    if (rule.parent.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;
    for (const selector of rule.selectors) expect(selector.trim()).toMatch(/^\.about-/);
  });
  expect(css).toContain(':focus-visible');
  expect(css).toContain('prefers-reduced-motion');
  expect(css).toMatch(/@media/);
});

test('About adds no background requests, financial controls, fake app downloads or claims', async () => {
  await open();
  const source = readFileSync(resolve(frontend, 'src/pages/about/AboutPage.tsx'), 'utf8');
  expect(source).not.toMatch(/\bfetch\s*\(|\bsetInterval\s*\(|\bWebSocket\s*\(|localStorage|sessionStorage|\.post\s*\(/);
  expect(host.querySelector('main form')).toBeNull();
  expect(host.querySelector('main video[autoplay]')).toBeNull();
  expect(host.querySelector('main')!.textContent).not.toMatch(/Bybit|Binance|Mastercard|Visa|App Store|Google Play|лицензи[яи]|миллион|\d[\d\s,.]*\+?\s+(?:пользоват|клиент)|оборот|основан[ао]? в/i);
});
