import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { JSDOM } = req('jsdom');
let dom: any, root: any, alertsModule: any, audio: jest.Mock, token: string | null, hidden: boolean, sessionListeners: Set<() => void>;
const cursors = (id: string) => ({ depositId: id, withdrawalId: null, kycId: null });
function Harness({ enabled, alerts }: any) { alertsModule.useAdminSummaryChime(enabled, alerts); return null; }
const render = (id: string | null, enabled = true) => React.act(async () => root.render(React.createElement(Harness, { enabled, alerts: id === null ? null : cursors(id) })));
beforeEach(() => {
  jest.useFakeTimers(); token = 'fixture-owner'; hidden = false; sessionListeners = new Set();
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/admin' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  audio = jest.fn(() => ({ currentTime: 0, destination: {}, close: jest.fn(),
    createOscillator: () => ({ frequency: {}, connect() {}, start() {}, stop() {} }),
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
  })); dom.window.AudioContext = audio;
  alertsModule = {};
  const code = ts.transpileModule(readFileSync(resolve(frontend, 'src/lib/useAdminAlerts.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(alertsModule, (name: string) => {
    if (name === 'react') return React;
    if (name === './browserActivity') return { isBrowserInactive: () => hidden };
    if (name === './api') return { getToken: () => token, onSessionChange: (fn: () => void) => { sessionListeners.add(fn); return () => sessionListeners.delete(fn); } };
    if (name === './adminAlertApi') return { getAdminAlertSummary: () => { throw new Error('Summary chime must not fetch a second alert endpoint'); } };
    if (name === './visibleRead') return { createVisibleRead: () => { throw new Error('Summary chime must not start its own polling'); } };
    throw new Error(`Unexpected import ${name}`);
  });
  root = req('react-dom/client').createRoot(document.getElementById('root'));
});
afterEach(async () => { await React.act(async () => root.unmount()); dom.window.close(); jest.useRealTimers(); delete (globalThis as any).window; delete (globalThis as any).document; delete (globalThis as any).localStorage; delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; });
test('first summary is silent; one changed cursor chimes exactly once without another network poll', async () => {
  await render('a'); expect(audio).not.toHaveBeenCalled(); await render('b'); expect(audio).toHaveBeenCalledTimes(1);
  await render('b'); expect(audio).toHaveBeenCalledTimes(1);
});
test('hidden and disabled views never chime', async () => {
  await render('a'); hidden = true; await render('b'); expect(audio).not.toHaveBeenCalled();
  hidden = false; await render('c', false); expect(audio).not.toHaveBeenCalled();
  await render('d'); expect(audio).not.toHaveBeenCalled();
});
test('a session replacement resets the baseline even when replacement arrives between renders', async () => {
  await render('a'); await React.act(async () => { token = 'fixture-next'; sessionListeners.forEach(fn => fn()); });
  await render('b'); expect(audio).not.toHaveBeenCalled(); await render('c'); expect(audio).toHaveBeenCalledTimes(1);
});
test('the existing persisted sound preference stays authoritative', async () => {
  localStorage.setItem('exchange_admin_alert_sound', '0'); await render('a'); await render('b'); expect(audio).not.toHaveBeenCalled();
});
