import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
const requireFrontend = createRequire(resolve(__dirname, '../../../package.json'));
const React = requireFrontend('react');
const { createRoot } = requireFrontend('react-dom/client');
const { JSDOM } = requireFrontend('jsdom');
const { act } = React;
const source = readFileSync(resolve(__dirname, '../useOrderTicketAccess.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

test('real hook: unknown/failure denied, exact session scoped, latest access response wins', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = globalThis as any;
  const previous = { window: globals.window, document: globals.document, act: globals.IS_REACT_ACT_ENVIRONMENT };
  globals.window = dom.window; globals.document = dom.window.document; globals.IS_REACT_ACT_ENVIRONMENT = true;
  let token: string | null = 'allowed-session';
  let sessionChanged = () => {};
  const requests: { resolve: (result: { allowed: boolean }) => void; reject: (error: Error) => void }[] = [];
  const exported: any = {};
  new Function('require', 'exports', code)((name: string) => name === 'react' ? React : {
    getToken: () => token,
    onSessionChange: (listener: () => void) => { sessionChanged = listener; return () => {}; },
    request: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  }, exported);
  let access: any;
  function Probe() { access = exported.useOrderTicketAccess(); return null; }
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Probe)));
    expect(access.allowed).toBe(false); expect(access.canSubmit()).toBe(false);
    await act(async () => requests[0].resolve({ allowed: true }));
    expect(access.canSubmit()).toBe(true);
    // Token changed before React's session event/render: old callback still refuses.
    const oldCallback = access.canSubmit;
    token = 'viewer-session';
    expect(oldCallback()).toBe(false);
    await act(async () => sessionChanged());
    expect(access.allowed).toBe(false);
    await act(async () => requests[1].resolve({ allowed: false }));
    expect(access.canSubmit()).toBe(false);
    await act(async () => { token = 'allowed-again'; sessionChanged(); });
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    // Most recent response denies; an older grant cannot overwrite it.
    await act(async () => requests[3].resolve({ allowed: false }));
    await act(async () => requests[2].resolve({ allowed: true }));
    expect(access.canSubmit()).toBe(false);
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    await act(async () => requests[4].reject(new Error('offline')));
    expect(access.canSubmit()).toBe(false);
    await act(async () => { token = null; sessionChanged(); });
    expect(access.canSubmit()).toBe(false);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    globals.window = previous.window; globals.document = previous.document; globals.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
