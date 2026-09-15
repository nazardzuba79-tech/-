import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * ONE PLACE COMPUTES THE MONEY.
 *
 * Every figure the terminal shows for the owner's account — equity,
 * available, both margins, the liquidation verdict, the ledger — is
 * computed once on the server and passed through untouched. These tests
 * pin that structurally, because the failure mode is silent: a second
 * derivation does not throw, it just disagrees, and the trader has no way
 * to tell which number is the account.
 *
 * That is not hypothetical here. The maintenance margin read 0.00% for
 * exactly this reason: the card re-derived it from the REAL leverage-tier
 * table while the position had been priced under the simulation engine's.
 */

const root = resolve(__dirname, '../../..');
const src = (path: string) => readFileSync(resolve(root, 'src', path), 'utf8');
const server = (path: string) => readFileSync(resolve(root, '..', 'src', path), 'utf8');

describe('the account has a single authoritative source', () => {
  it('the server folds the engine and the wallet into ONE account object', () => {
    const service = server('private-trading/native/service.ts');
    // Every response — poll, order, close, refresh — goes through the same
    // helper. When the poll and the order response each built their own,
    // available margin could disagree with itself for a poll interval.
    expect(service).toContain('private async authoritative');
    expect(service).toContain('crossAccount(demoAccount(row.snapshot),valuation,open)');
    const authoritative = service.split('private async authoritative')[1];
    expect(authoritative).toBeDefined();
    // And no route bypasses it: `this.view(` never appears as a bare return.
    expect(service).not.toMatch(/return this\.view\(/);
  });

  it('the client passes the server account through instead of rebuilding it', () => {
    const hook = src('lib/useNativeFuturesExecution.ts');
    expect(hook).toContain('const aggregate = state?.account ?? null;');
    // No field-by-field copy, which is where a rename silently drops a figure.
    expect(hook).not.toMatch(/walletBalance:\s*state\.account/);
    expect(hook).not.toMatch(/equity:\s*state\.account/);
  });

  it('the summary card DISPLAYS the aggregate rather than deriving from positions', () => {
    const summary = src('components/FuturesAccountSummary.tsx');
    for (const field of ['equity', 'available', 'initialMargin', 'maintenanceMargin', 'unrealizedPnl']) {
      expect(`${field}: ${summary.includes(`aggregate.${field}`)}`).toBe(`${field}: true`);
    }
    // The old second derivation survives ONLY as the real account's `:`
    // branch — the tier table is never consulted when the engine has
    // published its own maintenance margin.
    expect(summary).toContain([
      'const maintenanceMargin = aggregate',
      '    ? Number(aggregate.maintenanceMargin)',
      '    : positions && config',
    ].join('\n'));
  });

  it('an incomplete collateral valuation is shown, not rounded away', () => {
    const summary = src('components/FuturesAccountSummary.tsx');
    expect(summary).toContain('!aggregate.collateralComplete');
    expect(summary).toContain("t('futures.collateralIncomplete'");
    expect(summary).toContain('aggregate.unpricedAssets.join');
  });

  it('the liquidation verdict can be unknown, and the type says so', () => {
    const execution = src('lib/futuresExecution.tsx');
    expect(execution).toContain('liquidatable: boolean | null;');
    // A `boolean` here would force every consumer to invent false.
    expect(execution).not.toContain('liquidatable: boolean;');
  });

  it('the wallet collateral and the settle ledger are separate figures, so neither is double counted', () => {
    const model = server('private-trading/native/accountModel.ts');
    expect(model).toContain('const collateral = settleBalance.plus(walletCollateral);');
    expect(model).toContain('const equity = collateral.plus(unrealizedPnl);');
    // Liquidation is refused, not guessed, while the wallet is under-valued.
    expect(model).toContain('liquidatable: valuation.complete ? hasOpenPositions && equity.lte(maintenanceMargin) : null,');
  });

  it('no sanity-check total is written into the code', () => {
    // The owner's wallet is worth roughly 58.45M, but that is a figure to
    // CHECK against, never one to ship. It must appear in no source file.
    for (const path of [
      'lib/futuresExecution.tsx', 'lib/nativeDemoApi.ts', 'lib/nativeFuturesAdapter.ts',
      'lib/useNativeFuturesExecution.ts', 'components/FuturesAccountSummary.tsx',
    ]) expect(`${path}: ${/58[,._ ]?454[,._ ]?972/.test(src(path))}`).toBe(`${path}: false`);
    for (const path of [
      'private-trading/native/collateral.ts', 'private-trading/native/accountModel.ts',
      'private-trading/native/ledger.ts', 'private-trading/native/service.ts',
    ]) expect(`${path}: ${/58[,._ ]?454[,._ ]?972/.test(server(path))}`).toBe(`${path}: false`);
  });
});

describe('the Wallet page reports the SAME account as the terminal', () => {
  const card = () => src('components/WalletFuturesAccountCard.tsx');

  it('reads the authoritative endpoint instead of recomputing from wallet rows', () => {
    expect(card()).toContain('nativeDemoApi');
    expect(card()).toContain('.account(');
    // No arithmetic: the card prints fields, it does not combine them.
    expect(card()).not.toMatch(/parseFloat|Number\(|\.plus\(|\.times\(|[^/*]\s\+\s[a-z]+\.(equity|available)/);
  });

  it('prints the same figures the terminal summary prints', () => {
    const text = card();
    for (const field of ['equity', 'settleBalance', 'walletCollateral', 'unrealizedPnl', 'initialMargin', 'available']) {
      expect(`${field}: ${text.includes(`a.${field}`)}`).toBe(`${field}: true`);
    }
  });

  it('shows nothing at all for an account that is not bound to the simulation engine', () => {
    // An ordinary user's wallet page must be unchanged, so the card renders
    // null both before the answer arrives and when it says "not yours".
    expect(card()).toContain("if (state.kind !== 'ready') return null;");
    expect(card()).toContain("setState({ kind: 'absent' })");
  });

  it('carries the SAME incomplete-collateral sentence as the terminal', () => {
    expect(card()).toContain("t('futures.collateralIncomplete'");
    expect(card()).toContain('a.unpricedAssets.join');
  });

  it('is mounted on the wallet page', () => {
    expect(src('pages/WalletPage.tsx')).toContain('<WalletFuturesAccountCard hidden={hidden} />');
  });
});
