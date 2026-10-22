import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { act } = React;
const { JSDOM } = req('jsdom');
const supportOpened = jest.fn();
const source = readFileSync(resolve(frontend, 'src/pages/knowledge/KnowledgeMobileSupport.tsx'), 'utf8');
const exportsForTest: Record<string, any> = {};
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
new Function('exports', 'require', compiled)(exportsForTest, (name: string) => {
  if (name.endsWith('.css')) return {};
  if (name.endsWith('/lib/i18n')) return { useLanguage: () => ({ t: (key: string) => key === 'support.title' ? 'Поддержка' : key }) };
  if (name.endsWith('/lib/supportWidget')) return { openSupportWidget: supportOpened };
  if (name === 'lucide-react') return { Headset: () => React.createElement('svg', { 'aria-hidden': true }) };
  return req(name);
});

let dom: any, root: any, host: HTMLElement;
beforeEach(() => {
  supportOpened.mockClear();
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://voltextech.net/academy' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  host = document.getElementById('root')!;
  root = req('react-dom/client').createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); jest.useRealTimers(); });

test('an accessible in-flow action opens the existing support only on explicit click', async () => {
  jest.useFakeTimers();
  await act(async () => root.render(React.createElement(exportsForTest.KnowledgeMobileSupport)));
  const button = host.querySelector('[data-kb-inline-support] button') as HTMLButtonElement;
  expect(button).not.toBeNull();
  expect(button.textContent).toBe('Поддержка');
  expect(button.type).toBe('button');
  expect(button.getAttribute('aria-haspopup')).toBe('dialog');
  expect(button.getAttribute('aria-controls')).toBe('voltex-assistant-panel');
  await act(async () => jest.advanceTimersByTime(60 * 60_000));
  expect(supportOpened).not.toHaveBeenCalled();
  await act(async () => button.click());
  expect(supportOpened).toHaveBeenCalledTimes(1);
});

test('CSS hides only a closed launcher on narrow reading pages with a rendered replacement', () => {
  const css = readFileSync(resolve(frontend, 'src/pages/knowledge/knowledgeMobileSupport.css'), 'utf8');
  const postcss = req('postcss');
  const sheet = postcss.parse(css);
  const launcherRules: any[] = [];
  sheet.walkRules((rule: any) => { if (rule.selector.includes('.support-launcher')) launcherRules.push(rule); });
  expect(launcherRules).toHaveLength(1);
  const rule = launcherRules[0];
  expect(rule.selector).toBe("body:has(.vx-kb-page [data-kb-inline-support]) .support-launcher[aria-expanded='false']");
  expect(rule.parent.name).toBe('media');
  expect(rule.parent.params).toBe('(max-width: 900px)');
  expect(rule.nodes.map((n: any) => [n.prop, n.value, n.important])).toEqual([['display', 'none', true]]);
  const ownRules: any[] = [];
  sheet.walkRules((r: any) => ownRules.push(r));
  for (const r of ownRules.filter(r => r !== rule)) expect(r.selector).toMatch(/^\.vx-kb(?:-mobile-support|\s+\.vx-kb-mobile-support)/);
  expect(css).not.toMatch(/\.support-panel|\.global-header|\.bottom-nav|--(?:bg|panel|text-primary)\s*:/);
  expect(source).not.toMatch(/fetch\(|api\.|setInterval|setTimeout|localStorage|sessionStorage/);
});

test('all Academy and Help pages share the replacement without changing their content', () => {
  const shell = readFileSync(resolve(frontend, 'src/pages/knowledge/KnowledgeShell.tsx'), 'utf8');
  expect(shell).toContain('<main className="vx-kb"><KnowledgeMobileSupport />{children}</main>');
  expect(shell).toContain('<div className="vx-kb-footer"><Footer /></div>');
});
