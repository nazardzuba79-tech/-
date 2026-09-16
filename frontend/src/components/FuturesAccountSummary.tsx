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
  marginType,
  onOpenTransfer,
}: {
  quoteAsset: string;
  config: FuturesConfig;
  /** The margin mode this account actually settles in. Stated here because
   *  it is the first thing the summary has to say about the account: the
   *  margin figures below mean different things under Cross and Isolated. */
  marginType?: 'ISOLATED' | 'CROSS';
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
  const showPct = (value: number | null) => (value === null || unopened ? '—' : `${value.toFixed(2)}%`);

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
      {aggregate && !aggregate.collateralComplete && aggregate.unpricedAssets.length > 0 && (
        // An incomplete valuation understates collateral. Saying so is the
        // only honest option: a total that silently omits an asset reads
        // exactly like a smaller account.
        <div className="futures-account-state" role="status" style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.35 }}>
          {t('futures.collateralIncomplete', { assets: aggregate.unpricedAssets.join(', ') })}
        </div>
      )}
      <div className="futures-account-pnl" style={styles.headerRight}>
        <span>{t('futures.unrealizedPnl')}</span>
        <span
          className="mono"
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: pnl === null ? 'var(--text-tertiary)' : pnl >= 0 ? 'var(--buy)' : 'var(--sell)',
          }}
        >
          {show(pnl, (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`)}
        </span>
      </div>

      {marginType && <div className="futures-account-stat futures-account-mode" style={styles.statRow}>
        <span style={{ color: 'var(--text-secondary)' }}>{t('futures.marginType')}</span>
        <span>{t(marginType === 'ISOLATED' ? 'futures.isolated' : 'futures.cross')}</span>
      </div>}

      <div className="futures-account-risk" style={styles.barRow}>
        <div style={styles.barLabelRow}>
          <span>{t('futures.initialMarginPct')}</span>
          <span className="mono">{showPct(initialMarginPct)}</span>
        </div>
        <div className="futures-account-track" style={styles.barTrack}>
          <div style={{ ...styles.barFill, width: `${unopened ? 0 : Math.min(100, initialMarginPct ?? 0)}%`, background: 'var(--accent)' }} />
        </div>
      </div>

      <div className="futures-account-risk" style={styles.barRow}>
        <div style={styles.barLabelRow}>
          <span>{t('futures.maintenanceMarginPct')}</span>
          <span className="mono">{showPct(maintenanceMarginPct)}</span>
        </div>
        <div className="futures-account-track" style={styles.barTrack}>
          <div style={{ ...styles.barFill, width: `${unopened ? 0 : Math.min(100, maintenanceMarginPct ?? 0)}%`, background: '#f0a63a' }} />
        </div>
      </div>

      <div className="futures-account-stat futures-account-balance" style={styles.statRow}>
        <span style={styles.statLabel}>{t('futures.marginBalance')}</span>
        <span className="mono" style={styles.statValue}>{show(marginBalance, (n) => n.toFixed(2))} {quoteAsset}</span>
      </div>
      <div className="futures-account-stat" style={styles.statRow}>
        <span style={styles.statLabel}>{t('futures.availableMargin')}</span>
        <span className="mono" style={styles.statValue}>{show(available, (n) => n.toFixed(2))} {quoteAsset}</span>
      </div>

      {activation && (
        // The balance the server reported, shown as itself. It is the same
        // money the Wallet shows; `Начать торговлю` is what moves it into
        // the trading ledger, exactly once.
        <>
          <div className="futures-account-stat futures-account-demo" style={styles.statRow}>
            <span style={styles.statLabel}>{t('futures.demoAvailable')}</span>
            <span className="mono" style={styles.statValue}>{mask(formatActivation(activation.available))} {activation.asset}</span>
          </div>
          <button
            type="button"
            className="futures-account-activate"
            disabled={activation.pending}
            onClick={activation.begin}
            style={{ ...styles.actionBtn, ...styles.activateBtn }}
          >
            {t(activation.pending ? 'futures.startTradingPending' : 'futures.startTrading')}
          </button>
        </>
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
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  eyeBtn: { background: 'transparent', border: 'none', color: 'var(--text-tertiary)', display: 'flex' },
  barRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  barLabelRow: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' },
  barTrack: { height: 4, borderRadius: 999, background: 'var(--panel)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  // The value is a number that can be eight digits wide; the label is the
  // part that gives way. Without this the label wrapped to a second line
  // and the rows stopped lining up with each other.
  statRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    gap: 10, fontSize: 13, minWidth: 0,
  },
  actionsRow: { display: 'flex', gap: 8, marginTop: 2 },
  statLabel: { color: 'var(--text-secondary)', minWidth: 0, flex: '0 1 auto' },
  statValue: { flex: '0 0 auto', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
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
