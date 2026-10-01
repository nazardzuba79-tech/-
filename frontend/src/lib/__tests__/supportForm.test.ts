import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { invalidSupportFields, sendSupportRequest, SUPPORT_LIMITS, type SupportFormInput } from '../supportForm';
import { RU } from '../i18n/locales/ru';
import { ASSISTANT_RU as copy } from '../i18n/locales/assistantRu';

/**
 * LOCAL FAQ + EXPLICIT HUMAN FORM: ONE POST, ONE EMAIL, NOTHING WHILE IDLE.
 *
 * The widget used to be a chat that polled every 5 s (open) or 20 s (closed)
 * and resumed a stored conversation on every page load. The owner replaced it
 * with a form answered from Gmail. These cases pin what that means for the
 * browser: the rules, the one POST and its honest outcome, the prefill for a
 * signed-in user, and the absence of any timer, poll, stored thread or secret.
 * The Worker's own contract (recipient, Reply-To, injection, limits) is
 * tested in workers/support-edge/test.mjs.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const { createRoot } = req('react-dom/client');
// Typing goes through React's own change event: react-dom may already be
// loaded in this worker without a DOM, which disables its native `input`
// listener, so dispatching a DOM event alone would not reach onChange.
const { Simulate } = req('react-dom/test-utils');

const valid: SupportFormInput = {
  name: 'VOLTEX Support QA', email: 'qa-support@example.invalid', subject: 'TECHNICAL',
  message: 'Production support form test. No action required.',
};

// ── the rules the form applies before sending ───────────────────────────────

it('accepts a complete form and names each bad field otherwise', () => {
  expect(invalidSupportFields(valid)).toEqual([]);
  expect(invalidSupportFields({ ...valid, email: 'not-an-email' })).toEqual(['email']);
  expect(invalidSupportFields({ ...valid, email: 'a@example.com, b@example.com' })).toEqual(['email']);
  expect(invalidSupportFields({ ...valid, message: '   \n ' })).toEqual(['message']);
  expect(invalidSupportFields({ ...valid, message: 'x'.repeat(SUPPORT_LIMITS.message + 1) })).toEqual(['message']);
  expect(invalidSupportFields({ ...valid, subject: 'SALES' as never })).toEqual(['subject']);
  expect(invalidSupportFields({ ...valid, name: 'Ivan\r\nBcc: victim@example.com' })).toEqual(['name']);
  expect(invalidSupportFields({ ...valid, email: 'a@example.com\nBcc: b@example.com' })).toEqual(['email']);
});

// ── the one request and its honest outcome ──────────────────────────────────

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fn, calls };
}

it('sends exactly the four fields (and the empty honeypot) to the configured endpoint, without cookies', async () => {
  const f = fakeFetch(200, { ok: true });
  const outcome = await sendSupportRequest({ ...valid, name: '  VOLTEX Support QA ', to: 'x@evil.test' } as never,
    { endpoint: 'https://support.test/v1/support', fetchImpl: f.fn });
  expect(outcome).toEqual({ status: 'sent' });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].url).toBe('https://support.test/v1/support');
  expect(f.calls[0].init.method).toBe('POST');
  expect(f.calls[0].init.credentials).toBe('omit');
  expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
    name: 'VOLTEX Support QA', email: valid.email, subject: 'TECHNICAL', message: valid.message, website: '',
  });
});

it('reports success ONLY when the provider accepted the email', async () => {
  const cases: [number, unknown, string][] = [
    [502, { ok: false, error: 'delivery_failed' }, 'delivery_failed'],
    [503, { ok: false, error: 'not_configured' }, 'not_configured'],
    [429, { ok: false, error: 'rate_limited' }, 'rate_limited'],
    [400, { ok: false, error: 'invalid' }, 'invalid'],
    [200, { ok: false }, 'unexpected'],   // a 200 that does not say ok is not a success
    [200, null, 'unexpected'],
    [500, null, 'unexpected'],
  ];
  for (const [status, body, reason] of cases) {
    const f = fakeFetch(status, body);
    expect(await sendSupportRequest(valid, { endpoint: 'https://support.test/v1/support', fetchImpl: f.fn }))
      .toEqual({ status: 'failed', reason });
  }
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  expect(await sendSupportRequest(valid, { endpoint: 'https://support.test/v1/support', fetchImpl: offline }))
    .toEqual({ status: 'failed', reason: 'network' });
});

// ── the widget, mounted ──────────────────────────────────────────────────────

it('the existing POST deadline aborts once without retry or success', async () => {
  jest.useFakeTimers();
  const pending = jest.fn((_url: string, init: RequestInit) => new Promise<never>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true });
  }));
  const result = sendSupportRequest(valid, { endpoint: 'https://support.test/v1/support', fetchImpl: pending });
  jest.advanceTimersByTime(20_000);
  expect(await result).toEqual({ status: 'failed', reason: 'network' });
  expect(pending).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

interface Harness {
  dom: any;
  host: HTMLElement;
  fetches: { url: string; body: any }[];
  getMe: jest.Mock;
  intervals: jest.SpyInstance;
  launcher: () => HTMLButtonElement;
  panel: () => HTMLElement | null;
  type: (selector: string, value: string) => void;
  submit: () => Promise<void>;
  cleanup: () => void;
}

function mountWidget(opts: { token?: string | null; response?: { status: number; body: unknown }; me?: object } = {}): Harness {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'https://voltextech.net/markets', pretendToBeVisual: true });
  const g = global as any;
  const saved = { window: g.window, document: g.document, fetch: g.fetch, navigator: g.navigator, CustomEvent: g.CustomEvent, IS_REACT_ACT_ENVIRONMENT: g.IS_REACT_ACT_ENVIRONMENT };
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.window = dom.window; g.document = dom.window.document;
  g.CustomEvent = dom.window.CustomEvent;
  // React was loaded before JSDOM and selected its legacy input adapter.
  dom.window.HTMLElement.prototype.attachEvent = function (name: string, listener: EventListener) { this.addEventListener(name.slice(2), listener); };
  dom.window.HTMLElement.prototype.detachEvent = function (name: string, listener: EventListener) { this.removeEventListener(name.slice(2), listener); };
  const fetches: { url: string; body: any }[] = [];
  const response = opts.response ?? { status: 200, body: { ok: true } };
  g.fetch = async (url: string, init: RequestInit) => {
    fetches.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => response.body };
  };
  const getMe = jest.fn(async () => opts.me ?? { email: 'member@example.com', displayName: 'Olena' });
  const intervals = jest.spyOn(global, 'setInterval');

  const file = resolve(frontend, 'src/components/SupportWidget.tsx');
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} as any };
  const localRequire = (id: string) => {
    if (id === 'react') return React;
    if (id === '../lib/api') return { api: { getMe }, getToken: () => opts.token ?? null };
    if (id === '../lib/i18n') return { useLanguage: () => ({ t: (k: string) => k }) };
    if (id === '../lib/supportWidget') return require('../supportWidget');
    if (id === '../lib/supportEndpoint') return { SUPPORT_ENDPOINT: 'https://support.test/v1/support' };
    if (id === '../lib/supportForm') return require('../supportForm');
    if (id === '../lib/supportAssistant') return require('../supportAssistant');
    if (id === '../lib/i18n/locales/ru') return { RU };
    if (id === '../lib/i18n/locales/assistantRu') return { ASSISTANT_RU: copy };
    if (id.endsWith('.css')) return {};
    return req(id);
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', 'React', js)(localRequire, module, module.exports, React);
  const host = dom.window.document.getElementById('root')!;
  const root = createRoot(host);
  act(() => { root.render(React.createElement(module.exports.SupportWidget)); });

  const type = (selector: string, value: string) => {
    const el = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
    const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      Simulate.change(el);
    });
  };
  return {
    dom, host, fetches, getMe, intervals,
    launcher: () => host.querySelector('.support-launcher') as HTMLButtonElement,
    panel: () => host.querySelector('.support-panel'),
    type,
    submit: async () => {
      const form = host.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 0));
      });
    },
    cleanup: () => {
      act(() => root.unmount());
      intervals.mockRestore();
      dom.window.close(); // cancel JSDOM's deferred selection events before restoring globals
      Object.assign(g, saved);
    },
  };
}

async function open(h: Harness, specialist = true) {
  await act(async () => { h.launcher().click(); await new Promise(r => setTimeout(r, 0)); });
  if (specialist && h.panel()) await act(async () => { (h.host.querySelectorAll('.support-mode button')[1] as HTMLButtonElement).click(); });
}

function fill(h: Harness, v: Partial<SupportFormInput> = {}) {
  const x = { ...valid, ...v };
  h.type('input[autocomplete="name"]', x.name);
  h.type('input[type="email"]', x.email);
  h.type('textarea', x.message);
}

it('a guest: nothing is requested on mount or open; Send is one POST; success clears the message', async () => {
  const h = mountWidget({ token: null });
  expect(h.fetches).toHaveLength(0);
  await open(h);
  expect(h.panel()).not.toBeNull();
  expect(h.fetches).toHaveLength(0);
  expect(h.getMe).not.toHaveBeenCalled();   // a guest has no profile to read
  fill(h);
  await h.submit();
  expect(h.fetches).toHaveLength(1);
  expect(h.fetches[0].url).toBe('https://support.test/v1/support');
  expect(h.fetches[0].body).toMatchObject({ name: valid.name, email: valid.email, subject: 'TECHNICAL' });
  const text = h.panel()!.textContent;
  expect(text).toContain(copy.sent);
  expect(text).toContain(copy.sentHint);
  expect((h.host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  // Name and email stay, so a second question is one field away.
  expect((h.host.querySelector('input[type="email"]') as HTMLInputElement).value).toBe(valid.email);
  // No chat opened and nothing polls afterwards.
  expect(h.host.querySelector('.support-panel')!.querySelectorAll('[class*="bubble"]').length).toBe(0);
  expect(h.intervals).not.toHaveBeenCalled();
  await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  expect(h.fetches).toHaveLength(1);
  h.cleanup();
});

it.each([400, 429, 502, 503, 500])('HTTP %s keeps the draft and never shows success', async status => {
  const h = mountWidget({ token: null, response: { status, body: { ok: false } } });
  await open(h);
  fill(h);
  await h.submit();
  const text = h.panel()!.textContent;
  expect(text).toContain(RU['support.formFailed']);
  expect(text).not.toContain(copy.sent);
  expect((h.host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(valid.message);
  h.cleanup();
});

it('a signed-in user gets name and email prefilled from one profile read, only when they open the form', async () => {
  const h = mountWidget({ token: 'jwt', me: { email: 'member@example.com', displayName: 'Olena' } });
  expect(h.getMe).not.toHaveBeenCalled();   // not on page load
  await open(h);
  expect(h.getMe).toHaveBeenCalledTimes(1);
  expect((h.host.querySelector('input[type="email"]') as HTMLInputElement).value).toBe('member@example.com');
  expect((h.host.querySelector('input[autocomplete="name"]') as HTMLInputElement).value).toBe('Olena');
  // The address stays visible and editable, with the hint that replies go there.
  expect(h.panel()!.textContent).toContain(RU['support.formEmailHint']);
  // Closing and reopening does not read the profile again.
  await open(h); await open(h);
  expect(h.getMe).toHaveBeenCalledTimes(1);
  h.cleanup();
});

it('a double submit is one POST', async () => {
  const h = mountWidget({ token: null });
  await open(h);
  fill(h);
  const form = h.host.querySelector('form')!;
  await act(async () => {
    form.dispatchEvent(new h.dom.window.Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new h.dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
  });
  expect(h.fetches).toHaveLength(1);
  h.cleanup();
});

it('a name of spaces is caught before any request', async () => {
  const h = mountWidget({ token: null });
  await open(h);
  fill(h, { name: '   ' });
  await h.submit();
  expect(h.fetches).toHaveLength(0);
  expect(h.panel()!.textContent).toContain(RU['support.formCheck']);
  h.cleanup();
});

// ── local assistant and explicit handoff ────────────────────────────────────

it('FAQ opens with four suggestions, all 14 questions, no profile read and no timers/network', async () => {
  const h = mountWidget({ token: 'synthetic-session' });
  await open(h, false);
  expect(h.host.querySelectorAll('.support-suggestions button')).toHaveLength(4);
  expect(h.panel()!.getAttribute('lang')).toBe('ru');
  act(() => (h.host.querySelector('.support-all') as HTMLButtonElement).click());
  expect(h.host.querySelectorAll('#support-questions button')).toHaveLength(14);
  jest.useFakeTimers();
  const timeout = jest.spyOn(global, 'setTimeout');
  act(() => (h.host.querySelector('[data-assistant-intent="deposit_minimum"]') as HTMLButtonElement).click());
  expect(h.host.querySelector('.support-assistant-message')!.textContent).toContain('$500');
  expect(timeout).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(86_400_000));
  expect(h.fetches).toHaveLength(0);
  expect(h.getMe).not.toHaveBeenCalled();
  expect(h.intervals).not.toHaveBeenCalled();
  timeout.mockRestore(); jest.useRealTimers(); h.cleanup();
});

it('Ukrainian input produces Russian reply; context is appended only explicitly', async () => {
  const h = mountWidget();
  await open(h, false);
  h.type('.support-composer textarea', 'Не прийшов депозит'); await h.submit();
  const reply = h.host.querySelector('.support-assistant-message')!.textContent!;
  expect(reply).toContain('Проверьте'); expect(reply).not.toMatch(/[іїєґ]/i);
  expect(h.fetches).toHaveLength(0);
  act(() => (h.host.querySelector('.support-answer-actions button') as HTMLButtonElement).click());
  const draft = h.host.querySelector('.support-form textarea') as HTMLTextAreaElement;
  expect(draft.value).toBe('Не прийшов депозит');
  expect(draft.value).not.toContain('Проверьте');
  act(() => (h.host.querySelector('.support-message-meta button') as HTMLButtonElement).click());
  expect(draft.value).toContain('Ответ помощника: Проверьте');
  expect(h.fetches).toHaveLength(0); h.cleanup();
});

it.each(['Как работает стейкинг?', 'Хочу оператора', 'Не пришел депозит и вывод'])('handoff for %s is an editable unsent draft', async question => {
  const h = mountWidget(); await open(h, false);
  h.type('.support-composer textarea', question); await h.submit();
  expect((h.host.querySelector('.support-form textarea') as HTMLTextAreaElement).value).toBe(question);
  expect(h.panel()!.textContent).toContain(copy.handoff);
  expect(h.fetches).toHaveLength(0);
  fill(h, { message: question }); await h.submit();
  expect(h.fetches).toHaveLength(1);
  expect(h.fetches[0].body.message).toBe(question); h.cleanup();
});

it('secret-shaped input is not retained in history, copied to draft or sent', async () => {
  const h = mountWidget(); await open(h, false);
  const input = 'пароль: test-only-123';
  h.type('.support-composer textarea', input); await h.submit();
  expect((h.host.querySelector('.support-form textarea') as HTMLTextAreaElement).value).toBe('');
  expect(h.panel()!.textContent).toContain(copy.sensitive);
  fill(h, { message: input }); await h.submit();
  expect(h.fetches).toHaveLength(0);
  act(() => (h.host.querySelector('.support-mode button') as HTMLButtonElement).click());
  expect(h.panel()!.textContent).not.toContain(input);
  expect(h.panel()!.textContent).toContain(copy.hiddenMessage); h.cleanup();
});

it('Escape restores focus; clear removes history; session remount has no previous draft', async () => {
  const h = mountWidget(); h.launcher().focus(); await open(h, false);
  h.type('.support-composer textarea', 'Не пришел депозит'); await h.submit();
  act(() => (h.host.querySelector('.support-composer-footer button') as HTMLButtonElement).click());
  expect(h.host.querySelectorAll('.support-turn')).toHaveLength(0);
  act(() => h.dom.window.document.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape' })));
  expect(h.panel()).toBeNull(); expect(h.dom.window.document.activeElement).toBe(h.launcher());
  await open(h); fill(h); h.cleanup();
  const next = mountWidget({ token: 'another-synthetic-session' }); await open(next, false);
  expect(next.host.querySelectorAll('.support-turn')).toHaveLength(0);
  act(() => (next.host.querySelectorAll('.support-mode button')[1] as HTMLButtonElement).click());
  expect((next.host.querySelector('.support-form textarea') as HTMLTextAreaElement).value).toBe(''); next.cleanup();
});

it('existing external support action still opens specialist, not FAQ', async () => {
  const h = mountWidget();
  await act(async () => require('../supportWidget').openSupportWidget());
  expect(h.host.querySelector('.support-form')).not.toBeNull();
  expect(h.fetches).toHaveLength(0); h.cleanup();
});

// ── what must NOT be in the browser ─────────────────────────────────────────

it('local chat has no polling, persisted thread or Render support endpoint', () => {
  const widget = readFileSync(resolve(frontend, 'src/components/SupportWidget.tsx'), 'utf8');
  expect(widget).not.toMatch(/setInterval|setTimeout/);
  expect(widget).not.toMatch(/localStorage|sessionStorage/);
  expect(widget).not.toMatch(/\/support\/conversations|getSupportConversation|markSupportConversationRead/);
  const api = readFileSync(resolve(frontend, 'src/lib/api.ts'), 'utf8');
  expect(api).not.toMatch(/\/support\//);
  const endpoint = readFileSync(resolve(frontend, 'src/lib/supportEndpoint.ts'), 'utf8');
  expect(endpoint).toContain("'https://support.voltextech.net/v1/support'");
});

it('mail secrets, SMTP settings and support recipient configuration stay out of frontend code', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === 'node_modules' || name === '__tests__') continue;
      if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|js|html)$/.test(name)) files.push(p);
    }
  };
  walk(resolve(frontend, 'src'));
  files.push(resolve(frontend, 'index.html'));
  for (const f of files) {
    let s = readFileSync(f, 'utf8');
    if (f.replace(/\\/g, '/').endsWith('/pages/admin/DeleteUserDialog.tsx')) {
      // The existing owner-deletion refusal names an account identity, not
      // a mail destination. Permit only that exact guard; SMTP variables and
      // any additional occurrence remain covered by the scan.
      const ownerGuard = "return !user.isAdmin && user.email.trim().toLowerCase() !== 'voltex.crypto@gmail.com';";
      expect(s.split(ownerGuard)).toHaveLength(2);
      s = s.replace(ownerGuard, 'return ownerDeletionIsRefused;');
    }
    // (The KYC admin page names its own server variables in a hint; no value.)
    expect({ f, hit: /SMTP_PASS|SMTP_USER|SUPPORT_ADMIN_EMAIL|SUPPORT_FROM_EMAIL|voltex\.crypto@gmail\.com|app password/i.test(s) }).toEqual({ f, hit: false });
  }
});
