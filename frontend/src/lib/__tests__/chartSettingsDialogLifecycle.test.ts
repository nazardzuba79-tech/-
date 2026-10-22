import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as settings from '../chartSettings';

// Exercise the actual component, hooks, portal and settings store. Only
// translation and CSS loading are stubbed; no server or order API is used.
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const globalKeys = ['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'] as const;
let previous: Map<string, PropertyDescriptor | undefined>;
let dom: any;
let root: any;
let Dialog: any;
let closed: jest.Mock;

beforeEach(() => {
  previous = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  dom = new JSDOM('<button id="opener">Settings</button><button id="behind">Trading action</button><div id="root"></div>',
    { url: 'https://chart-settings.invalid', pretendToBeVisual: true });
  const values: Record<string, unknown> = { window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  for (const key of globalKeys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: values[key] });
  settings.resetChartSettingsCache();
  root = req('react-dom/client').createRoot(document.getElementById('root'));
  closed = jest.fn(() => root.render(null));
  const output: any = {};
  const code = ts.transpileModule(readFileSync(resolve(frontend, 'src/components/ChartSettingsDialog.tsx'), 'utf8'),
    { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(output, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name === '../lib/chartSettings') return settings;
    if (name === '../lib/chartIndicators') return require('../chartIndicators');
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
    return req(name);
  });
  Dialog = output.ChartSettingsDialog;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  settings.resetChartSettingsCache();
  dom.window.close();
  for (const key of globalKeys) {
    const descriptor = previous.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as any)[key];
  }
});

async function mount() {
  document.getElementById('opener')!.focus();
  await act(async () => root.render(React.createElement(Dialog, { onClose: closed })));
}
async function click(element: Element) {
  await act(async () => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
}
async function classic() {
  const button = Array.from(document.querySelectorAll('.vcs-presets button'))
    .find(element => element.textContent?.includes('chart.settings.preset.classic'))!;
  expect(button).toBeDefined();
  await click(button);
  expect(settings.getChartSettings().preset).toBe('classic');
}
async function key(value: string, shiftKey = false): Promise<KeyboardEvent> {
  const event = new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
  await act(async () => document.dispatchEvent(event));
  return event;
}

test('changing the route or pair discards an unsaved preview when the dialog unmounts', async () => {
  await mount();
  await classic();
  expect(localStorage.getItem(settings.CHART_SETTINGS_KEY)).toBeNull();
  await act(async () => root.unmount());
  root = null;
  expect(settings.getChartSettings()).toEqual(settings.DEFAULT_CHART_SETTINGS);
  expect(settings.getSavedChartSettings()).toEqual(settings.DEFAULT_CHART_SETTINGS);
  expect(localStorage.getItem(settings.CHART_SETTINGS_KEY)).toBeNull();
});

test('Ok keeps the saved preset even though closing the dialog runs cleanup', async () => {
  await mount();
  await classic();
  await click(document.querySelector('.vcs-ok')!);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(settings.getChartSettings().preset).toBe('classic');
  expect(JSON.parse(localStorage.getItem(settings.CHART_SETTINGS_KEY)!).preset).toBe('classic');
});

test('Tab and Shift+Tab wrap inside the modal instead of reaching the trading ticket', async () => {
  await mount();
  const first = document.querySelector<HTMLElement>('.vcs-close')!;
  const last = document.querySelector<HTMLElement>('.vcs-ok')!;
  last.focus();
  expect((await key('Tab')).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(first);
  expect((await key('Tab', true)).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(last);
  document.getElementById('behind')!.focus();
  expect((await key('Tab')).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(first);
});

test('Escape rolls the preview back and restores focus without a trading action', async () => {
  const trade = jest.fn();
  document.getElementById('behind')!.addEventListener('click', trade);
  await mount();
  await classic();
  expect((await key('Escape')).defaultPrevented).toBe(true);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(settings.getChartSettings()).toEqual(settings.DEFAULT_CHART_SETTINGS);
  expect(document.activeElement).toBe(document.getElementById('opener'));
  expect(trade).not.toHaveBeenCalled();
});
