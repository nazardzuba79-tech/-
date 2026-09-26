import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { invalidSupportFields, sendSupportRequest, SUPPORT_LIMITS, type SupportFormInput } from '../supportForm';

/**
 * SUPPORT IS A FORM: ONE CLICK, ONE REQUEST, ONE EMAIL — AND NOTHING WHILE IDLE.
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
  const saved = { window: g.window, document: g.document, fetch: g.fetch, navigator: g.navigator };
  g.window = dom.window; g.document = dom.window.document;
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
      Object.assign(g, saved);
    },
  };
}

async function open(h: Harness) {
  await act(async () => { h.launcher().click(); await new Promise(r => setTimeout(r, 0)); });
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
  expect(text).toContain('support.formSent');
  expect(text).toContain('support.formSentHint');
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

it('a provider refusal shows the failure line, keeps the draft and never shows success', async () => {
  const h = mountWidget({ token: null, response: { status: 502, body: { ok: false, error: 'delivery_failed' } } });
  await open(h);
  fill(h);
  await h.submit();
  const text = h.panel()!.textContent;
  expect(text).toContain('support.formFailed');
  expect(text).not.toContain('support.formSent');
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
  expect(h.panel()!.textContent).toContain('support.formEmailHint');
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
  expect(h.panel()!.textContent).toContain('support.formCheck');
  h.cleanup();
});

// ── what must NOT be in the browser ─────────────────────────────────────────

it('the widget has no chat left: no polling, no stored thread, no Render support endpoint', () => {
  const widget = readFileSync(resolve(frontend, 'src/components/SupportWidget.tsx'), 'utf8');
  expect(widget).not.toMatch(/setInterval|setTimeout/);
  expect(widget).not.toMatch(/localStorage|sessionStorage/);
  expect(widget).not.toMatch(/\/support\/conversations|getSupportConversation|markSupportConversationRead/);
  const api = readFileSync(resolve(frontend, 'src/lib/api.ts'), 'utf8');
  expect(api).not.toMatch(/\/support\//);
  const endpoint = readFileSync(resolve(frontend, 'src/lib/supportEndpoint.ts'), 'utf8');
  expect(endpoint).toContain("'https://support.voltextech.net/v1/support'");
});

it('no mail secret, SMTP setting or recipient address lives anywhere in the frontend source', () => {
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
    const s = readFileSync(f, 'utf8');
    // (The KYC admin page names its own server variables in a hint; no value.)
    expect({ f, hit: /SMTP_PASS|SMTP_USER|SUPPORT_ADMIN_EMAIL|SUPPORT_FROM_EMAIL|voltex\.crypto@gmail\.com|app password/i.test(s) }).toEqual({ f, hit: false });
  }
});
