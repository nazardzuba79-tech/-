import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import ts from 'typescript';
import { readNext } from '../returnTo';
import { readDictionaries } from '../../../test-utils/i18nSource';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const REFERRAL = 'exchange_referral_code';
type Element = { type: any; props: Record<string, any> };

/** Exercise the real component callbacks with isolated hook state. Browser
 * fixture QA separately covers actual DOM layout, focus and navigation. No
 * server, credential, real account or network request is used by this suite. */
function mount(file: string, exportName: string) {
  const state: any[] = [];
  let cursor = 0;
  let mounted = false;
  let effects: (() => void)[] = [];
  const hooks = {
    ...React,
    useState(initial: any) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
      return [state[slot], (value: any) => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
    },
    useEffect(effect: () => void) { if (!mounted) effects.push(effect); },
  };
  const api = { login: jest.fn(), loginWith2FA: jest.fn(), register: jest.fn() };
  const setToken = jest.fn();
  const navigate = jest.fn();
  const support = jest.fn();
  const localize = jest.fn(() => 'LOCALIZED_SERVER_ERROR');
  const passthrough = ({ children }: any) => children;
  const shell = { AuthShell: passthrough, AuthFormIcon: passthrough, AuthTabs: passthrough, AuthSupport: passthrough };
  const overrides: Record<string, any> = {
    react: hooks,
    'react-router-dom': { useNavigate: () => navigate, Link: passthrough },
  };
  const load = (name: string): any => {
    if (name in overrides) return overrides[name];
    if (name.endsWith('/api')) return { api, setToken };
    if (name.endsWith('/i18n')) return { useLanguage: () => ({ t: (key: string) => key }) };
    if (name.endsWith('/tradingMode')) return { defaultTradingPath: () => '/trade' };
    if (name.endsWith('/returnTo')) return { readNext };
    if (name.endsWith('/supportWidget')) return { openSupportWidget: support };
    if (name.endsWith('/customerError')) return { customerErrorText: localize };
    if (name.endsWith('/ReferralRedirectPage')) return { REFERRAL_CODE_STORAGE_KEY: REFERRAL };
    if (name.endsWith('/AuthShell')) return shell;
    if (name.endsWith('/AuthFields')) return { AuthField: passthrough, AuthPasswordField: passthrough };
    return req(name);
  };
  const code = ts.transpileModule(readFileSync(resolve(frontend, file), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', code)(load, exports);
  let tree: Element;
  const render = () => {
    cursor = 0;
    tree = exports[exportName]();
    const pending = effects;
    effects = [];
    mounted = true;
    pending.forEach(effect => effect());
    return tree;
  };
  const all = (): Element[] => {
    const result: Element[] = [];
    const visit = (node: any) => {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node || typeof node !== 'object' || !node.props) return;
      result.push(node);
      visit(node.props.children);
    };
    visit(tree);
    return result;
  };
  const find = (predicate: (node: Element) => boolean) => {
    const found = all().find(predicate);
    if (!found) throw new Error(`Missing element in ${exportName}`);
    return found;
  };
  const change = (id: string, value: string) => {
    const node = find(n => n.props.id === id && typeof n.props.onChange === 'function');
    node.props.onChange(node.type === 'input' ? { target: { value } } : value);
    render();
  };
  const submit = async () => {
    await find(n => n.type === 'form').props.onSubmit({ preventDefault: jest.fn() });
    render();
  };
  render();
  render(); // mount effects apply the existing referral before interaction.
  return { api, setToken, navigate, support, localize, render, all, find, change, submit };
}

const login = () => mount('src/pages/AuthPage.tsx', 'AuthPage');
const register = () => mount('src/pages/register/RegisterPanel.tsx', 'RegisterPanel');
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '?next=%2Fwallet' } } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
});
afterEach(() => {
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('login submits real credentials and honors a safe return destination', async () => {
  const app = login();
  app.change('login-email', 'fixture@example.test');
  app.change('login-password', 'Password123');
  app.api.login.mockResolvedValue({ token: 'fixture-session' });
  await app.submit();
  expect(app.api.login).toHaveBeenCalledWith('fixture@example.test', 'Password123');
  expect(app.setToken).toHaveBeenCalledWith('fixture-session');
  expect(app.navigate).toHaveBeenCalledWith('/wallet');
});

test('login blocks an external return target and falls back to the existing terminal', async () => {
  window.location.search = '?next=https%3A%2F%2Fevil.example';
  const app = login();
  app.api.login.mockResolvedValue({ token: 'fixture-session' });
  await app.submit();
  expect(app.navigate).toHaveBeenCalledWith('/trade');
});

test('login failure stays localized, leaves no session, and enables retry', async () => {
  const app = login();
  const failure = new Error('do not display backend text');
  app.api.login.mockRejectedValueOnce(failure).mockResolvedValueOnce({ token: 'retry-session' });
  await app.submit();
  expect(app.localize).toHaveBeenCalledWith(failure, expect.any(Function), 'auth.genericError');
  expect(app.find(n => n.props.role === 'alert').props.children).toContain('LOCALIZED_SERVER_ERROR');
  expect(app.find(n => n.props.type === 'submit').props.disabled).toBe(false);
  expect(app.setToken).not.toHaveBeenCalled();
  await app.submit();
  expect(app.setToken).toHaveBeenCalledWith('retry-session');
  expect(app.all().some(n => n.props.role === 'alert')).toBe(false);
});

test('2FA does not issue a session before code verification, and supports retry', async () => {
  const app = login();
  app.api.login.mockResolvedValue({ requires2fa: true, pendingToken: 'pending-fixture' });
  await app.submit();
  expect(app.setToken).not.toHaveBeenCalled();
  expect(app.navigate).not.toHaveBeenCalled();
  app.change('login-2fa', '123456');
  app.api.loginWith2FA.mockRejectedValueOnce(new Error('invalid code')).mockResolvedValueOnce({ token: 'verified-fixture' });
  await app.submit();
  expect(app.setToken).not.toHaveBeenCalled();
  expect(app.find(n => n.props.type === 'submit').props.disabled).toBe(false);
  await app.submit();
  expect(app.api.loginWith2FA).toHaveBeenLastCalledWith('pending-fixture', '123456');
  expect(app.setToken).toHaveBeenCalledWith('verified-fixture');
  expect(app.navigate).toHaveBeenCalledWith('/wallet');
});

test('back from 2FA restores the password form without creating a session', async () => {
  const app = login();
  app.api.login.mockResolvedValue({ requires2fa: true, pendingToken: 'pending-fixture' });
  await app.submit();
  app.find(n => n.type === 'button' && n.props.children === 'auth.backToLogin').props.onClick();
  app.render();
  expect(app.find(n => n.props.id === 'login-password')).toBeDefined();
  expect(app.all().some(n => n.props.id === 'login-2fa')).toBe(false);
  expect(app.setToken).not.toHaveBeenCalled();
});

test.each(['', 'Short1', 'longlowercasepassword'])('registration blocks invalid password %j without a request', async password => {
  const app = register();
  app.change('reg-email', 'fixture@example.test');
  app.change('reg-password', password);
  expect(app.find(n => n.props.type === 'submit').props.disabled).toBe(true);
  await app.submit();
  expect(app.api.register).not.toHaveBeenCalled();
  expect(app.setToken).not.toHaveBeenCalled();
});

test('registration blocks invalid email and exposes associated validation', async () => {
  const app = register();
  app.change('reg-email', 'invalid');
  app.change('reg-password', 'Password123');
  await app.submit();
  expect(app.api.register).not.toHaveBeenCalled();
  const input = app.find(n => n.type === 'input' && n.props.id === 'reg-email');
  expect(input.props['aria-invalid']).toBe(true);
  expect(input.props['aria-describedby']).toBe('reg-email-error');
});

test('registration retains referral on error and consumes it only with the real session', async () => {
  storage.set(REFERRAL, 'fixture-ref');
  const app = register();
  app.change('reg-email', ' fixture@example.test ');
  app.change('reg-password', 'ПарольДлинный');
  app.api.register.mockRejectedValueOnce(new Error('service unavailable')).mockResolvedValueOnce({ token: 'registered-fixture' });
  await app.submit();
  expect(app.api.register).toHaveBeenCalledWith('fixture@example.test', 'ПарольДлинный', 'fixture-ref');
  expect(storage.get(REFERRAL)).toBe('fixture-ref');
  expect(app.setToken).not.toHaveBeenCalled();
  expect(app.find(n => n.props.type === 'submit').props.disabled).toBe(false);
  expect(app.find(n => n.props.role === 'alert').props.children).toContain('LOCALIZED_SERVER_ERROR');
  await app.submit();
  expect(storage.has(REFERRAL)).toBe(false);
  expect(app.setToken).toHaveBeenCalledWith('registered-fixture');
  expect(app.navigate).toHaveBeenCalledWith('/wallet', { replace: true });
});

test('signup keeps both legal destinations without adding a blocking checkbox', () => {
  const app = register();
  expect(app.all().some(n => n.props.to === '/legal/terms')).toBe(true);
  expect(app.all().some(n => n.props.to === '/legal/privacy')).toBe(true);
  expect(app.all().some(n => n.props.type === 'checkbox')).toBe(false);
});

test('approved Russian copy and all newly introduced keys exist in every supported locale', () => {
  const dictionaries = readDictionaries();
  const keys = ['registerTitle', 'registerSubtitle', 'context', 'communityCount', 'communityText', 'communityBadge', 'cardCaption', 'supportHint', 'supportLink'];
  for (const dictionary of Object.values(dictionaries)) {
    for (const key of keys) expect(dictionary[`authShell.${key}`]?.trim().length).toBeGreaterThan(0);
  }
  expect(dictionaries.ru['authShell.lead']).toBe('Один аккаунт. Рынки, копитрейдинг и управление активами в единой платформе.');
  expect(dictionaries.ru['authShell.communityCount']).toBe('1,2+ млн инвесторов');
  expect(dictionaries.ru['authShell.hero.line1']).toBe('Копируйте сделки');
  expect(dictionaries.ru['authShell.hero.line2']).toBe('лучших трейдеров');
  expect(dictionaries.ru['authShell.hero.line3']).toBe('мира.');
});
