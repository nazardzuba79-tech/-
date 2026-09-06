import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { spotOrderFeedback } from '../spotOrderFeedback';
import { positiveOrderNumber } from '../spotOrderEntry';

const cancelled = (originalQuantity: string, remainingQuantity: string, fills: string[] = []) => ({
  order: { status: 'CANCELLED', originalQuantity, remainingQuantity }, trades: fills.map(quantity => ({ quantity })),
});

describe('feedback follows actual order outcome rather than HTTP 201 alone', () => {
  test('empty MARKET SELL cancellation is not a successful placement', () => {
    expect(spotOrderFeedback(cancelled('0.001', '0.001'))).toEqual({ kind: 'cancelledEmpty' });
  });
  test.each(['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER', 'FILLED'])('recognized %s remains an accepted order', status => {
    expect(spotOrderFeedback({ order: { status }, trades: [] })).toEqual({ kind: 'placed' });
  });
  test('partially filled, then cancelled market order reports exact real filled/remainder', () => {
    expect(spotOrderFeedback(cancelled('0.3', '0.1', ['0.05', '0.15']))).toEqual({ kind: 'cancelledPartial', filled: '0.2', remaining: '0.1' });
    expect(spotOrderFeedback(cancelled('3e-8', '1e-8', ['2e-8']))).toEqual({ kind: 'cancelledPartial', filled: '0.00000002', remaining: '0.00000001' });
    expect(spotOrderFeedback(cancelled('9007199254740993', '9007199254740992', ['1']))).toEqual({ kind: 'cancelledPartial', filled: '1', remaining: '9007199254740992' });
  });
  test.each([undefined, {}, { order: { status: 'UNKNOWN' } }, cancelled('0.3', '0.1', ['0.1']), cancelled('0', '0'), cancelled('NaN', '0'), cancelled('1', '2'), cancelled('1e9999', '0')])('unknown/inconsistent response never announces success (%j)', response => {
    expect(spotOrderFeedback(response)).toEqual({ kind: 'unknown' });
  });
  test('response is never changed', () => {
    const response = cancelled('0.3', '0.1', ['0.2']); const before = JSON.stringify(response);
    spotOrderFeedback(response); expect(JSON.stringify(response)).toBe(before);
  });
});

describe('actual OrderForm submit handler', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../components/OrderForm.tsx'), 'utf8');
  const handler = source.slice(source.indexOf('  async function handleSubmit('), source.indexOf('  // Keep every order family reachable.'));
  const code = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  function fixture(response: unknown) {
    const toast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
    const bindings = { api: { placeOrder: jest.fn().mockResolvedValue(response) }, toast,
      t: (key: string, values?: unknown) => key + (values ? JSON.stringify(values) : ''),
      spotOrderFeedback, positiveOrderNumber, submittingRef: { current: false },
      setError: jest.fn(), setSubmitting: jest.fn(), resetFields: jest.fn(), onPlaced: jest.fn(), setBalanceVersion: jest.fn(),
      quantity: '0.001', family: 'MARKET', type: 'MARKET', price: '', triggerPrice: '',
      isConditional: false, execution: 'MARKET', side: 'SELL', pair: 'BTC/USDT', baseAsset: 'BTC',
      ocoTakeProfitPrice: '', ocoStopTriggerPrice: '', ocoStopLimitPrice: '', ApiError: Error };
    const submit = new Function(...Object.keys(bindings), code + '\nreturn handleSubmit;')(...Object.values(bindings));
    return { ...bindings, submit };
  }
  test('201/CANCELLED with no fill shows non-success, preserves input and refreshes persisted state', async () => {
    const f = fixture(cancelled('0.001', '0.001')); await f.submit({ preventDefault() {} });
    expect(f.toast.success).not.toHaveBeenCalled();
    expect(f.toast.error).toHaveBeenCalledWith('trade.orderCancelledNoFill');
    expect(f.setError).toHaveBeenLastCalledWith('trade.orderCancelledNoFill');
    expect(f.resetFields).not.toHaveBeenCalled();
    expect(f.onPlaced).toHaveBeenCalledTimes(1); expect(f.setBalanceVersion).toHaveBeenCalledTimes(1);
    expect(f.api.placeOrder).toHaveBeenCalledWith({ pair: 'BTC/USDT', side: 'SELL', type: 'MARKET', price: undefined, triggerPrice: undefined, quantity: '0.001' });
    expect(f.submittingRef.current).toBe(false);
  });
  test('partial cancellation is informative with real quantities, never a full-success toast', async () => {
    const f = fixture(cancelled('0.001', '0.0006', ['0.0004'])); await f.submit({ preventDefault() {} });
    expect(f.toast.success).not.toHaveBeenCalled();
    expect(f.toast.info).toHaveBeenCalledWith('trade.orderPartiallyFilledCancelled{"filled":"0.0004","remaining":"0.0006","asset":"BTC"}');
    expect(f.resetFields).toHaveBeenCalledTimes(1);
  });
  test('accepted order retains existing positive feedback', async () => {
    const f = fixture({ order: { status: 'FILLED' }, trades: [{ quantity: '0.001' }] }); await f.submit({ preventDefault() {} });
    expect(f.toast.success).toHaveBeenCalledWith('trade.orderPlaced'); expect(f.resetFields).toHaveBeenCalledTimes(1);
  });
  test('unknown response is explicitly unconfirmed, not success', async () => {
    const f = fixture({}); await f.submit({ preventDefault() {} });
    expect(f.toast.success).not.toHaveBeenCalled(); expect(f.toast.info).toHaveBeenCalledWith('trade.orderStatusUnconfirmed');
  });
  test('conditional Limit/Market controls expose their actual pressed state', () => {
    expect(source).toContain("aria-pressed={execution === 'LIMIT'}");
    expect(source).toContain("aria-pressed={execution === 'MARKET'}");
  });
  test('all seven supported languages have each new outcome message and partial quantities', () => {
    const translations = fs.readFileSync(path.resolve(__dirname, '../i18n.tsx'), 'utf8');
    for (const key of ['trade.orderCancelledNoFill', 'trade.orderPartiallyFilledCancelled', 'trade.orderStatusUnconfirmed']) {
      expect(translations.split(`'${key}':`).length - 1).toBe(7);
    }
    for (const line of translations.split('\n').filter(line => line.includes("'trade.orderPartiallyFilledCancelled':"))) {
      for (const placeholder of ['{filled}', '{remaining}', '{asset}']) expect(line).toContain(placeholder);
    }
  });
});
