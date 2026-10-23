import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';
import * as testMarkets from '../testMarkets';

/** Issue #592: Demo Spot in the ordinary terminal, off unless both switches admit the account. */
const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

/** The real module, evaluated with the build flag as a default build sets it (unset). */
function loadDemoSpot(flag?: string) {
  const source = read('lib/demoSpot.ts').replace('import.meta.env.VITE_DEMO_SPOT_ENABLED', JSON.stringify(flag));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const output: Record<string, any> = {};
  new Function('exports', 'require', code)(output, (name: string) =>
    name === './testMarkets' ? testMarkets : name === './api' ? { api: {}, getToken: () => null, onSessionChange: () => () => {} } : { useEffect: () => {}, useState: (v: any) => [typeof v === 'function' ? v() : v, () => {}] });
  return output as { DEMO_SPOT_BUILD: boolean; isDemoSpotPair: (pair: string) => boolean };
}
const { DEMO_SPOT_BUILD, isDemoSpotPair } = loadDemoSpot();

test('default build: the switch is off, so the terminal never asks and never changes', () => {
  expect(DEMO_SPOT_BUILD).toBe(false);
  expect(loadDemoSpot('true').DEMO_SPOT_BUILD).toBe(true);
  expect(loadDemoSpot('1').DEMO_SPOT_BUILD).toBe(false);
  const hook = read('lib/demoSpot.ts');
  expect(hook).toContain("export const DEMO_SPOT_BUILD = import.meta.env.VITE_DEMO_SPOT_ENABLED === 'true';");
  expect(hook).toContain("if (!DEMO_SPOT_BUILD || !session) return;");
  expect(hook).toContain("if (!DEMO_SPOT_BUILD || !session) return 'off';");
  // An unknown or failed answer fails closed: nothing is sent, never a real order instead.
  expect(hook).toContain("return answer?.token === session ? answer.mode : 'silent';");
  expect(hook).toContain(".catch(() => { if (cached?.token === token) cached = null; return 'silent' as const; });");
});

test('the server picks the ledger: ordinary Balance funds keep the ordinary terminal; demo only without them', () => {
  const hook = read('lib/demoSpot.ts');
  // 'spot' is the ordinary terminal and ledger (TradePage shows the ordinary panels), with a request ID per order.
  expect(hook).toContain("(!access.enabled ? 'off' : access.ledger === 'spot' ? 'spot'");
  expect(hook).toContain(": (access.ledger ?? (access.admitted ? 'demo' : 'none')) === 'demo' ? 'trader' : 'silent')");
});

test('only ordinary pairs use the demo ledger; test markets, listings and VTA keep their own paths', () => {
  expect(isDemoSpotPair('BTC/USDT')).toBe(true);
  expect(isDemoSpotPair('ETH/USDT')).toBe(true);
  for (const pair of ['NRX/USDT', 'VTA/USDT', 'vta/usdt']) expect(isDemoSpotPair(pair)).toBe(false);
  const page = read('pages/TradePage.tsx');
  expect(page).toContain("const demoPair = demoMode !== 'off' && isDemoSpotPair(pair);");
  expect(page).toContain("demo={demoPair ? demoMode : 'off'}");
});

test('an account without an admin credit: Buy/Sell stay clickable, nothing is sent, nothing is shown', () => {
  const form = read('components/OrderForm.tsx');
  const submit = form.slice(form.indexOf('  async function handleSubmit('), form.indexOf('  // Keep every order family reachable.'));
  const silent = submit.indexOf("if (demoLedger && demo !== 'trader') return;");
  expect(silent).toBeGreaterThan(0);
  // Before any request, toast, error line or validation message.
  for (const later of ['setError(t(', 'toast.', 'api.', 'submittingRef.current = true']) expect(submit.indexOf(later)).toBeGreaterThan(silent);
  // The button is not disabled for it: only the existing orderBlocked rule disables it.
  expect(form).toContain('<button type="submit" disabled={submitting || orderBlocked}');
  // Its balance reads as zero without a request.
  expect(form).toContain("await (demoLedger ? (demo === 'trader' ? api.getDemoBalances() : Promise.resolve([])) : api.getBalances())");
});

test('an admitted account: LIMIT and MARKET on the demo ledger only, with the ordinary feedback', () => {
  const form = read('components/OrderForm.tsx');
  expect(form).toContain(".filter(f => !demoLedger || f.id === 'LIMIT' || f.id === 'MARKET')");
  expect(form).toContain("if (demoLedger && family !== 'LIMIT' && family !== 'MARKET') setFamily('LIMIT');");
  const branch = form.slice(form.indexOf('} else if (demoLedger) {'), form.indexOf("} else if (family === 'OCO') {"));
  expect(branch).toContain('feedback = spotOrderFeedback(await withRequestId(terms, requestId => api.placeDemoSpotOrder({ ...terms, requestId })));');
  // Same terms after an unknown outcome reuse the request ID; a definite 4xx answer releases it.
  expect(form).toContain("if (demoPending.current?.terms !== key) demoPending.current = { terms: key, requestId: crypto.randomUUID() };");
  expect(form).toContain('if (error instanceof ApiError && error.status < 500) demoPending.current = null;');
  expect(branch).not.toMatch(/api\.placeOrder\(|placeOcoOrder/);
});

test('panels: the demo ledger for an admitted account, no request at all for a silent one', () => {
  const panels = read('components/DemoSpotPanels.tsx');
  expect(panels).toContain("if (mode !== 'trader') return;");
  expect(panels).toContain('api.cancelDemoOrder(id)');
  expect(panels).not.toMatch(/api\.(getBalances|getMyOrders|cancelOrder)\(/);
  const page = read('pages/TradePage.tsx');
  for (const panel of ['<DemoSpotOrders key={demoLedger} ref={openOrdersRef}', '<DemoSpotOrders key={demoLedger} history', '<DemoSpotAssets key={demoLedger}']) {
    expect(page).toContain(panel);
  }
});

test('no customer-facing «demo» or «unavailable» wording is added', () => {
  for (const file of ['components/DemoSpotPanels.tsx', 'lib/demoSpot.ts']) {
    // Comments and module paths are not shown to anyone.
    const text = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/^import .*$/gm, '');
    const literals = text.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [];
    // 'demo' alone is the server's ledger value, never rendered.
    expect(literals.filter(literal => literal !== "'demo'" && /демо|demo|недоступ|unavailable|coming soon/i.test(literal))).toEqual([]);
  }
});

/** The real submit handler (with its request-ID helper), bound to fixtures. */
function submitFixture(overrides: Record<string, unknown> = {}) {
  const form = read('components/OrderForm.tsx');
  const source = form.slice(form.indexOf('  /** One request ID per order while its outcome is unknown'), form.indexOf('  // Keep every order family reachable.'));
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  class ApiError extends Error { constructor(message: string, public status: number, public body: Record<string, unknown> = {}) { super(message); } }
  const toast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
  const bindings: Record<string, unknown> = {
    privateVta: false, vtaUnconfirmed: false, getToken: () => 'fixture', toast, ApiError,
    api: { placeOrder: jest.fn().mockResolvedValue({ order: { status: 'OPEN' }, trades: [] }), placeOcoOrder: jest.fn().mockResolvedValue({}),
      placeDemoSpotOrder: jest.fn().mockResolvedValue({ order: { status: 'OPEN' }, trades: [] }) },
    t: (key: string) => key, spotOrderFeedback: (r: any) => (r?.order ? { kind: 'placed' } : { kind: 'unknown' }),
    positiveOrderNumber: (v: string) => (Number(v) > 0 ? Number(v) : null), customerErrorText: (e: Error) => e.message,
    submittingRef: { current: false }, demoPending: { current: null },
    setError: jest.fn(), setSubmitting: jest.fn(), resetFields: jest.fn(), onPlaced: jest.fn(), setBalanceVersion: jest.fn(), setVtaUnconfirmed: jest.fn(),
    quantity: '0.001', family: 'LIMIT', type: 'LIMIT', price: '90000', triggerPrice: '', isConditional: false, execution: 'LIMIT',
    side: 'BUY', pair: 'BTC/USDT', baseAsset: 'BTC', ocoTakeProfitPrice: '', ocoStopTriggerPrice: '', ocoStopLimitPrice: '',
    orderBlocked: false, demo: 'spot', demoLedger: false, demoRequest: true,
    balanceReady: true, balanceError: false, available: { base: 0, quote: 100 },
    ...overrides,
  };
  const submit = new Function(...Object.keys(bindings), code + '\nreturn handleSubmit;')(...Object.values(bindings));
  return { ...bindings, toast, submit: () => submit({ preventDefault() {} }) } as any;
}

test("Demo Spot on, an account trading its ordinary Balance ('spot'): the ordinary /orders with a request ID", async () => {
  const f = submitFixture();
  await f.submit();
  expect(f.api.placeOrder).toHaveBeenCalledTimes(1);
  const [body] = f.api.placeOrder.mock.calls[0];
  expect(body).toEqual({ pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '90000', triggerPrice: undefined, quantity: '0.001', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(f.api.placeDemoSpotOrder).not.toHaveBeenCalled();
  expect(f.toast.success).toHaveBeenCalledWith('trade.orderPlaced');
  expect(read('pages/TradePage.tsx')).toContain("const demoLedger = demoPair && (demoMode === 'trader' || demoMode === 'silent') ? demoMode : null;");
});

test('a lost response (network error or 5xx) keeps the request ID for the same terms; a definite 4xx answer releases it', async () => {
  for (const ledger of [{ demo: 'spot', demoLedger: false, call: 'placeOrder' }, { demo: 'trader', demoLedger: true, call: 'placeDemoSpotOrder' }]) {
    const f = submitFixture({ demo: ledger.demo, demoLedger: ledger.demoLedger });
    const send = f.api[ledger.call];
    send.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new f.ApiError('Bad gateway', 502)).mockResolvedValueOnce({ order: { status: 'OPEN' }, trades: [] });
    await f.submit(); await f.submit(); await f.submit();
    const ids = send.mock.calls.map((call: any[]) => call[0].requestId);
    expect(new Set(ids).size).toBe(1);
    expect(f.demoPending.current).toBeNull(); // settled by the definite answer
    send.mockRejectedValueOnce(new f.ApiError('Insufficient USDT balance', 400));
    await f.submit(); await f.submit();
    const [, , , refused, next] = send.mock.calls.map((call: any[]) => call[0].requestId);
    expect(refused).not.toBe(ids[0]); expect(next).not.toBe(refused);
  }
});

test('Demo Spot on: nothing on the balance this side spends → no order, no line, no toast (both ledgers)', async () => {
  for (const ledger of [{ demo: 'spot', demoLedger: false }, { demo: 'trader', demoLedger: true }]) {
    for (const [side, available] of [['BUY', { base: 1, quote: 0 }], ['SELL', { base: 0, quote: 100 }]] as const) {
      const f = submitFixture({ ...ledger, side, available, quantity: '' });
      await f.submit();
      expect(f.api.placeOrder).not.toHaveBeenCalled(); expect(f.api.placeDemoSpotOrder).not.toHaveBeenCalled();
      expect(f.setError.mock.calls).toEqual([[null]]);
      expect(f.toast.error).not.toHaveBeenCalled(); expect(f.toast.info).not.toHaveBeenCalled(); expect(f.toast.success).not.toHaveBeenCalled();
      expect(f.setSubmitting).not.toHaveBeenCalled();
    }
  }
  // A non-zero balance still sends the order: «not enough» comes from the server, as before.
  const f = submitFixture({ available: { base: 0, quote: 0.01 } });
  await f.submit();
  expect(f.api.placeOrder).toHaveBeenCalledTimes(1);
  // An unknown balance (still loading or failed) is not treated as zero.
  for (const unknown of [{ balanceReady: false }, { balanceError: true }]) {
    const g = submitFixture({ available: { base: 0, quote: 0 }, ...unknown });
    await g.submit();
    expect(g.api.placeOrder).toHaveBeenCalledTimes(1);
  }
});

test('Demo Spot off: the ordinary order goes out exactly as before — no request ID, no zero-balance rule', async () => {
  const f = submitFixture({ demo: 'off', demoRequest: false, available: { base: 0, quote: 0 } });
  await f.submit();
  expect(f.api.placeOrder).toHaveBeenCalledWith({ pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '90000', triggerPrice: undefined, quantity: '0.001' });
  const oco = submitFixture({ demo: 'off', demoRequest: false, family: 'OCO', ocoTakeProfitPrice: '1', ocoStopTriggerPrice: '2', ocoStopLimitPrice: '3' });
  await oco.submit();
  expect(oco.api.placeOcoOrder).toHaveBeenCalledWith({ pair: 'BTC/USDT', side: 'BUY', quantity: '0.001', takeProfitPrice: '1', stopTriggerPrice: '2', stopLimitPrice: '3' });
  const ocoOn = submitFixture({ family: 'OCO', ocoTakeProfitPrice: '1', ocoStopTriggerPrice: '2', ocoStopLimitPrice: '3' });
  await ocoOn.submit();
  expect(ocoOn.api.placeOcoOrder.mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/);
});
