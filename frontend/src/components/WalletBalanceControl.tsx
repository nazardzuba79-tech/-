import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, WalletCards } from 'lucide-react';
import { api, getToken } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { formatAmount } from '../lib/formatNumber';

interface Balance {
  asset: string;
  available: string;
  locked: string;
}

/**
 * Compact account-balance control for the shared header, built to the Trade
 * archive's `.wallet-balance` spec (icon tile, primary balance, muted
 * secondary line, chevron).
 *
 * Every figure is the signed-in user's own, from the endpoints the wallet
 * page already uses — `/balances` for spot and `/futures/balances` for
 * futures. Nothing is hardcoded and nothing is estimated.
 *
 * Two deliberate omissions:
 *
 * - There is no "Funding" section. The archive's example lists one, but
 *   this exchange has spot and futures wallets and no third account type,
 *   so inventing one would misrepresent where a user's money is.
 * - The secondary line is the quote-asset total, not a converted fiat
 *   figure. A "≈ $" number would need a price for every held asset at
 *   render time; the balances endpoint returns amounts only, so the honest
 *   secondary figure is the stablecoin total this exchange actually
 *   settles in.
 */
export function WalletBalanceControl() {
  const { t } = useLanguage();
  const [spot, setSpot] = useState<Balance[] | null>(null);
  const [futures, setFutures] = useState<Balance[] | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Polled rather than fetched once. Two reasons, and the first is the
  // important one: this control renders nothing until a balance actually
  // arrives, so a single failed or aborted request would have hidden it
  // for the rest of the session — the next tick is also the retry. It also
  // keeps the figure current after a deposit or a filled order without the
  // user reloading. 30s is deliberately slow; this is an account figure,
  // not a market feed.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    function load() {
      api
        .getBalances()
        .then((b) => !cancelled && setSpot(b))
        .catch(() => {});
      api
        .getFuturesBalances()
        .then((b) => !cancelled && setFutures(b))
        .catch(() => {});
    }
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!getToken() || spot === null) return null;

  // USDT is this exchange's settlement asset, so it is the one balance that
  // can be totalled without a price lookup — see the doc comment above.
  const QUOTE = 'USDT';
  const pick = (rows: Balance[] | null) => rows?.find((b) => b.asset === QUOTE);
  const spotRow = pick(spot);
  const futuresRow = pick(futures);
  const num = (v: string | undefined) => (v ? parseFloat(v) || 0 : 0);

  const spotAvailable = num(spotRow?.available);
  const spotTotal = spotAvailable + num(spotRow?.locked);
  const futuresTotal = futures === null ? 0 : num(futuresRow?.available) + num(futuresRow?.locked);
  const total = spotTotal + futuresTotal;

  return (
    <div className="wallet-balance-wrap" ref={wrapRef}>
      <button
        type="button"
        className="wallet-balance"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t('wallet.totalBalance')}
      >
        {/* Header shows the figure alone — the "Общий баланс" caption that
            used to sit above it doubled the control's width for a label the
            wallet icon already implies. It is still spelled out in the
            dropdown below, and in the aria-label for screen readers. */}
        <span className="wallet-icon">
          <WalletCards size={13} />
        </span>
        <strong>
          {formatAmount(total)} {QUOTE}
        </strong>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="wallet-balance-menu">
          <div className="wbm-row wbm-total">
            <span>{t('wallet.totalBalance')}</span>
            <strong>
              {formatAmount(total)} {QUOTE}
            </strong>
          </div>
          <div className="wbm-row">
            <span>{t('wallet.spotWallet')}</span>
            <strong>{formatAmount(spotTotal)}</strong>
          </div>
          {/* Only rendered once the futures endpoint has actually answered —
              a zero here would otherwise be indistinguishable from "not
              loaded yet". */}
          {futures !== null && (
            <div className="wbm-row">
              <span>{t('wallet.futuresWallet')}</span>
              <strong>{formatAmount(futuresTotal)}</strong>
            </div>
          )}
          <div className="wbm-row">
            <span>{t('wallet.available')}</span>
            <strong>{formatAmount(spotAvailable)}</strong>
          </div>
          <div className="wbm-actions">
            <Link to="/wallet" onClick={() => setOpen(false)}>
              {t('nav.wallet')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
