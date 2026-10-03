import { createRequire } from 'module';
import { resolve } from 'path';
import { startBrowserActivity, BROWSER_IDLE_MS, getBrowserPhase } from '../browserActivity';

const req = createRequire(resolve(__dirname, '../../../package.json'));
const { JSDOM } = req('jsdom');
let dom: any, stop: () => void, hidden: boolean;
beforeEach(() => {
  jest.useFakeTimers(); hidden = false;
  dom = new JSDOM('', { url: 'http://localhost/admin/users', pretendToBeVisual: true });
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => hidden });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
});
afterEach(() => { stop?.(); dom.window.close(); jest.useRealTimers(); delete (globalThis as any).window; delete (globalThis as any).document; });
function start() {
  stop = startBrowserActivity({ validate: async () => {}, identity: () => 'fixture-only',
    keepVisibleActive: () => /^\/admin(?:\/|$)/.test(window.location.pathname),
  } as Parameters<typeof startBrowserActivity>[0]);
}
test('a visible admin queue stays active beyond five minutes without pointer input', () => {
  start(); jest.advanceTimersByTime(BROWSER_IDLE_MS * 3); expect(getBrowserPhase()).toBe('active');
});
test('a hidden admin tab still sleeps immediately', () => {
  start(); hidden = true; document.dispatchEvent(new dom.window.Event('visibilitychange'));
  jest.advanceTimersByTime(BROWSER_IDLE_MS); expect(getBrowserPhase()).toBe('sleeping');
});
test.each(['/futures', '/trade', '/administer'])('ordinary idle behavior remains for %s', pathname => {
  dom.window.history.replaceState(null, '', pathname); start(); jest.advanceTimersByTime(BROWSER_IDLE_MS);
  expect(getBrowserPhase()).toBe('sleeping');
});
test('leaving an admin page restores normal inactivity sleep', () => {
  start(); jest.advanceTimersByTime(BROWSER_IDLE_MS); dom.window.history.replaceState(null, '', '/wallet');
  jest.advanceTimersByTime(BROWSER_IDLE_MS); expect(getBrowserPhase()).toBe('sleeping');
});
