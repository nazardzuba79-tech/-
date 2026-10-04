import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';

const source = readFileSync(resolve(__dirname, '../nrxDemoApi.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const id = '91b4b181-2ba2-4e56-9ffb-f9ca5f72e41e';
const receipt = { id, price: '0.8', quantity: '2.5', proceeds: '2' };
const snapshot = { account: { id: 'actor', scope: 'SIMULATION_SPOT', cashPolicy: 'SHARED_DEMO_BALANCE' }, valuationSource: 'NEURIX_SIMULATION',
  balances: [{ asset: 'NRX', available: '10', locked: '0' }, { asset: 'USDT', available: '25', locked: '0' }], sales: [] };
function fixture() {
  let token: string | null = 'actor-session';
  const fetch = jest.fn();
  const output: any = {};
  new Function('exports', 'require', compiled)(output, (name: string) => {
    if (name === './browserActivity') return { browserFetch: fetch };
    if (name === './api') return { API_BASE: '/api/v1', getToken: () => token };
    throw new Error(`Unexpected dependency: ${name}`);
  });
  return { api: output.nrxDemoApi, fetch, session: (next: string | null) => { token = next; }, reply: (body: unknown, status = 200) =>
    fetch.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }) };
}
test('snapshot accepts only separate NRX demo scope and never ordinary account data', async () => {
  const f = fixture(); f.reply(snapshot);
  expect(await f.api.snapshot()).toEqual(snapshot);
  for (const invalid of [{ ...snapshot, valuationSource: 'VOLTORA_SIMULATION' }, { ...snapshot, account: { ...snapshot.account, scope: 'SPOT' } }, [], null,
    { ...snapshot, balances: [{ asset: 'USDT', available: '999', locked: '0' }] }]) {
    f.reply(invalid); await expect(f.api.snapshot()).rejects.toMatchObject({ status: 502, rejected: false });
  }
});
test('sale posts only identity-free request ID and quantity, without client price or ordinary endpoint fallback', async () => {
  const f = fixture(); f.reply(receipt);
  expect(await f.api.sell(id, '2.500')).toEqual(receipt);
  expect(f.fetch).toHaveBeenCalledTimes(1);
  const [url, init] = f.fetch.mock.calls[0];
  expect(url).toBe('/api/v1/demo/nrx/sell');
  expect(init.method).toBe('POST'); expect(init.credentials).toBe('omit'); expect(init.cache).toBe('no-store');
  expect(JSON.parse(init.body)).toEqual({ requestId: id, quantity: '2.500' });
  expect(init.headers.Authorization).toBe('Bearer actor-session');
});
test('a failed network call never retries itself', async () => {
  const f = fixture(); f.fetch.mockRejectedValue(new Error('fixture network failure'));
  await expect(f.api.sell(id, '2.5')).rejects.toThrow('fixture network failure');
  expect(f.fetch).toHaveBeenCalledTimes(1);
});
test('malformed or mismatched successful sale remains ambiguous', async () => {
  const f = fixture();
  for (const value of [null, [], { ok: true }, { ...receipt, quantity: '3' }, { ...receipt, proceeds: '-2' }, { ...receipt, id: 'invalid' }]) {
    f.reply(value); await expect(f.api.sell(id, '2.5')).rejects.toMatchObject({ status: 502, rejected: false });
  }
});
test('only explicit 400 rejected status is definitive, not conflict, throttle or server error', async () => {
  const f = fixture();
  for (const status of [400, 403, 409, 429, 500, 503]) {
    f.reply({ error: 'fixture refusal', simulationOutcome: 'REJECTED' }, status);
    await expect(f.api.sell(id, '2.5')).rejects.toMatchObject({ status, rejected: status === 400 });
  }
});
test('session change during response parsing rejects stale account response', async () => {
  const f = fixture(); f.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => { f.session('different-session'); return snapshot; } });
  await expect(f.api.snapshot()).rejects.toMatchObject({ status: 409, rejected: false });
});
test('recovery is read-only and malformed absence cannot be mistaken for a receipt', async () => {
  const f = fixture(); f.reply({ receipt: null });
  expect(await f.api.operation(id)).toEqual({ receipt: null });
  expect(f.fetch.mock.calls[0][0]).toBe(`/api/v1/demo/nrx/sales/${id}`);
  expect(f.fetch.mock.calls[0][1].method).toBe('GET');
  expect(f.fetch.mock.calls[0][1].body).toBeUndefined();
  f.reply({}); await expect(f.api.operation(id)).rejects.toMatchObject({ status: 502, rejected: false });
  f.session(null); f.fetch.mockClear(); await expect(f.api.snapshot()).rejects.toMatchObject({ status: 401 }); expect(f.fetch).not.toHaveBeenCalled();
});
