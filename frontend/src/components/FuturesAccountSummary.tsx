import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../lib/i18n';
import { useFuturesAccount } from '../lib/useFuturesAccount';
import { useFuturesExecution } from '../lib/futuresExecution';
import { getLeverageTier, LeverageTier } from '../lib/futuresMath';

type FuturesConfig = { leverageTiers: LeverageTier[] } | null;

/** Account-level margin summary shown under the order form — margin/available
 * balance, P&L, and initial/maintenance margin usage, all derived from the
 * real /futures/balances + /futures/positions data (no separate "account"
 * endpoint exists, so this combines the two the same way the order form's
 * own liquidation preview already combines positions with the leverage
 * tiers table). */
export function FuturesAccountSummary({
  quoteAsset,
  config,
  onOpenTransfer,
}: {
  quoteAsset: string;
  config: FuturesConfig;
  onOpenTransfer?: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [showBalance, setShowBalance] = useState(true);

  // One shared poll for the whole terminal — this card, the order form and
  // the positions table now read the SAME snapshot instead of three
  // independently timed copies of it. The 5s cadence is the one this card
  // always used.
  const account = useFuturesAccount({ balances: 5000, positions: 5000 });
  /**
   * ONE SOURCE FOR EVERY FIGURE ON THIS CARD.
   *
   * When the engine publishes its own account aggregate, this card stops
   * calculating and starts displaying: equity, both margins, the order
   * reserve and the available balance are the server's single computation,
   * not a second one performed here from positions and a tier table. Two
   * derivations of one figure are two figures, and that is exactly how the
   * maintenance margin came out as 0.00% — the REAL engine's tier table
   * applied to a position the simulation engine had priced under its own.
   *
   * `null` — every real account — leaves the derivation below untouched.
   */
  const execution = useFuturesExecution();
  const aggregate = execution.account_aggregate;
  /**
   * An account the engine will open, but hasn't.
   *
   * Non-null for exactly one situation: the server says this account trades
   * the simulation engine, there is no ledger yet, and there are demo funds
   * waiting. It renders as one extra row and one button INSIDE this card —
   * the same panel every account gets — rather than as a separate demo
   * block or a second terminal.
   */
  // `?? null` is load-bearing, not tidiness: an execution object from
  // before this field existed yields `undefined`, and `undefined !== null`
  // would have read as "this account is unopened" and blanked every figure
  // on a perfectly ordinary funded account.
  const activation = execution.activation ?? null;
  const failedResources = (['balances', 'positions'] as const).filter(key => account[key].failed);
  const retrying = failedResources.some(key => account[key].loading || account[key].refreshing);

  // `null` means "not known", and stays null when a request fails. It is
  // never coerced to 0: reporting an empty margin account to a trader whose
  // balance request simply failed is the exact fake zero VOLTEX forbids,
  // and it is what this card used to do.
  const row = account.balances.data?.find((x) => x.asset === quoteAsset);
  const available = aggregate
    ? Number(aggregate.available)
    : account.balances.data ? (row ? parseFloat(row.available) : 0) : null;
  // `0.00` is only ever the truth about a REAL account that answered with
  // no row for this asset. An account that has not been opened has no
  // available margin to report, and the figures below stay unknown.
  const unopened = activation !== null;
  const locked = account.balances.data ? (row ? parseFloat(row.locked) : 0) : null;
  const positions = account.positions.data;

  const marginBalance = aggregate
    ? Number(aggregate.equity)
    : available !== null && locked !== null ? available + locked : null;

  // Every figure below is derived exactly as before — same reduce, same
  // leverage tier lookup, same maintenance-margin rate. The only change is
  // that an unknown positions list yields null rather than a total of 0.
  const pnl = aggregate
    ? Number(aggregate.unrealizedPnl)
    : positions
      ? positions.reduce((sum, p) => sum + (p.unrealizedPnl !== null ? parseFloat(p.unrealizedPnl) : 0), 0)
      : null;
  const initialMargin = aggregate
    ? Number(aggregate.initialMargin) + Number(aggregate.orderReserve)
    : positions
      ? positions.reduce((sum, p) => sum + parseFloat(p.initialMargin), 0)
      : null;
  const maintenanceMargin = aggregate
    ? Number(aggregate.maintenanceMargin)
    : positions && config
    ? positions.reduce((sum, p) => {
        const notional = parseFloat(p.size) * parseFloat(p.markPrice ?? p.entryPrice);
        const tier = getLeverageTier(config.leverageTiers, notional);
        return sum + (tier ? notional * tier.maintenanceMarginRate : 0);
      }, 0)
    : null;

  // A percentage of an unknown balance is unknown. A real 0% — no
  // position against a funded account — is still 0%.
  const pct = (part: number | null) =>
    part === null || marginBalance === null ? null : marginBalance > 0 ? (part / marginBalance) * 100 : 0;
  const initialMarginPct = pct(initialMargin);
  const maintenanceMarginPct = pct(maintenanceMargin);

  const mask = (s: string) => (showBalance ? s : '****');
  /** The one place an unknown becomes visible text. Never a zero. */
  const show = (value: number | null, format: (n: number) => string) =>
    value === null || unopened ? '—' : mask(format(value));
  /**
   * A percentage, at the precision this row can print.
   *
   * `—` is unknown. `0.00%` is a real zero — no position against a funded
   * account. And a KNOWN usage too small for two decimals reads `<0.01%`,
   * not `0.00%`: a position that exists is a different fact from no
   * position at all, and on an eight-figure account almost every honest
   * margin usage lands under a hundredth of a percent. Rounding it away
   * would be the same flattening the owner rejected on `0.04%`.
   */
  const showPct = (value: number | null) => {
    if (value === null || unopened) return '—';
    if (value > 0 && value < 0.005) return '<0.01%';
    return `${value.toFixed(2)}%`;
  };
  /**
   * An incomplete collateral valuation, reduced from a paragraph to a mark.
   *
   * The warning itself is NOT dropped: a total that silently omits an asset
   * reads exactly like a smaller account. It moves next to the figure it
   * qualifies, where the tooltip says which assets are missing, instead of
   * standing as a block of technical prose above the numbers.
   */
  const collateralIncomplete = aggregate ? !aggregate.collateralComplete && aggregate.unpricedAssets.length > 0 : false;
  const incompleteNote = aggregate && collateralIncomplete
    ? t('futures.collateralIncomplete', { assets: aggregate.unpricedAssets.join(', ') })
    : '';

  /**
   * Label + amount + unit on the card's one right axis.
   *
   * `rowClass` is the row's stable hook. It carries no styling of its own —
   * it is what the browser QA and anything else outside this file address a
   * particular figure by, so renaming the visible label never silently
   * breaks a check that was reading the balance.
   */
  const amountRow = (key: string, rowClass: string, label: string, value: number | null, extra?: React.ReactNode, tone?: string) => (
    <div className={`futures-account-stat ${rowClass}`} key={key}>
      <span className="fa-label">{label}</span>
      <span className="fa-value mono" style={tone ? { color: tone } : undefined}>
        <span className="fa-amount">{show(value, groupAmount)}</span>
        <span className="fa-unit">{NBSP}{quoteAsset}</span>
        {extra}
      </span>
    </div>
  );

  /**
   * One margin-usage row: short label, a fixed-width bar, the percentage.
   *
   * The percentage is the SAME number the card computed above — this only
   * renders it. `null` stays a dash, a real 0 stays `0.00%`, and the bar is
   * empty in both cases but grey for the unknown one, so "no risk" and "not
   * known" never look alike.
   */
  const usageRow = (key: string, short: string, full: string, value: number | null) => {
    const known = value !== null && !unopened;
    const filled = known ? Math.min(100, Math.max(0, value)) : 0;
    return (
      <div className={`futures-account-stat futures-account-usage ${key === 'im' ? 'futures-account-im' : 'futures-account-mm'}`} key={key}>
        <span className="fa-label" title={full}>{short}</span>
        <span className="fa-track" aria-hidden="true">
          <span className="fa-fill" style={{ width: `${filled}%`, background: usageTone(known ? value : null) }} />
        </span>
        <span className="fa-value mono" style={{ color: usageTone(known ? value : null) }}>{showPct(value)}</span>
      </div>
    );
  };

  return (
    <div className="futures-account-summary" style={styles.wrap}>
      <div className="futures-account-heading" style={styles.headerRow}>
        <span style={styles.title}>{t('futures.accountTitle')}</span>
        <button type="button" aria-label={t(showBalance ? 'wallet.hideBalance' : 'wallet.showBalance')} onClick={() => setShowBalance((s) => !s)} style={styles.eyeBtn}>
          {showBalance ? <EyeIcon /> : <EyeOffIcon />}
        </button>
      </div>
      {failedResources.length > 0 && <div className="terminal-account-state" role="alert" aria-busy={retrying}>
        <span>{t(account.balances.failed ? 'trade.loadAssetsError' : 'futures.loadPositionsError')}</span>
        <button type="button" className="terminal-account-retry" disabled={retrying} onClick={() => execution.refresh(failedResources)}>{t('trade.retry')}</button>
      </div>}

      <div className="futures-account-figures">
        {amountRow('marginBalance', 'futures-account-balance', t('futures.marginBalance'), marginBalance,
          collateralIncomplete
            ? <span className="fa-flag" role="img" title={incompleteNote} aria-label={incompleteNote}>!</span>
            : undefined)}
        {amountRow('available', 'futures-account-available', t('futures.availableMargin'), available)}
        <div className="futures-account-stat futures-account-pnl">
          <span className="fa-label">{t('futures.unrealizedPnl')}</span>
          <span
            className="fa-value mono"
            style={{ color: pnl === null || unopened ? 'var(--text-tertiary)' : pnl >= 0 ? 'var(--buy)' : 'var(--sell)' }}
          >
            <span className="fa-amount">{show(pnl, (n) => `${n >= 0 ? '+' : ''}${groupAmount(n)}`)}</span>
            <span className="fa-unit">{NBSP}{quoteAsset}</span>
          </span>
        </div>
        {usageRow('im', t('futures.initialMarginUsed'), t('futures.initialMarginPct'), initialMarginPct)}
        {usageRow('mm', t('futures.maintenanceMarginUsed'), t('futures.maintenanceMarginPct'), maintenanceMarginPct)}

        {activation && (
          // The balance the server reported, shown as itself. It is the same
          // money the Wallet shows; `Начать торговлю` is what moves it into
          // the trading ledger, exactly once.
          <div className="futures-account-stat futures-account-demo">
            <span className="fa-label">{t('futures.demoAvailable')}</span>
            <span className="fa-value mono">
              <span className="fa-amount">{mask(formatActivation(activation.available))}</span>
              <span className="fa-unit">{NBSP}{activation.asset}</span>
            </span>
          </div>
        )}
      </div>

      {activation && (
        <button
          type="button"
          className="futures-account-activate"
          disabled={activation.pending}
          onClick={activation.begin}
          style={{ ...styles.actionBtn, ...styles.activateBtn }}
        >
          {t(activation.pending ? 'futures.startTradingPending' : 'futures.startTrading')}
        </button>
      )}

      <div className="futures-account-actions" style={styles.actionsRow}>
        <button type="button" onClick={() => navigate('/wallet?action=deposit')} style={styles.actionBtn}>
          {t('futures.depositAction')}
        </button>
        <button
          type="button"
          onClick={() => (onOpenTransfer ? onOpenTransfer() : navigate('/wallet?action=transfer'))}
          style={styles.actionBtn}
        >
          {t('futures.transferAction')}
        </button>
      </div>
    </div>
  );
}

/**
 * The gap between an amount and its unit, as a CHARACTER.
 *
 * A flex gap alone is a visual space only: copied text and a screen reader
 * both read `56 405 024.03USDT`. Non-breaking, so the unit can never be
 * left behind on a line of its own.
 */
const NBSP = '\u00A0';

/**
 * How much of the account a margin figure is using, as a colour.
 *
 * A display band over the percentage the card already computed — it reads
 * the number, it does not change it and it is not a risk model. Three
 * bands so a heavily used account never looks like an idle one, and an
 * unknown percentage stays neutral instead of borrowing "safe" green.
 */
function usageTone(pct: number | null): string {
  if (pct === null) return 'var(--text-tertiary)';
  if (pct >= 80) return 'var(--sell)';
  if (pct >= 50) return '#f0a63a';
  return 'var(--buy)';
}

/**
 * The card's own number, made readable.
 *
 * Group separators and two decimals — nothing else. It never abbreviates
 * to `56.4M`, never truncates and never rounds a figure up, so the digits
 * a trader reads are the digits the engine sent.
 */
function groupAmount(value: number): string {
  const fixed = value.toFixed(2);
  const negative = fixed.startsWith('-');
  const [whole, fraction] = (negative ? fixed.slice(1) : fixed).split('.');
  return `${negative ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${fraction}`;
}

/**
 * The server's balance string, grouped for reading — not recomputed.
 *
 * The digits are the server's own. This only inserts separators and pads
 * the fraction to two places; it never rounds a value up, and it falls back
 * to the raw string rather than printing something the server did not say.
 */
function formatActivation(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return value;
  const [whole, fraction = ''] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped}.${(fraction + '00').slice(0, 2)}`;
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.6 20.6 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a20.6 20.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    margin: '0 10px 10px',
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  headerRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' },
  eyeBtn: { background: 'transparent', border: 'none', color: 'var(--text-tertiary)', display: 'flex' },
  actionsRow: { display: 'flex', gap: 8, marginTop: 2 },
  activateBtn: {
    background: 'var(--buy)',
    borderColor: 'transparent',
    color: '#04140d',
    fontSize: 13,
    padding: '9px 0',
  },
  actionBtn: {
    flex: 1,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '8px 0',
    color: 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: 700,
  },
};
