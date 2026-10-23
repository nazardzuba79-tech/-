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

test('only ordinary pairs use the demo ledger; test markets, listings and VTA keep their own paths', () => {
  expect(isDemoSpotPair('BTC/USDT')).toBe(true);
  expect(isDemoSpotPair('ETH/USDT')).toBe(true);
  for (const pair of ['NRX/USDT', 'VTA/USDT', 'vta/usdt']) expect(isDemoSpotPair(pair)).toBe(false);
  const page = read('pages/TradePage.tsx');
  expect(page).toContain("const demoLedger = demoMode !== 'off' && isDemoSpotPair(pair) ? demoMode : null;");
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
  expect(branch).toContain('api.placeDemoSpotOrder({ ...terms, requestId: demoPending.current.requestId })');
  expect(branch).toContain('feedback = spotOrderFeedback(result);');
  // Same terms after an unknown outcome reuse the request ID; a definite 4xx answer releases it.
  expect(branch).toContain("if (demoPending.current?.terms !== key) demoPending.current = { terms: key, requestId: crypto.randomUUID() };");
  expect(branch).toContain('if (error instanceof ApiError && error.status < 500) demoPending.current = null;');
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
    expect(literals.filter(literal => /демо|demo|недоступ|unavailable|coming soon/i.test(literal))).toEqual([]);
  }
});
