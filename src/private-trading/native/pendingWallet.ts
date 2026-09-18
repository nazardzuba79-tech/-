import type { NativeDemoService } from './service';
import type { OwnerSession } from '../serviceTypes';
import { PrivateTradingError } from '../serviceTypes';
import { emptyDemoState, demoAccount } from './engine';
import { crossAccount } from './accountModel';
import { accountLedger } from './ledger';
import { unifiedWalletRows } from './walletRows';

/** Read already credited DemoBalance holdings BEFORE the trader initializes
 * their native ledger. Zero here is the actual amount transferred to a ledger
 * that does not yet exist, not a fabricated wallet balance. No write on GET.
 * The existing initialize endpoint remains the ONLY debit/ledger creation path. */
export async function pendingNativeWallet(service: NativeDemoService, actor: OwnerSession) {
  const valuation = await service.collateral(actor);
  // Initialization may have committed while valuation was awaiting quotes.
  // Re-read both sides through the ordinary wallet path, never add an old
  // pre-debit valuation to a newly initialized settle ledger.
  if (await service.repository.read(actor)) {
    const current = await service.wallet(actor);
    if (!current) throw new PrivateTradingError('account_changed', 'Счёт изменился. Обновите страницу.', 409);
    return { ...current, initialized: true };
  }
  const empty = emptyDemoState('0', Date.now());
  const account = crossAccount(demoAccount(empty), valuation, false);
  return {
    initialized: false,
    account,
    ledger: accountLedger(empty),
    collateral: valuation,
    // Before initialization there is nowhere to persist a native-account
    // preference yet, so the switches are deliberately read-only.
    rows: unifiedWalletRows(account, valuation).map(row => ({ ...row, collateralToggleable: false })),
    assetsValue: valuation.priced,
    assetsComplete: valuation.unpriced.length === 0,
    unpricedAssets: valuation.unpriced,
  };
}
