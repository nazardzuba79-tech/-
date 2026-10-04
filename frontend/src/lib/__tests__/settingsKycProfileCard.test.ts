/**
 * Settings: the modern KYC form, the Profile verification action and the
 * VOLTEX Card shortcut (owner bundle, 2026-10-04).
 *
 * The real SettingsPage is mounted in jsdom with the network, the KYC edge
 * client and the shared chrome replaced; everything else — the form, the
 * upload zone, the sidebar, the Russian dictionary — is the real module.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { kycStepStates } from '../kycSteps';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { act } = React;
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8');

type Status = 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';

// One window for the whole file: React DOM is loaded once and keeps to the
// first document it saw, so each mount gets a fresh container in it instead.
let shared: any = null;
function window_() {
  if (!shared) {
    shared = new (req('jsdom').JSDOM)('', { url: 'https://example.invalid/settings', pretendToBeVisual: true });
    Object.assign(globalThis, {
      window: shared.window, document: shared.window.document, HTMLElement: shared.window.HTMLElement, File: shared.window.File,
      localStorage: shared.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
    });
  }
  return shared;
}
afterAll(() => shared?.window.close());

function mountSettings(status: Status, { entry = '/settings', receipt = false } = {}) {
  const dom = window_();
  dom.window.document.body.innerHTML = '<div id="root"></div>';
  dom.window.localStorage.clear();
  dom.window.scrollTo = jest.fn();
  if (receipt) dom.window.localStorage.setItem('voltex_kyc_receipt', JSON.stringify({ submissionId: 'sealed', sealed: 'x' }));
  const submission = status === 'NOT_STARTED' ? null : {
    id: 'sub-1', country: 'UA', fullName: 'Synthetic Person', documentType: 'PASSPORT', status,
    rejectionReason: status === 'REJECTED' ? 'Фото размыто' : null, createdAt: '2026-09-04T10:00:00Z',
  };
  const api = {
    getMe: jest.fn().mockResolvedValue({ id: 'a2184cdc-0000', email: 'qa@example.invalid', displayName: 'qa', phone: null, country: 'UA',
      avatarUrl: null, isAdmin: false, kycStatus: status, twoFactorEnabled: false, createdAt: '2026-09-04T10:00:00Z' }),
    getSecurityLog: jest.fn().mockResolvedValue([]),
    getMyKyc: jest.fn().mockResolvedValue({ kycStatus: status, latestSubmission: submission }),
  };
  const prepared = (name: string) => ({ file: new dom.window.File(['x'.repeat(2048)], name, { type: 'image/jpeg' }), originalBytes: 4096, compressed: true });
  // The edge client's surface. The receipt is read from the same storage key
  // as the real one; preparation and upload are the stubs under test.
  class KycFileError extends Error { constructor(public code: string) { super(code); } }
  const kyc = {
    KYC_ERROR_KEYS: {}, KycFileError,
    formatKycBytes: (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`,
    newKycRequestId: () => 'request-1',
    readKycReceipt: () => { const raw = dom.window.localStorage.getItem('voltex_kyc_receipt'); return raw ? JSON.parse(raw) : null; },
    clearKycReceipt: jest.fn(),
    retryKycReceipt: jest.fn().mockResolvedValue(false),
    prepareKycDocument: jest.fn(async (_file: File) => prepared('document.jpg')),
    submitKycToEdge: jest.fn().mockResolvedValue({ confirmed: true }),
  };
  const modules = new Map<string, any>();
  const RU = loadTs(resolve(frontend, 'src/lib/i18n/locales/ru.ts'), (name, from) => load(resolve(dirname(from), name))).RU;
  const t = (key: string, params: Record<string, string> = {}) =>
    String(RU[key] ?? key).replace(/\{(\w+)\}/g, (_m: string, k: string) => params[k] ?? `{${k}}`);

  function loadTs(file: string, resolveDep?: (name: string, from: string) => any): any {
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const out: any = {};
    new Function('exports', 'require', 'module', code)(out, (name: string) => (resolveDep ? resolveDep(name, file) : req(name)), { exports: out });
    return out;
  }
  function load(file: string): any {
    for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
    if (modules.has(file)) return modules.get(file);
    const out: any = {};
    modules.set(file, out);
    Object.assign(out, loadTs(file, (name, from) => {
      if (name.endsWith('.css')) return {};
      if (name === 'sonner') return { Toaster: () => null, toast: { success: jest.fn(), error: jest.fn() } };
      if (name.endsWith('/lib/api')) return { api };
      if (name.endsWith('/lib/i18n')) return { useLanguage: () => ({ t, lang: 'ru' }), localeOf: () => 'ru-RU' };
      if (name.endsWith('/components/Nav')) return { Nav: () => null };
      if (name.endsWith('/components/Footer')) return { Footer: () => null };
      if (name.endsWith('/lib/kycEdge')) return kyc;
      return name.startsWith('.') ? load(resolve(dirname(from), name)) : req(name);
    }));
    return out;
  }

  const host = dom.window.document.getElementById('root');
  const root = req('react-dom/client').createRoot(host);
  const { SettingsPage } = load(resolve(frontend, 'src/pages/SettingsPage.tsx'));
  const { MemoryRouter, Routes, Route, useLocation } = req('react-router-dom');
  function Location() { return React.createElement('output', { 'data-location': true }, useLocation().pathname); }
  const ready = act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: [entry] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/settings', element: React.createElement(SettingsPage) }),
        React.createElement(Route, { path: '/card', element: React.createElement('main', { 'data-card-page': true }) })),
      React.createElement(Location)));
    await flush();
  });
  const $ = (selector: string) => host.querySelector(selector) as HTMLElement | null;
  /** Lets the mocked reads settle and React commit, until `selector` renders (or a bounded number of turns). */
  const settle = async (selector: string) => {
    for (let i = 0; i < 50 && !host.querySelector(selector); i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); await flush(); });
    return host.querySelector(selector) as HTMLElement | null;
  };
  const $$ = (selector: string) => [...host.querySelectorAll(selector)] as HTMLElement[];
  const click = (el: Element | null) => act(async () => { expect(el).not.toBeNull(); (el as HTMLElement).click(); await flush(); });
  const type = (el: Element, value: string) => act(async () => {
    const proto = el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    await flush();
  });
  const pick = (file: File) => act(async () => {
    const input = $('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flush();
  });
  const drop = (file: File) => act(async () => {
    const zone = $('[data-kyc-upload]')!;
    for (const kind of ['dragover', 'drop']) {
      const event = new dom.window.Event(kind, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
      zone.dispatchEvent(event);
    }
    await flush();
  });
  const file = (name: string) => new dom.window.File(['%PDF-fixture'], name, { type: 'image/png' });
  const dispose = () => act(async () => { root.unmount(); });
  return { ready, api, kyc, host, dom, $, $$, settle, click, type, pick, drop, file, dispose };
}

describe('the three KYC stages are facts, not a made-up percentage', () => {
  test('a fresh form advances as fields and the document are added', () => {
    expect(kycStepStates('NOT_STARTED', { personalFilled: false, documentAdded: false })).toEqual({ personal: 'current', document: 'todo', review: 'todo' });
    expect(kycStepStates('NOT_STARTED', { personalFilled: true, documentAdded: false })).toEqual({ personal: 'done', document: 'current', review: 'todo' });
    expect(kycStepStates('NOT_STARTED', { personalFilled: true, documentAdded: true })).toEqual({ personal: 'done', document: 'done', review: 'current' });
  });
  test('the server status decides the review stage', () => {
    expect(kycStepStates('PENDING', { personalFilled: false, documentAdded: false })).toEqual({ personal: 'done', document: 'done', review: 'current' });
    expect(kycStepStates('APPROVED', { personalFilled: false, documentAdded: false })).toEqual({ personal: 'done', document: 'done', review: 'done' });
    expect(kycStepStates('REJECTED', { personalFilled: true, documentAdded: true }).review).toBe('failed');
  });
  test('the old status-derived percentage is gone from the form', () => {
    const form = read('src/pages/settings-arctic/VerificationSection.tsx');
    expect(form).not.toMatch(/kycProgressPct|progressPct|verificationLevel/);
    expect(form).toMatch(/kycStepStates\(/);
  });
});

describe('Profile verification action follows the real status enum', () => {
  afterEach(() => jest.restoreAllMocks());
  const expected: Record<Status, string | null> = {
    NOT_STARTED: 'Пройти верификацию', REJECTED: 'Исправить и отправить снова', PENDING: 'Открыть статус', APPROVED: null,
  };
  test.each(Object.entries(expected))('%s', async (status, label) => {
    const f = mountSettings(status as Status);
    await f.ready;
    const row = await f.settle('[data-profile-verification]');
    expect(row?.getAttribute('data-profile-verification')).toBe(status);
    const action = f.$('[data-profile-verification-action]');
    expect(action?.textContent ?? null).toBe(label);
    if (action) {
      await f.click(action);
      // The Verification tab, opened through the Settings tab state: no route change.
      expect((await f.settle('[data-kyc-state]'))?.getAttribute('data-kyc-state')).toBe(status);
      expect(f.$('[data-location]')?.textContent).toBe('/settings');
      expect(f.dom.window.scrollTo).toHaveBeenCalled();
      expect(f.$$('input[type="file"]')).toHaveLength(status === 'PENDING' ? 0 : 1);
    }
    await f.dispose();
  });
  test('a delivered document still being recorded reads as under review, never «Пройти верификацию»', async () => {
    const f = mountSettings('NOT_STARTED', { receipt: true });
    await f.ready;
    expect((await f.settle('[data-profile-verification]'))?.getAttribute('data-profile-verification')).toBe('PENDING');
    expect(f.$('[data-profile-verification-action]')?.textContent).toBe('Открыть статус');
    await f.dispose();
  });
  test('the action is chosen from the enum, not from translated text', () => {
    const overview = read('src/pages/settings-arctic/AccountOverview.tsx');
    expect(overview).not.toMatch(/row\.label === t\('settings\.verification'\)/);
    expect(read('src/pages/SettingsPage.tsx')).toMatch(/onVerify=\{\(\) => \{\s*onNavigate\('verification'\)/);
  });
});

describe('VOLTEX Card shortcut in Settings', () => {
  test('a link to /card on the desktop rail and on phones, outside the tab list', async () => {
    const f = mountSettings('NOT_STARTED');
    await f.ready;
    await f.settle('[data-profile-verification]');
    const links = f.$$('[data-settings-card-link]');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('/card');
      expect(link.closest('ul')).toBeNull();
      expect(link.closest('.overflow-x-auto')).toBeNull();
      expect(link.textContent).toBe('VOLTEX Card');
    }
    await f.click(links[0]);
    expect(f.$('[data-location]')?.textContent).toBe('/card');
    await f.dispose();
  });
  test('the Wallet shortcut is untouched and the new one is calmer (no glow, no gold tile)', () => {
    const wallet = read('src/pages/wallet-v3/WalletSideNav.tsx');
    expect(wallet).toMatch(/<Link to="\/card" className="wallet-card-link"/);
    const shortcut = read('src/pages/settings-arctic/VoltexCardShortcut.tsx');
    expect(shortcut).not.toMatch(/glow|wallet-card-link|bg-gold/);
    expect(shortcut).toMatch(/stroke-gold-500/);
  });
});

describe('the KYC form keeps its pipeline under the new upload zone', () => {
  test('pick, replace, remove and drop all go through prepareKycDocument; the native button is hidden', async () => {
    const f = mountSettings('NOT_STARTED', { entry: '/settings?tab=verification' });
    await f.ready;
    await f.settle('form');
    const input = f.$('input[type="file"]')!;
    expect(input.className).toContain('sr-only');
    expect(input.getAttribute('accept')).toBe('image/jpeg,image/png,application/pdf');
    // Not `required`: a hidden required input would raise the browser's bubble on nothing.
    expect(input.hasAttribute('required')).toBe(false);

    const long = 'Паспорт_очень_длинное_имя_файла_для_проверки_переноса_2026-10-04.png';
    await f.pick(f.file(long));
    expect(f.kyc.prepareKycDocument).toHaveBeenCalledTimes(1);
    expect(f.kyc.prepareKycDocument.mock.calls[0][0].name).toBe(long);
    expect(f.$('[data-kyc-file]')?.textContent).toContain(long);
    expect(f.$('[data-kyc-file-size]')?.textContent).toMatch(/^Файл готов: /);

    await f.click(f.$('[aria-label="Удалить файл"]'));
    expect(f.$('[data-kyc-file]')).toBeNull();
    expect(f.$('[data-kyc-upload]')).not.toBeNull();

    await f.drop(f.file('dropped.png'));
    expect(f.kyc.prepareKycDocument).toHaveBeenCalledTimes(2);
    expect(f.$('[data-kyc-file]')?.textContent).toContain('dropped.png');
    await f.dispose();
  });

  test('a refused file is shown on the zone; submitting without one never calls the edge', async () => {
    const f = mountSettings('REJECTED', { entry: '/settings?tab=verification' });
    await f.ready;
    await f.settle('form');
    expect(f.$('[data-kyc-rejection]')?.textContent).toContain('Фото размыто');
    f.kyc.prepareKycDocument.mockRejectedValueOnce(new f.kyc.KycFileError('kyc_file_type'));
    await f.pick(f.file('notes.txt'));
    expect(f.$('[data-kyc-upload] + [role="alert"], [role="alert"]')?.textContent).toBe('Подходят только JPEG, PNG или PDF.');
    await act(async () => { f.$('form')!.dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true })); await flush(); });
    expect(f.kyc.submitKycToEdge).not.toHaveBeenCalled();
    expect(f.$('[role="alert"]')?.textContent).toBe('Добавь фото документа');
    await f.dispose();
  });

  test('a complete form submits once to the same edge client with the same fields', async () => {
    const f = mountSettings('NOT_STARTED', { entry: '/settings?tab=verification' });
    await f.ready;
    await f.settle('form');
    await f.type(f.$('input[type="text"]')!, 'Synthetic Person');
    await f.type(f.$('input[type="date"]')!, '1990-01-01');
    await f.type(f.$('select')!, 'ID_CARD');
    await f.pick(f.file('passport.png'));
    expect(f.$$('[data-kyc-steps] > li').map((li) => li.getAttribute('data-state'))).toEqual(['done', 'done', 'current']);
    await act(async () => { f.$('form')!.dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true })); await flush(); });
    expect(f.kyc.submitKycToEdge).toHaveBeenCalledTimes(1);
    const fields = f.kyc.submitKycToEdge.mock.calls[0][0];
    expect({ ...fields, requestId: typeof fields.requestId, document: fields.document.name }).toEqual({
      requestId: 'string', country: 'RU', fullName: 'Synthetic Person', dateOfBirth: '1990-01-01', documentType: 'ID_CARD', document: 'document.jpg',
    });
    await f.dispose();
  });

  test('pending and approved offer no upload at all', async () => {
    for (const status of ['PENDING', 'APPROVED'] as const) {
      const f = mountSettings(status, { entry: '/settings?tab=verification' });
      await f.ready;
      expect((await f.settle('[data-kyc-state]'))?.getAttribute('data-kyc-state')).toBe(status);
      expect(f.$$('input[type="file"]')).toHaveLength(0);
      await f.dispose();
    }
  });
});
