import { useEffect, useState } from 'react';
import { nativeDemoApi, type NativeAccountAggregate } from '../lib/nativeDemoApi';
import { useLanguage } from '../lib/i18n';

/**
 * THE FUTURES ACCOUNT, ON THE WALLET PAGE, FROM THE FUTURES ENDPOINT.
 *
 * The requirement is that the Wallet and the terminal agree. The only way
 * to guarantee that is for them to be the same numbers, so this card does
 * no arithmetic at all: it reads `/private-trading/native/account` — the
 * one authoritative aggregate the terminal reads — and prints the fields.
 * Recomputing "equity" here from the wallet rows would be a second answer
 * to a question that already has one.
 *
 * It renders NOTHING for anyone whose account is not bound to the
 * simulation engine, and nothing while the answer is unknown. An ordinary
 * user's wallet page is byte-identical to what it was.
 */

type State =
  | { kind: 'unknown' }
  | { kind: 'absent' }
  | { kind: 'ready'; account: NativeAccountAggregate };

export function WalletFuturesAccountCard({ hidden = false }: { hidden?: boolean }) {
  const { t } = useLanguage();
  const [state, setState] = useState<State>({ kind: 'unknown' });

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    nativeDemoApi
      .account(controller.signal)
      .then((result) => { if (live) setState({ kind: 'ready', account: result.account }); })
      // 401/403 (not the owner) and 409 (no simulation account yet) are both
      // "there is nothing to show here", not an error worth a banner.
      .catch(() => { if (live) setState({ kind: 'absent' }); });
    return () => { live = false; controller.abort(); };
  }, []);

  if (state.kind !== 'ready') return null;
  const a = state.account;
  const mask = (value: string) => (hidden ? '****' : value);

  const rows: [string, string][] = [
    [t('futures.equity'), mask(a.equity)],
    [t('futures.settleBalance'), mask(a.settleBalance)],
    [t('futures.walletCollateral'), mask(a.walletCollateral)],
    [t('futures.unrealizedPnl'), mask(a.unrealizedPnl)],
    [t('futures.usedMargin'), mask(a.initialMargin)],
    [t('futures.availableMargin'), mask(a.available)],
  ];

  return (
    <section className="wallet-futures-account" aria-label={t('wallet.futuresAccount')}>
      <h2 className="wallet-futures-account-title">{t('wallet.futuresAccount')}</h2>
      <dl className="wallet-futures-account-grid">
        {rows.map(([label, value]) => (
          <div key={label} className="wallet-futures-account-row">
            <dt>{label}</dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
      </dl>
      {!a.collateralComplete && a.unpricedAssets.length > 0 && (
        // Same sentence as the terminal shows, for the same reason: the
        // figure above is a floor while part of the wallet has no price.
        <p className="wallet-futures-account-note" role="status">
          {t('futures.collateralIncomplete', { assets: a.unpricedAssets.join(', ') })}
        </p>
      )}
    </section>
  );
}
