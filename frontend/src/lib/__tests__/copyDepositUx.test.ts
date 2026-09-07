import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import ts from 'typescript';
import { nazarTrader, marketplaceTraders } from '../../pages/copy-trading-bolt/traders';
import { restoreCopyButtonDepositUx, restoreCopyDepositUx } from '../../../test-utils/copyDepositUx';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const read = (file: string) => readFileSync(resolve(frontend, file), 'utf8').replace(/\r\n/g, '\n');
const source = read('src/pages/copy-trading-bolt/components.tsx');
const ast = ts.createSourceFile('components.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function body(name: string): string {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  if (!node) throw new Error(`Missing actual component ${name}`);
  return node.getText(ast);
}
function compile(text: string, dependencies: Record<string, unknown> = {}, imports: Record<string, unknown> = {}) {
  const compiled = ts.transpileModule(text, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const output: Record<string, any> = {};
  const load = (name: string) => name.endsWith('.css') ? {} : imports[name] ?? req(name);
  new Function('exports', 'require', ...Object.keys(dependencies), compiled)(output, load, ...Object.values(dependencies));
  return output;
}
const eligibility = compile(read('src/pages/copy-trading-bolt/CopyEligibilityContext.tsx'));
const ordinary = marketplaceTraders.find(item => item.id !== nazarTrader.id)!;

// Execute the ACTUAL JSX click handlers, not a reimplementation of the guard.
// Hook state and Following are isolated local UI fixtures; no account/API calls.
function copyFixture(depositUsd: number, alreadyFollowing = false, trader = ordinary) {
  const following = new Set<string>(alreadyFollowing ? [trader.id] : []);
  const toggle = jest.fn((id: string) => following.has(id) ? following.delete(id) : following.add(id));
  const toast = { success: jest.fn() };
  let show = false;
  const DepositDialog = () => null;
  const actual = compile(body('CopyButton') + '\nexports.CopyButton = CopyButton;', {
    useCopyEligibility: () => eligibility.CopyEligibilityProvider({ depositUsd, children: null }).props.value,
    useFollowing: () => ({ following, toggleFollowing: toggle }),
    useState: () => [show, (next: boolean) => { show = next; }],
    nazarTrader, CopyDepositDialog: DepositDialog, Check: () => null, toast,
  });
  const render = () => actual.CopyButton({ trader, compact: true });
  const children = () => {
    const node = render();
    return node.type === 'button' ? [node] : node.props.children;
  };
  const button = () => children()[0];
  const dialog = () => children()[1];
  return { render, button, dialog, toggle, toast, following, DepositDialog };
}

// Review retains its existing provider policy; this UX pass does not import
// main's separate nonfinite/admin-policy changes into the isolated review.
test.each([0, -1, 19_999, 19_999.99, NaN, -Infinity])('deposit %s opens requirement only on click without starting Following', deposit => {
  const fixture = copyFixture(deposit);
  expect(fixture.button().props.disabled).not.toBe(true);
  expect(fixture.button().props.children).toBe('Копировать трейдера');
  expect(fixture.dialog()).toBe(false);
  const stopPropagation = jest.fn();
  fixture.button().props.onClick({ stopPropagation });
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(fixture.dialog().type).toBe(fixture.DepositDialog);
  expect(fixture.toggle).not.toHaveBeenCalled();
  expect(fixture.toast.success).not.toHaveBeenCalled();
  expect([...fixture.following]).toEqual([]);
  fixture.dialog().props.onClose();
  expect(fixture.dialog()).toBe(false);
  expect(fixture.toggle).not.toHaveBeenCalled();
});

test('review eligibility provider and threshold policy are unchanged by the click-only presentation', () => {
  const before = 'a1f6beb81d4126cbd91e20bdf7d9f9f801d08ee13dd6272bf9f7aa3df4f20ce6';
  expect(createHash('sha256').update(read('src/pages/copy-trading-bolt/CopyEligibilityContext.tsx')).digest('hex')).toBe(before);
});

test.each([20_000, 20_000.01, 200_000])('deposit %s preserves existing eligible start and stop actions', deposit => {
  const fixture = copyFixture(deposit);
  const stopPropagation = jest.fn();
  fixture.button().props.onClick({ stopPropagation });
  expect(fixture.dialog()).toBe(false);
  expect(fixture.toggle).toHaveBeenNthCalledWith(1, ordinary.id);
  expect([...fixture.following]).toEqual([ordinary.id]);
  expect(fixture.toast.success).toHaveBeenNthCalledWith(1, `Вы копируете ${ordinary.name}`, {
    description: `Комиссия за результат ${Math.round(ordinary.performanceFee * 100)}%. Средства остаются на вашем счёте VOLTEX.`,
  });
  expect(fixture.button().props.className).toContain('button-copy-active');
  fixture.button().props.onClick({ stopPropagation });
  expect(fixture.toggle).toHaveBeenNthCalledWith(2, ordinary.id);
  expect(fixture.following.size).toBe(0);
  expect(fixture.toast.success).toHaveBeenNthCalledWith(2, `Копирование ${ordinary.name} остановлено`, { description: undefined });
  expect(stopPropagation).toHaveBeenCalledTimes(2);
});

test('insufficient funds do not alter an already-followed local entry', () => {
  const fixture = copyFixture(0, true);
  fixture.button().props.onClick({ stopPropagation: jest.fn() });
  expect(fixture.dialog().type).toBe(fixture.DepositDialog);
  expect([...fixture.following]).toEqual([ordinary.id]);
  expect(fixture.toggle).not.toHaveBeenCalled();
});

test('unavailable Nazar conditions retain the separate disabled-data safety guard', () => {
  for (const deposit of [0, 20_000]) {
    const fixture = copyFixture(deposit, false, { ...nazarTrader, performanceFee: NaN });
    expect(fixture.button().props.disabled).toBe(true);
    expect(fixture.button().props.title).toBe('Условия стратегии недоступны');
    expect(fixture.button().props.children).toBe('Данные недоступны');
    expect(fixture.button().props.onClick).toBeUndefined();
    expect(fixture.toggle).not.toHaveBeenCalled();
  }
});

function dialogFixture() {
  const effects: (() => void | (() => void))[] = [];
  class FakeHTMLElement { isConnected = true; focus = jest.fn(); }
  const previousFocus = new FakeHTMLElement();
  const closeFocus = jest.fn();
  const native = { open: false, showModal: jest.fn(), close: jest.fn(), querySelector: jest.fn(() => ({ focus: closeFocus })) };
  native.showModal.mockImplementation(() => { native.open = true; });
  native.close.mockImplementation(() => { native.open = false; });
  const documentFixture = { body: { style: { overflow: 'scroll' } }, activeElement: previousFocus };
  const Link = () => null;
  const portal = jest.fn((node, target) => ({ node, target }));
  const close = jest.fn();
  const actual = compile(read('src/pages/copy-trading-bolt/CopyDepositDialog.tsx'), { document: documentFixture, HTMLElement: FakeHTMLElement }, {
    react: { useEffect: (effect: () => void) => effects.push(effect), useRef: () => ({ current: native }), useId: () => 'dialog-title-id' },
    'react-dom': { createPortal: portal },
    'react-router-dom': { Link },
  });
  const rendered = actual.CopyDepositDialog({ onClose: close });
  return { ...rendered, native, documentFixture, previousFocus, closeFocus, Link, portal, close, effects };
}

test('native dialog has exactly the approved message and a same-origin existing deposit entry', () => {
  const fixture = dialogFixture();
  const [heading, actions] = fixture.node.props.children;
  expect(fixture.node.type).toBe('dialog');
  expect(fixture.node.props['aria-labelledby']).toBe(heading.props.id);
  expect(heading.props.children).toBe('Копировать этого трейдера можно при депозите от $20 000.');
  expect(fixture.target).toBe(fixture.documentFixture.body);
  expect(actions.props.children).toHaveLength(2);
  const [link, close] = actions.props.children;
  expect(link.type).toBe(fixture.Link);
  expect(link.props.to).toBe('/wallet?action=deposit');
  expect(link.props.children).toBe('Пополнить депозит');
  expect(close.props.children).toBe('Закрыть');
  expect(close.props.type).toBe('button');
  expect(close.props.autoFocus).toBeUndefined();
  link.props.onClick();
  close.props.onClick();
  expect(fixture.close).toHaveBeenCalledTimes(2);
  const wallet = read('src/pages/WalletPage.tsx');
  expect(wallet).toContain("const action = searchParams.get('action')");
  expect(wallet).toContain("if (action === 'deposit' || action === 'withdraw' || action === 'transfer') setModal(action)");
});

test('dialog uses native modality/focus, Escape cancellation and event isolation, and restores scroll on cleanup', () => {
  const fixture = dialogFixture();
  expect(fixture.effects).toHaveLength(1);
  const cleanup = fixture.effects[0]();
  expect(fixture.native.showModal).toHaveBeenCalledTimes(1);
  expect(fixture.native.open).toBe(true);
  expect(fixture.native.querySelector).toHaveBeenCalledWith('button');
  expect(fixture.closeFocus).toHaveBeenCalledTimes(1);
  expect(fixture.previousFocus.focus).not.toHaveBeenCalled();
  expect(fixture.documentFixture.body.style.overflow).toBe('hidden');
  const stopPropagation = jest.fn();
  fixture.node.props.onClick({ stopPropagation });
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  const preventDefault = jest.fn();
  fixture.node.props.onCancel({ preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(fixture.close).toHaveBeenCalledTimes(1);
  if (typeof cleanup !== 'function') throw new Error('Missing dialog cleanup');
  cleanup();
  expect(fixture.native.close).toHaveBeenCalledTimes(1);
  expect(fixture.documentFixture.body.style.overflow).toBe('scroll');
  expect(fixture.previousFocus.focus).toHaveBeenCalledTimes(1);
});

test('dialog cleanup does not focus a trigger removed by route navigation', () => {
  const fixture = dialogFixture();
  const cleanup = fixture.effects[0]();
  fixture.previousFocus.isConnected = false;
  if (typeof cleanup !== 'function') throw new Error('Missing dialog cleanup');
  cleanup();
  expect(fixture.previousFocus.focus).not.toHaveBeenCalled();
});

test('normal Copy surfaces have no permanent deposit requirement; only the click dialog contains it', () => {
  expect(source).not.toMatch(/function EligibilityGate|<EligibilityGate|className="access-strip"|className="deposit-status"/);
  expect(source).not.toMatch(/Минимальный депозит:|Депозит от \$20 000|Разблокируйте копитрейдинг|Копирование доступно клиентам с депозитом/);
  expect(body('Profile')).toContain('<div><CopyButton trader={trader} /></div></div>');
  expect(body('TraderCard')).toContain('<CopyButton trader={trader} compact />');
  expect(body('Marketplace')).toContain('<span>Откройте профиль трейдера и нажмите «Копировать трейдера».</span>');
  expect(body('Marketplace')).not.toMatch(/depositUsd|useCopyEligibility/);
  const css = read('src/pages/copy-trading-bolt/CopyDepositDialog.css');
  expect(css).toContain('calc(100vw - 32px)');
  expect(css).toContain('max-height: calc(100dvh - 32px)');
  expect(css).toContain('overflow-y: auto');
  expect(css).toContain(':focus-visible');
  expect(css).toContain('::backdrop');
  expect(css).not.toMatch(/\.global-header|\.trader-card|\.profile-chart|\.daily-plot|\.eligibility/);
  const dialog = read('src/pages/copy-trading-bolt/CopyDepositDialog.tsx');
  expect(dialog).not.toMatch(/\b(?:api|fetch|localStorage|sessionStorage|balance|ledger)\b|toggleFollowing|setToken/);
});

test('normalization only reverses exact approved UX edits, never hides copy-action or financial drift', () => {
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const approved = 'cd2ed289d64d986e9355f26557e9428ff19c98b7bf6f5246576cf861e0afa2ce';
  expect(hash(restoreCopyButtonDepositUx(body('CopyButton')))).toBe(approved);
  const wrongAction = body('CopyButton').replace('toggleFollowing(trader.id)', 'toggleFollowing("wrong-trader")');
  expect(hash(restoreCopyButtonDepositUx(wrongAction))).not.toBe(approved);
  const changedMoney = source.replace('trader.performanceFee * 100', 'trader.performanceFee * 101');
  expect(restoreCopyDepositUx(changedMoney)).toContain('trader.performanceFee * 101');
  expect(() => restoreCopyDepositUx(source.replace('setShowDepositRequirement(true); return;', 'setShowDepositRequirement(true);'))).toThrow('Expected one Copy UX anchor');
});
