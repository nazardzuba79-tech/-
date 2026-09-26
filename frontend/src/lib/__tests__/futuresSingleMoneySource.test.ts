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
    expect(service).toContain('const snapshot=projectCollateral(row.snapshot,valuation);');
    expect(service).toContain('crossAccount(demoAccount(snapshot),valuation,open)');
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
    expect(summary.replace(/\r\n/g, '\n')).toContain([
      'const maintenanceMargin = aggregate',
      '    ? Number(aggregate.maintenanceMargin)',
      '    : positions && config',
    ].join('\n'));
  });

  it('an incomplete collateral valuation is shown, not rounded away', () => {
    const summary = src('components/FuturesAccountSummary.tsx');
    expect(summary).toContain('!aggregate.collateralComplete');
    // The ticket shows a mark with a tooltip rather than a paragraph, and the
    // tooltip names no assets — which ticker is unpriced is a fact about our
    // providers, not about this trader's account. `unpricedAssets` still
    // DECIDES whether the warning appears, so it cannot be shown without one,
    // and it cannot be suppressed while one exists.
    expect(summary).toContain("t('futures.collateralPartial')");
    expect(summary).toContain('aggregate.unpricedAssets.length > 0');
    // The Wallet page keeps the longer sentence, assets and all.
    expect(src('pages/wallet-v3/PortfolioStrip.tsx')).toContain("t('futures.collateralIncomplete'");
    expect(src('pages/wallet-v3/PortfolioStrip.tsx')).toContain('unpricedAssets.join');
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
    // The verdict is also asked on CROSS money only: margin posted to an
    // isolated position, and that position's P&L, are subtracted back out
    // because neither backs the shared account — the engine liquidates an
    // isolated position on its own post instead.
    expect(model).toContain('const complete = journaled ? (engine.collateralComplete ?? valuation.complete) : valuation.complete;');
    expect(model).toContain('liquidatable: complete');
    expect(model).toContain('? hasOpenPositions && equity.minus(isolatedMargin).minus(isolatedPnl).lte(maintenanceMargin)');
    expect(model).toContain(': null,');
    // And the isolated post is still INSIDE the settle balance, so ring
    // fencing a position never shrinks the account the Wallet reports.
    expect(model).toContain("const settleBalance = n(engine.walletBalance).plus(isolatedMargin);");
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
  const hook = () => src('pages/wallet-v3/useWalletData.ts');
  const header = () => src('pages/wallet-v3/PortfolioStrip.tsx');

  it('reads the authoritative endpoint instead of recomputing from wallet rows', () => {
    // The Wallet's account used to be a separate card calling
    // `/native/account`; it is now the page header, reading `/native/wallet`
    // — the same authoritative account, plus the rows it was computed from,
    // in one request. Either way the rule is the same one: ASK, never derive.
    expect(hook()).toContain('nativeDemoApi');
    expect(hook()).toContain('.wallet(');
  });

  it('prints the same figures the terminal summary prints', () => {
    const text = hook();
    for (const field of ['equity', 'available', 'unrealizedPnl', 'initialMargin', 'maintenanceMargin', 'orderReserve']) {
      expect(`${field}: ${text.includes(`a.${field}`)}`).toBe(`${field}: true`);
    }
  });

  it('does no arithmetic on the account it was handed', () => {
    // `finite()` parses a decimal string into a number for formatting and
    // refuses anything that is not one. Nothing else touches these fields:
    // no addition, no subtraction, no second derivation of a figure the
    // server already answered.
    const account = hook().slice(hook().indexOf('const account: UnifiedAccount'), hook().indexOf('const rankingBySymbol'));
    expect(account).not.toMatch(/a\.[a-zA-Z]+\s*[-+*/]\s*a\.[a-zA-Z]+/);
    expect(account).not.toMatch(/\.plus\(|\.times\(|\.minus\(/);
  });

  it('shows an ordinary account its own ledger rather than an empty margin account', () => {
    // No margin account is not a margin account worth zero: the hook falls
    // back to the ordinary overview and reports the margin fields as
    // unknown, which the header renders as a dash.
    expect(hook()).toContain("mode: 'SPOT'");
    expect(hook()).toContain('availableUsd: null');
    expect(hook()).toContain('initialMarginUsd: null');
  });

  it('carries the SAME incomplete-collateral sentence as the terminal', () => {
    expect(header()).toContain("t('futures.collateralIncomplete'");
    expect(header()).toContain('account!.unpricedAssets.join');
  });

  it('is mounted on the wallet page', () => {
    expect(src('pages/WalletPage.tsx')).toContain('<PortfolioStrip');
    expect(src('pages/WalletPage.tsx')).toContain('account={account}');
  });
});
