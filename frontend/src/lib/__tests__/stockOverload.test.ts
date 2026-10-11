import { StockOverloadCircuit, stockCooldownMs, stockOverloadCode, stockOverloadText } from '../../pages/stocks/global/overload';
import type { StockReadResult } from '../../pages/stocks/global/overload';
import { StockSessionFence, rememberStockOrder } from '../../pages/stocks/global/accountSession';

const ready = async (): Promise<StockReadResult> => ({ kind: 'ready' });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
afterEach(() => jest.useRealTimers());

test('safe localized overload codes clamp cooldown hints and cannot expose server text', () => {
  expect(stockOverloadCode('secret token 123')).toBeNull();
  expect(stockOverloadText('RATE_LIMIT')).toContain('Лимит'.toLowerCase());
  expect(stockOverloadText('ACCOUNT_BUSY')).toContain('Тестовый счёт занят');
  expect(stockCooldownMs('RATE_LIMIT', 1)).toBe(60000);
  expect(stockCooldownMs('ACCOUNT_BUSY', -5)).toBe(3000);
  expect(stockCooldownMs('ACCOUNT_BUSY', Infinity)).toBe(3000);
  expect(stockCooldownMs('SOURCE_BUSY', 99999999)).toBe(60000);
});

test('cooldown never creates an automatic retry and repeated manual clicks start at most one read pair', async () => {
  const changed = jest.fn(), circuit = new StockOverloadCircuit(changed, () => false), state = jest.fn(ready), history = jest.fn(ready);
  circuit.trip('RATE_LIMIT');
  expect(await circuit.recover(state, history)).toBe(false);
  jest.advanceTimersByTime(60000);
  expect(state).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled(); expect(circuit.paused).toBe(true);
  const first = circuit.recover(state, history), second = circuit.recover(state, history);
  expect(await first).toBe(true); expect(await second).toBe(false);
  expect(state).toHaveBeenCalledTimes(1); expect(history).toHaveBeenCalledTimes(1); expect(circuit.paused).toBe(false);
  jest.advanceTimersByTime(600000); expect(state).toHaveBeenCalledTimes(1); expect(history).toHaveBeenCalledTimes(1);
});

test('HTTP200 with old quote overload allows one timer tick and one read-only follow-up', async () => {
  const circuit = new StockOverloadCircuit(jest.fn(), () => false);
  const state = jest.fn<Promise<StockReadResult>, []>().mockResolvedValueOnce({ kind: 'prior-overload', code: 'RATE_LIMIT' }).mockResolvedValueOnce({ kind: 'ready' });
  const history = jest.fn(ready); circuit.trip('RATE_LIMIT'); jest.advanceTimersByTime(60000);
  const recovery = circuit.recover(state, history); await flush();
  expect(circuit.paused).toBe(true); expect(state).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(3499); await flush(); expect(state).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1); expect(await recovery).toBe(true);
  expect(state).toHaveBeenCalledTimes(2); expect(history).toHaveBeenCalledTimes(1); expect(circuit.paused).toBe(false);
});

test('persistent200 errors and direct overload failures relatch without an infinite retry loop', async () => {
  const circuit = new StockOverloadCircuit(jest.fn(), () => false);
  const state = jest.fn(async (): Promise<StockReadResult> => ({ kind: 'prior-overload', code: 'ACCOUNT_BUSY' }));
  const history = jest.fn(ready); circuit.trip('ACCOUNT_BUSY'); jest.advanceTimersByTime(3000);
  const recovery = circuit.recover(state, history); await flush(); jest.advanceTimersByTime(3500);
  expect(await recovery).toBe(false); expect(circuit.state?.retryAt).toBe(9500);
  jest.advanceTimersByTime(600000); expect(state).toHaveBeenCalledTimes(2); expect(history).toHaveBeenCalledTimes(1); expect(circuit.paused).toBe(true);
  const rejected = jest.fn(async (): Promise<StockReadResult> => ({ kind: 'overload', code: 'RATE_LIMIT', retryAfterMs: 60000 }));
  expect(await circuit.recover(ready, rejected)).toBe(false); expect(circuit.state?.code).toBe('RATE_LIMIT');
  expect(rejected).toHaveBeenCalledTimes(1);
});

test.each(['hidden', 'account-switch', 'unmount'] as const)('%s cancels delayed recovery and ignores late responses', async reason => {
  let hidden = false;
  const changed = jest.fn(), circuit = new StockOverloadCircuit(changed, () => hidden);
  const state = jest.fn(async (): Promise<StockReadResult> => ({ kind: 'prior-overload', code: 'ACCOUNT_BUSY' }));
  circuit.trip('ACCOUNT_BUSY'); jest.advanceTimersByTime(3000);
  const pending = circuit.recover(state, ready); await flush();
  if (reason === 'hidden') { hidden = true; circuit.cancelRecovery(); } else circuit.reset(reason !== 'unmount');
  const updates = changed.mock.calls.length; jest.advanceTimersByTime(60000);
  expect(await pending).toBe(false); expect(state).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledTimes(updates);
  expect(jest.getTimerCount()).toBe(0);
  if (hidden) expect(await circuit.recover(state, ready)).toBe(false);
});

test('account change fences a read already in flight and keeps the new account circuit clear', async () => {
  let credential: string | null = 'alice'; const fence = new StockSessionFence(() => credential);
  const circuit = new StockOverloadCircuit(jest.fn(), () => false), alice = fence.capture();
  let resolve!: (result: StockReadResult) => void;
  const request = new Promise<StockReadResult>(done => { resolve = done; });
  circuit.trip('ACCOUNT_BUSY'); jest.advanceTimersByTime(3000);
  const recovery = circuit.recover(() => request, ready);
  credential = 'bob'; fence.invalidate(); circuit.reset();
  resolve({ kind: 'overload', code: 'RATE_LIMIT' }); expect(await recovery).toBe(false);
  expect(alice.current()).toBe(false); expect(circuit.paused).toBe(false);
});

test('late state errors from a previous symbol cannot relatch or reject the current symbol session', () => {
  let selected = 'AAPL'; const fence = new StockSessionFence(() => 'alice');
  const apple = fence.capture(() => selected === 'AAPL'); selected = 'NVDA';
  const nvidia = fence.capture(() => selected === 'NVDA'), circuit = new StockOverloadCircuit(jest.fn(), () => false), logout = jest.fn();
  expect(nvidia.current()).toBe(true);
  if (apple.current()) circuit.trip('RATE_LIMIT'); apple.reject(logout);
  expect(circuit.paused).toBe(false); expect(logout).not.toHaveBeenCalled();
});

test('unknown order outcome survives read recovery; only explicit resubmission uses the same account-scoped ID', async () => {
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const signature = JSON.stringify({ side: 'BUY', instrumentId: 'BYBIT:AAPLXUSDT', quantity: '1.00000000' });
  const createId = jest.fn().mockReturnValueOnce('alice-order-id').mockReturnValueOnce('bob-order-id');
  const first = rememberStockOrder(storage, 'alice', signature, createId);
  const submit = jest.fn(); submit(first.id); // Explicit first POST has an unknown outcome.
  const circuit = new StockOverloadCircuit(jest.fn(), () => false); circuit.trip('ACCOUNT_BUSY');
  jest.advanceTimersByTime(3000); expect(await circuit.recover(ready, ready)).toBe(true);
  expect(submit).toHaveBeenCalledTimes(1); expect(JSON.parse(storage.getItem(first.key)!)).toEqual({ id: first.id, signature });
  const repeated = rememberStockOrder(storage, 'alice', signature, createId); expect(repeated.id).toBe(first.id); expect(createId).toHaveBeenCalledTimes(1);
  const other = rememberStockOrder(storage, 'bob', signature, createId); expect(other.id).not.toBe(first.id); expect(other.key).not.toBe(first.key);
  expect(submit).toHaveBeenCalledTimes(1);
});
