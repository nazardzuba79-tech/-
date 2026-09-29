import { byClass, byData, mountComponent, nodes, tick } from '../../../test-utils/terminalMount';

/**
 * The compact (archive) Futures ticket, owner 2026-09-29:
 *
 *   «Доступно … USDT (+)» above the price, and «TP / SL» as a checkbox
 *   beside «Только уменьшение».
 *
 * What must hold is that nothing here is decoration: the available figure is
 * the one the ticket sizes with, the «+» exists only with somewhere to go,
 * and TP/SL rides on the order only while its box is ticked — never under
 * Reduce Only, never on an engine that would ignore it.
 */

const FORM = 'components/FuturesOrderForm.tsx';

const tierConfig = {
  symbols: ['BTC/USDT'],
  minLeverage: 1,
  maxLeverage: 100,
  highLeverageWarningThreshold: 50,
  leverageTiers: [{ notionalCap: null, maxLeverage: 100, maintenanceMarginRate: 0.005 }],
};
const settled = <T,>(data: T) => ({ data, loading: false, refreshing: false, failed: false });
const account = {
  balances: settled([{ asset: 'USDT', available: '100000', balance: '100000' }]),
  positions: settled([]),
  positionHistory: settled([]),
  orders: settled([]),
};
const contractRules = {
  qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '100',
  maxMarketOrderQty: '50', minNotionalValue: '5',
  takerFeeRate: '0.00055', makerFeeRate: '0.0002',
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function compactTicket(opts: { entryProtection?: boolean; onTransfer?: () => void } = {}) {
  const placed = jest.fn().mockResolvedValue({});
  const form = mountComponent(FORM, {
    account,
    execution: { placeOrder: placed, entryProtection: opts.entryProtection ?? true, contract: contractRules },
    api: {
      getFuturesConfig: () => Promise.resolve(tierConfig),
      getFuturesMarkPrice: () => Promise.resolve({ markPrice: '80000' }),
    },
  });
  const props = { symbol: 'BTC/USDT', onPlaced: jest.fn(), executionEnabled: true, archive: true, onTransfer: opts.onTransfer };
  form.render(props);
  await tick();
  const render = () => form.render(props);
  const input = (tree: any, placeholder: string) => nodes(tree).find((n: any) => n.type === 'input' && n.props.placeholder === placeholder);
  let tree = render();
  input(tree, '0.00').props.onChange({ target: { value: '80000' } });
  input(render(), '0.000').props.onChange({ target: { value: '0.5' } });
  await tick();
  const tpslBox = (t: any) => byClass(t, 'fo-tpslToggle')[0]?.props.children[0];
  const reduceBox = (t: any) => byClass(t, 'fo-reduceOnlyRow')[0].props.children[0];
  const text = (n: any): string => (n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : Array.isArray(n) ? n.map(text).join('') : text(n.props?.children));
  return { placed, render, tpslBox, reduceBox, text };
}

describe('«Доступно» above the price', () => {
  it('prints the margin the ticket sizes with', async () => {
    const t = await compactTicket();
    const row = byClass(t.render(), 'fo-availRow')[0];
    expect(row.props['data-available-margin']).toBe('100000.00');
    expect(t.text(row)).toContain('100,000.00 USDT');
  });

  it('has a «+» only when the page gives it somewhere to go', async () => {
    expect(byClass((await compactTicket()).render(), 'fo-availTransfer')).toHaveLength(0);
    const onTransfer = jest.fn();
    const t = await compactTicket({ onTransfer });
    byClass(t.render(), 'fo-availTransfer')[0].props.onClick();
    expect(onTransfer).toHaveBeenCalledTimes(1);
  });
});

describe('«TP / SL» beside «Только уменьшение»', () => {
  it('starts unticked, and the levels are inert until it is ticked', async () => {
    const t = await compactTicket();
    const tree = t.render();
    expect(t.tpslBox(tree).props.checked).toBe(false);
    expect(byData(tree, 'data-entry-take-profit')[0].props.disabled).toBe(true);
  });

  it('sends the levels on the order only while ticked, with a hint for each', async () => {
    const t = await compactTicket();
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '90000' } });
    const tree = t.render();
    // 90 000 against an 80 000 limit for 0.5 BTC: +12.50%, ≈ +5,000.00 USDT.
    expect(t.text(byData(tree, 'data-tpsl-hint')[0])).toBe('+12.50% · ≈ +5,000.00 USDT');
    byClass(tree, 'buy')[0].props.onClick();
    await tick();
    expect(t.placed.mock.calls[0][0].protection).toEqual({ takeProfit: '90000', stopLoss: null });
  });

  it('keeps a typed level off the order once the box is unticked', async () => {
    const t = await compactTicket();
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '90000' } });
    t.tpslBox(t.render()).props.onChange({ target: { checked: false } });
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed).toHaveBeenCalledTimes(1);
    expect(t.placed.mock.calls[0][0]).not.toHaveProperty('protection');
  });

  it('is disabled, and its levels gone, under Reduce Only — and comes back after', async () => {
    const t = await compactTicket();
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '90000' } });
    t.reduceBox(t.render()).props.onChange({ target: { checked: true } });
    let tree = t.render();
    expect(t.tpslBox(tree).props.disabled).toBe(true);
    expect(t.tpslBox(tree).props.checked).toBe(false);
    expect(byData(tree, 'data-entry-take-profit')).toHaveLength(0);

    t.reduceBox(t.render()).props.onChange({ target: { checked: false } });
    tree = t.render();
    expect(t.tpslBox(tree).props.checked).toBe(true);
    expect(byData(tree, 'data-entry-take-profit')[0].props.value).toBe('90000');
  });

  it('does not exist on an engine that cannot arm protection with the order', async () => {
    const t = await compactTicket({ entryProtection: false });
    const tree = t.render();
    expect(byClass(tree, 'fo-tpslToggle')).toHaveLength(0);
    expect(byData(tree, 'data-entry-take-profit')).toHaveLength(0);
    expect(byClass(tree, 'fo-reduceOnlyRow')).toHaveLength(1);
  });
});

describe('numbers in the ticket are printed with a dot', () => {
  it('turns a typed comma into the dot the book and header use, in price, size and levels', async () => {
    const t = await compactTicket();
    const input = (placeholder: string) => nodes(t.render()).find((n: any) => n.type === 'input' && n.props.placeholder === placeholder);
    input('0.00').props.onChange({ target: { value: '12,91' } });
    expect(input('0.00').props.value).toBe('12.91');
    expect(input('0.00').props.type).toBe('text');
    input('0.000').props.onChange({ target: { value: '1,50' } });
    expect(input('0.000').props.value).toBe('1.50');
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '270,5' } });
    expect(byData(t.render(), 'data-entry-take-profit')[0].props.value).toBe('270.5');
  });
});

describe('invalid decimal drafts fail closed', () => {
  it.each(['1e-8', '1e3', '-1', '1.2.3', '12abc34'])('does not rewrite or submit invalid price %s', async (raw) => {
    const t = await compactTicket();
    const input = () => nodes(t.render()).find((n: any) => n.type === 'input' && n.props.placeholder === '0.00');
    input().props.onChange({ target: { value: raw } });
    expect(input().props.value).toBe(raw);
    const buy = byClass(t.render(), 'buy')[0];
    expect(buy.props.disabled).toBe(true);
    buy.props.onClick();
    await tick();
    expect(t.placed).not.toHaveBeenCalled();
  });

  it('keeps valid comma decimals and precision without changing their numeric value', async () => {
    const t = await compactTicket();
    const input = (placeholder: string) => nodes(t.render()).find((n: any) => n.type === 'input' && n.props.placeholder === placeholder);
    input('0.00').props.onChange({ target: { value: '0001,2500' } });
    expect(input('0.00').props.value).toBe('0001.2500');
    input('0.000').props.onChange({ target: { value: '0,00000001' } });
    expect(input('0.000').props.value).toBe('0.00000001');
    input('0.00').props.onChange({ target: { value: '123456789012345,6789' } });
    expect(input('0.00').props.value).toBe('123456789012345.6789');
  });

  it('treats empty and trailing-dot drafts as editing states, not executable orders', async () => {
    const t = await compactTicket();
    const input = () => nodes(t.render()).find((n: any) => n.type === 'input' && n.props.placeholder === '0.00');
    for (const raw of ['', '1.']) {
      input().props.onChange({ target: { value: raw } });
      expect(input().props.value).toBe(raw);
      expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(true);
    }
    expect(t.placed).not.toHaveBeenCalled();
  });

  it('refuses an invalid quantity and invalid armed TP/SL instead of mutating them', async () => {
    const t = await compactTicket();
    const qty = () => nodes(t.render()).find((n: any) => n.type === 'input' && n.props.placeholder === '0.000');
    qty().props.onChange({ target: { value: '-0.5' } });
    expect(qty().props.value).toBe('-0.5');
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(true);

    qty().props.onChange({ target: { value: '0.5' } });
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    const tp = () => byData(t.render(), 'data-entry-take-profit')[0];
    tp().props.onChange({ target: { value: '9e4' } });
    expect(tp().props.value).toBe('9e4');
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(true);
    expect(byClass(t.render(), 'sell')[0].props.disabled).toBe(true);
    expect(t.placed).not.toHaveBeenCalled();
  });
});

// ── TP/SL is there from the first frame on the simulation engine ─────────

import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as ts from 'typescript';
import { readNativeEngineHint, writeNativeEngineHint } from '../nativeEngineHint';

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); }, map } as any;
}
const jwt = (claims: object) => ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');

describe('the engine hint', () => {
  it('remembers the verdict per user, not per token, and forgets it for the real engine', () => {
    const store = memoryStorage();
    const a = jwt({ sub: 'user-1', sid: 'one' }), b = jwt({ sub: 'user-1', sid: 'two' }), other = jwt({ sub: 'user-2', sid: 'x' });
    expect(readNativeEngineHint(a, store)).toBe(false);
    writeNativeEngineHint(a, true, store);
    expect(readNativeEngineHint(b, store)).toBe(true);
    expect(readNativeEngineHint(other, store)).toBe(false);
    expect([...store.map.keys()].some((k: string) => k.includes(a) || k.includes('one'))).toBe(false);
    writeNativeEngineHint(b, false, store);
    expect(readNativeEngineHint(a, store)).toBe(false);
    expect(readNativeEngineHint('not-a-jwt', store)).toBe(false);
  });
});

function nativeExecutionHook() {
  const text = readFileSync(resolve(__dirname, '../useNativeFuturesExecution.ts'), 'utf8');
  const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  new Function('exports', 'require', code)(exports, (id: string) => {
    if (id === 'react') return { useMemo: (factory: () => unknown) => factory() };
    if (id === './futuresExecution') return { REAL_FUTURES_EXECUTION: { engine: 'REAL', entryProtection: false } };
    if (id === './nativeFuturesAdapter') return { nativeAccountState: () => null };
    if (id === './nativeReduceTarget') return { nativeOrderDraft: () => null };
    if (id === './privateTradingError') return { PrivateTradingError: Error };
    throw new Error(`Unexpected runtime import: ${id}`);
  });
  return exports.useNativeFuturesExecution;
}
const loading = (over: Record<string, unknown>) => ({
  binding: 'unknown', allowed: false, checked: false, stateLoaded: false, state: null, engineHint: false,
  candle: null, exitId: null, entryIntent: false, run: jest.fn(), execute: jest.fn(), getState: () => null,
  busy: false, initialize: jest.fn(), showCard: jest.fn(), ...over,
});

describe('a ticket that is still loading', () => {
  const hook = nativeExecutionHook();
  it('shows TP/SL before the verdict only for a user last bound to this engine', () => {
    expect(hook(loading({ engineHint: true }), null).entryProtection).toBe(true);
    expect(hook(loading({ engineHint: false }), null).entryProtection).toBe(false);
    expect(hook(loading({ binding: 'owner', checked: true, allowed: true }), null).entryProtection).toBe(true);
  });
  it('still takes no order until the engine is ready', async () => {
    const execution = hook(loading({ engineHint: true }), null);
    expect(execution.ready).toBe(false);
    await expect(execution.placeOrder({})).rejects.toThrow('Торговый счёт ещё не загружен');
  });
  it('drops the hint the moment the server says ordinary', () => {
    expect(hook(loading({ binding: 'ordinary', engineHint: true }), null)).toBeNull();
  });
});
