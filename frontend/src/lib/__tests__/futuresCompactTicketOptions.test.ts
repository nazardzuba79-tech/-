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

async function compactTicket(opts: {
  entryProtection?: boolean; onTransfer?: () => void; archive?: boolean;
  contract?: typeof contractRules | null; lastPrice?: number; price?: string; quantity?: string;
  pickedPrice?: string; execution?: Record<string, unknown>;
} = {}) {
  const placed = jest.fn().mockResolvedValue({});
  const form = mountComponent(FORM, {
    account,
    execution: { placeOrder: placed, entryProtection: opts.entryProtection ?? true,
      contract: opts.contract === undefined ? contractRules : opts.contract, ...opts.execution },
    api: {
      getFuturesConfig: () => Promise.resolve(tierConfig),
      getFuturesMarkPrice: () => Promise.resolve({ markPrice: '80000' }),
    },
  });
  const props = { symbol: 'BTC/USDT', onPlaced: jest.fn(), executionEnabled: true,
    archive: opts.archive ?? true, onTransfer: opts.onTransfer, lastPrice: opts.lastPrice, pickedPrice: opts.pickedPrice };
  form.render(props);
  await tick();
  const render = () => form.render(props);
  const input = (tree: any, placeholder: string) => nodes(tree).find((n: any) => n.type === 'input' && n.props.placeholder === placeholder);
  let tree = render();
  if (opts.price !== '') input(tree, '0.00').props.onChange({ target: { value: opts.price ?? '80000' } });
  if (opts.quantity !== '') input(render(), props.archive ? '0.000' : '0.00000').props.onChange({ target: { value: opts.quantity ?? '0.5' } });
  await tick();
  const tpslBox = (t: any) => byClass(t, 'fo-tpslToggle')[0]?.props.children[0];
  const reduceBox = (t: any) => byClass(t, 'fo-reduceOnlyRow')[0].props.children[0];
  const text = (n: any): string => (n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : Array.isArray(n) ? n.map(text).join('') : text(n.props?.children));
  return { placed, render, tpslBox, reduceBox, text, input: (placeholder: string) => input(render(), placeholder) };
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

describe('decimal refusal explains the field without changing its draft', () => {
  const reasons = [
    ['1e-8', 'exponent', 'futures.numberExponent'],
    ['1e3', 'exponent', 'futures.numberExponent'],
    ['-1', 'sign', 'futures.numberSign'],
    ['1.2.3', 'separator', 'futures.numberSeparator'],
    ['12abc34', 'character', 'futures.numberCharacter'],
    ['1,2\n', 'character', 'futures.numberCharacter'],
  ] as const;

  describe.each(['price', 'quantity', 'TP', 'SL'] as const)('%s', field => {
    it.each(reasons)('keeps %s visible, links its %s refusal and blocks both buttons and Enter', async (raw, reason, key) => {
      const t = await compactTicket();
      t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
      const input = () => field === 'price' ? t.input('0.00')
        : field === 'quantity' ? t.input('0.000')
        : byData(t.render(), field === 'TP' ? 'data-entry-take-profit' : 'data-entry-stop-loss')[0];
      input().props.onChange({ target: { value: raw } });
      const tree = t.render();
      expect(input().props.value).toBe(raw);
      expect(input().props['aria-invalid']).toBe(true);
      const notes = byData(tree, 'data-input-refusal');
      expect(notes).toHaveLength(1);
      expect(notes[0].props['data-input-refusal']).toBe(reason);
      expect(notes[0].props.id).toBe(input().props['aria-describedby']);
      expect(t.text(notes[0])).toBe(key);
      for (const cls of ['buy', 'sell']) {
        const button = byClass(tree, cls)[0];
        expect(button.props.disabled).toBe(true);
        button.props.onClick();
      }
      nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault: jest.fn() });
      await tick();
      expect(t.placed).not.toHaveBeenCalled();
      expect(t.text(tree)).not.toContain('futures.orderError.triggerPrice');
    });
  });

  it('uses the same per-field refusal and submission guard on the standard ticket', async () => {
    const t = await compactTicket({ archive: false });
    for (const input of [t.input('0.00'), t.input('0.00000'),
      byData(t.render(), 'data-entry-take-profit')[0], byData(t.render(), 'data-entry-stop-loss')[0]]) {
      input.props.onChange({ target: { value: '1e-8' } });
    }
    const notes = byData(t.render(), 'data-input-refusal');
    expect(notes).toHaveLength(4);
    expect(new Set(notes.map(note => note.props.id)).size).toBe(4);
    for (const note of notes) expect(t.text(note)).toBe('futures.numberExponent');
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(true);
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed).not.toHaveBeenCalled();
  });

  it('tidies only valid drafts on blur, preserving fractional precision and incomplete inputs', async () => {
    const t = await compactTicket();
    for (const raw of ['1e-7', '-1', '1.2.3', '12abc34', '.', '1.', '']) {
      t.input('0.00').props.onChange({ target: { value: raw } });
      t.input('0.00').props.onBlur();
      expect(t.input('0.00').props.value).toBe(raw);
      expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(true);
    }
    t.input('0.00').props.onChange({ target: { value: '0001,25000000000000001' } });
    expect(t.input('0.00').props.value).toBe('0001.25000000000000001');
    t.input('0.00').props.onBlur();
    expect(t.input('0.00').props.value).toBe('1.25000000000000001');
    expect(t.input('0.00').props['aria-invalid']).toBeUndefined();
    expect(t.input('0.00').props['aria-describedby']).toBeUndefined();
    expect(byData(t.render(), 'data-input-refusal')).toHaveLength(0);
  });

  it('keeps incomplete armed levels non-executable, while empty levels remain optional', async () => {
    const t = await compactTicket();
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    for (const raw of ['.', '1.']) {
      byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: raw } });
      expect(byData(t.render(), 'data-input-refusal')).toHaveLength(0);
      expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(true);
    }
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '' } });
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(false);
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed.mock.calls[0][0]).not.toHaveProperty('protection');
  });

  it('ignores an invalid TP/SL draft once unticked, and refuses it again when re-armed', async () => {
    const t = await compactTicket();
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '9e4' } });
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(true);
    t.tpslBox(t.render()).props.onChange({ target: { checked: false } });
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(false);
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    expect(byData(t.render(), 'data-entry-take-profit')[0].props.value).toBe('9e4');
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(true);
    t.tpslBox(t.render()).props.onChange({ target: { checked: false } });
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed.mock.calls[0][0]).not.toHaveProperty('protection');
  });

  it('keeps numeric and direction validation for readable protection levels', async () => {
    const t = await compactTicket();
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    for (const raw of ['0', '80000', '9'.repeat(400)]) {
      byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: raw } });
      expect(byData(t.render(), 'data-input-refusal')).toHaveLength(0);
      expect(t.text(t.render())).toContain('futures.orderError.triggerPrice');
      expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(true);
      expect(byClass(t.render(), 'sell')[0].props.disabled).toBe(true);
    }
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '90000' } });
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(false);
    expect(byClass(t.render(), 'sell')[0].props.disabled).toBe(true);
  });
});

describe('programmatic prices can execute at their full decimal precision', () => {
  it('auto-seeds a tiny last price as plain digits and submits that exact LIMIT price', async () => {
    const t = await compactTicket({ lastPrice: 1e-7, price: '', quantity: '100000000', contract: null });
    expect(t.input('0.00').props.value).toBe('0.0000001');
    expect(t.input('0.00').props['aria-invalid']).toBeUndefined();
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(false);
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed).toHaveBeenCalledTimes(1);
    expect(t.placed.mock.calls[0][0]).toMatchObject({ type: 'LIMIT', price: '0.0000001', quantity: '100000000' });
  });

  it('Last Price replaces a refused manual exponent with the actual plain-decimal quote', async () => {
    const t = await compactTicket({ lastPrice: 1.5e-7, quantity: '100000000', contract: null });
    t.input('0.00').props.onChange({ target: { value: '1.5e-7' } });
    expect(t.input('0.00').props.value).toBe('1.5e-7');
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(true);
    byClass(t.render(), 'fo-lastPriceBtn')[0].props.onClick();
    expect(t.input('0.00').props.value).toBe('0.00000015');
    expect(byData(t.render(), 'data-input-refusal')).toHaveLength(0);
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(false);
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed.mock.calls[0][0]).toMatchObject({ type: 'LIMIT', price: '0.00000015', quantity: '100000000' });
  });

  it('keeps every digit of a programmatic order-book level', async () => {
    const t = await compactTicket({ pickedPrice: '1.23456789123456789e-7', price: '', quantity: '100000000', contract: null });
    expect(t.input('0.00').props.value).toBe('0.000000123456789123456789');
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(false);
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed.mock.calls[0][0]).toMatchObject({ price: '0.000000123456789123456789', quantity: '100000000' });
  });

  it('submits exact typed price, quantity and protection strings without float rounding', async () => {
    const t = await compactTicket({ price: '0001,23456789123456789', quantity: '0,123456789123456789', contract: null });
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '0002,34567891234567891' } });
    byData(t.render(), 'data-entry-stop-loss')[0].props.onChange({ target: { value: '0,987654321987654321' } });
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(false);
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed.mock.calls[0][0]).toMatchObject({
      price: '1.23456789123456789', quantity: '0.123456789123456789',
      protection: { takeProfit: '2.34567891234567891', stopLoss: '0.987654321987654321' },
    });
  });

  it('writes a selected historical candle as plain digits and retains its authoritative payload', async () => {
    const candle = { symbol: 'BTC/USDT', interval: '1m', openTime: 123000 };
    const t = await compactTicket({ price: '', quantity: '100000000', execution: {
      engine: 'NATIVE', candle, candlePrice: '1.23456789123456789e-7',
    } });
    expect(t.input('0.00').props.value).toBe('0.000000123456789123456789');
    expect(t.input('0.00').props.readOnly).toBe(true);
    expect(byClass(t.render(), 'buy')[0].props.disabled).toBe(false);
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed.mock.calls[0][0]).toMatchObject({ price: '0.000000123456789123456789', quantity: '100000000', candle });
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
