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
} = {}) {
  const placed = jest.fn().mockResolvedValue({});
  const form = mountComponent(FORM, {
    account,
    execution: { placeOrder: placed, entryProtection: opts.entryProtection ?? true, contract: opts.contract === undefined ? contractRules : opts.contract },
    api: {
      getFuturesConfig: () => Promise.resolve(tierConfig),
      getFuturesMarkPrice: () => Promise.resolve({ markPrice: '80000' }),
    },
  });
  const props = {
    symbol: 'BTC/USDT', onPlaced: jest.fn(), executionEnabled: true, archive: opts.archive ?? true,
    onTransfer: opts.onTransfer, ...(opts.lastPrice !== undefined ? { lastPrice: opts.lastPrice } : {}),
  };
  form.render(props);
  await tick();
  const render = () => form.render(props);
  const input = (tree: any, placeholder: string) => nodes(tree).find((n: any) => n.type === 'input' && n.props.placeholder === placeholder);
  if (opts.price !== '') input(render(), '0.00').props.onChange({ target: { value: opts.price ?? '80000' } });
  // The size placeholder follows the ticket: 0.000 BTC on the compact one.
  if (opts.quantity !== '') input(render(), props.archive ? '0.000' : '0.00000').props.onChange({ target: { value: opts.quantity ?? '0.5' } });
  await tick();
  const tpslBox = (t: any) => byClass(t, 'fo-tpslToggle')[0]?.props.children[0];
  const reduceBox = (t: any) => byClass(t, 'fo-reduceOnlyRow')[0].props.children[0];
  const text = (n: any): string => (n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : Array.isArray(n) ? n.map(text).join('') : text(n.props?.children));
  return { placed, render, tpslBox, reduceBox, text, input };
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

/**
 * Owner review of #332 (HOLD): the reader deleted what it did not expect, so
 * «1e-8» became a price of 18. The fields now keep what was typed; text that
 * is not a number is refused beside the field and never reaches an order.
 */
describe('number fields keep what was typed and never send what they cannot read', () => {
  type Field = 'price' | 'quantity' | 'takeProfit' | 'stopLoss';
  const FIELDS: Field[] = ['price', 'quantity', 'takeProfit', 'stopLoss'];
  const ATTR = { takeProfit: 'data-entry-take-profit', stopLoss: 'data-entry-stop-loss' } as const;
  function fieldOf(t: Awaited<ReturnType<typeof compactTicket>>, tree: any, field: Field) {
    if (field === 'price') return t.input(tree, '0.00');
    if (field === 'quantity') return t.input(tree, '0.000');
    return byData(tree, ATTR[field])[0];
  }
  async function typed(field: Field, value: string, opts: Parameters<typeof compactTicket>[0] = {}) {
    const t = await compactTicket(opts);
    if (field === 'takeProfit' || field === 'stopLoss') t.tpslBox(t.render())?.props.onChange({ target: { checked: true } });
    fieldOf(t, t.render(), field).props.onChange({ target: { value } });
    await tick();
    return t;
  }
  /** Both buttons, Enter on the form, and blur first: nothing is sent. */
  async function sendsNothing(t: Awaited<ReturnType<typeof compactTicket>>) {
    const tree = t.render();
    expect(byClass(tree, 'buy')[0].props.disabled).toBe(true);
    expect(byClass(tree, 'sell')[0].props.disabled).toBe(true);
    byClass(tree, 'buy')[0].props.onClick();
    byClass(t.render(), 'sell')[0].props.onClick();
    nodes(t.render()).find((n: any) => n.type === 'form').props.onSubmit({ preventDefault() {} });
    await tick();
    expect(t.placed).not.toHaveBeenCalled();
  }

  // The review's cases first, then more of the same kind a paste can bring.
  const REFUSED: [string, string][] = [
    ['1e-8', 'exponent'], ['1e3', 'exponent'], ['-1', 'sign'], ['1.2.3', 'separator'], ['12abc34', 'character'],
    ['−5', 'sign'], ['+5', 'sign'], ['1,234.5', 'separator'], ['1 000', 'character'], ['Infinity', 'character'], ['１２', 'character'],
  ];
  for (const field of FIELDS) {
    it.each(REFUSED)(`${field}: «%s» stays as typed, is refused (%s), and sends no order`, async (value, reason) => {
      const t = await typed(field, value);
      // Leaving the field does not repair it either.
      fieldOf(t, t.render(), field).props.onBlur?.();
      const tree = t.render();
      const el = fieldOf(t, tree, field);
      expect(el.props.value).toBe(value);
      expect(el.props['aria-invalid']).toBe(true);
      const note = byData(tree, 'data-input-refusal').find((n: any) => n.props.id === el.props['aria-describedby']);
      expect(note.props['data-input-refusal']).toBe(reason);
      expect(t.text(note)).toBe(`futures.number${reason[0].toUpperCase()}${reason.slice(1)}`);
      await sendsNothing(t);
    });
  }

  it('a pasted value is read the same way as a typed one — whole, and refused whole', async () => {
    // A paste arrives as one change carrying the field's new text.
    const t = await typed('price', '80 000,50 USDT');
    expect(t.input(t.render(), '0.00').props.value).toBe('80 000,50 USDT');
    await sendsNothing(t);
    t.input(t.render(), '0.00').props.onChange({ target: { value: '  80000,50  ' } });
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed.mock.calls[0][0].price).toBe('80000.50');
  });

  it('comma decimals, leading zeros and trailing zeros reach the order as the same numbers', async () => {
    const t = await compactTicket({ price: '0080000,5', quantity: '000,500' });
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '90000,25' } });
    byData(t.render(), 'data-entry-stop-loss')[0].props.onChange({ target: { value: '070000,75' } });
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    const order = t.placed.mock.calls[0][0];
    expect(order.price).toBe('80000.5');
    expect(order.quantity).toBe('0.500');
    expect(order.protection).toEqual({ takeProfit: '90000.25', stopLoss: '70000.75' });
  });

  it('small values are sent digit for digit', async () => {
    const t = await compactTicket({ contract: null, price: '0.00001234', quantity: '1000000' });
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '0,00001500' } });
    byData(t.render(), 'data-entry-stop-loss')[0].props.onChange({ target: { value: '0.00000999' } });
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    const order = t.placed.mock.calls[0][0];
    expect(order.price).toBe('0.00001234');
    expect(order.quantity).toBe('1000000');
    expect(order.protection).toEqual({ takeProfit: '0.00001500', stopLoss: '0.00000999' });
  });

  it('large precise values are sent digit for digit, not through a float', async () => {
    const t = await compactTicket({ contract: null, price: '123456789.123456789', quantity: '0.0001' });
    t.tpslBox(t.render()).props.onChange({ target: { checked: true } });
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '123456790.000000001' } });
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    const order = t.placed.mock.calls[0][0];
    expect(order.price).toBe('123456789.123456789');
    expect(order.quantity).toBe('0.0001');
    expect(order.protection).toEqual({ takeProfit: '123456790.000000001', stopLoss: null });
  });

  it('an empty or half-typed field is not an error, and is not an order either', async () => {
    for (const [field, value] of [['quantity', ''], ['quantity', '.'], ['price', ','], ['takeProfit', '.']] as [Field, string][]) {
      const t = await typed(field, value);
      const tree = t.render();
      expect(fieldOf(t, tree, field).props['aria-invalid']).toBeUndefined();
      expect(byData(tree, 'data-input-refusal')).toHaveLength(0);
      await sendsNothing(t);
    }
    // Finishing the number is all it takes: «12.» and «,5» are numbers.
    const t = await compactTicket({ price: '80000.', quantity: ',5' });
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed.mock.calls[0][0]).toMatchObject({ price: '80000', quantity: '0.5' });
  });

  it('a refused level stops the order only while TP/SL rides on it', async () => {
    const t = await typed('takeProfit', '1e3');
    await sendsNothing(t);
    // Unticked: the level is off the order, so it cannot block or be sent.
    t.tpslBox(t.render()).props.onChange({ target: { checked: false } });
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed).toHaveBeenCalledTimes(1);
    expect(t.placed.mock.calls[0][0]).not.toHaveProperty('protection');
  });

  it('a refused level is explained by its own note, not as a level on the wrong side', async () => {
    const t = await typed('stopLoss', '-1');
    const said = t.text(t.render());
    expect(said).toContain('futures.numberSign');
    expect(said).not.toContain('futures.orderError.triggerPrice');
    // A readable level wrong for both sides (at the price itself) still gets
    // the side note.
    byData(t.render(), 'data-entry-stop-loss')[0].props.onChange({ target: { value: '80000' } });
    expect(t.text(t.render())).toContain('futures.orderError.triggerPrice');
  });

  it('a refused level is never swapped for the one typed before it', async () => {
    const t = await typed('takeProfit', '90000');
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '9e4' } });
    await sendsNothing(t);
  });

  it('leaving a field writes a number the terminal way and leaves anything else as typed', async () => {
    const t = await compactTicket({ price: '80000,50', quantity: '007' });
    t.input(t.render(), '0.00').props.onBlur();
    t.input(t.render(), '0.000').props.onBlur();
    expect(t.input(t.render(), '0.00').props.value).toBe('80000.50');
    expect(t.input(t.render(), '0.000').props.value).toBe('7');
    t.input(t.render(), '0.00').props.onChange({ target: { value: '8e4' } });
    t.input(t.render(), '0.00').props.onBlur();
    expect(t.input(t.render(), '0.00').props.value).toBe('8e4');
  });

  it('a price the terminal fills in is plain digits, never refused', async () => {
    const t = await compactTicket({ lastPrice: 1e-7, price: '', quantity: '' });
    const price = t.input(t.render(), '0.00');
    expect(price.props.value).toBe('0.0000001');
    expect(price.props['aria-invalid']).toBeUndefined();
  });

  it('the standard ticket refuses the same way', async () => {
    const t = await compactTicket({ archive: false });
    byData(t.render(), 'data-entry-take-profit')[0].props.onChange({ target: { value: '1e-8' } });
    const tree = t.render();
    const tp = byData(tree, 'data-entry-take-profit')[0];
    expect(tp.props.value).toBe('1e-8');
    expect(tp.props['aria-invalid']).toBe(true);
    expect(byData(tree, 'data-input-refusal')[0].props['data-input-refusal']).toBe('exponent');
    await sendsNothing(t);
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
