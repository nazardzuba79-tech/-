import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
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
  const [balance, setBalance] = useState<{ available: number; locked: number }>({ available: 0, locked: 0 });
  const [positions, setPositions] = useState<Awaited<ReturnType<typeof api.getFuturesPositions>>>([]);
  const [showBalance, setShowBalance] = useState(true);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getFuturesBalances()
        .then((balances) => {
          if (cancelled) return;
          const b = balances.find((x) => x.asset === quoteAsset);
          setBalance({ available: b ? parseFloat(b.available) : 0, locked: b ? parseFloat(b.locked) : 0 });
        })
        .catch(() => {});
      api
        .getFuturesPositions()
        .then((res) => !cancelled && setPositions(res))
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [quoteAsset]);

  const marginBalance = balance.available + balance.locked;
  const pnl = positions.reduce((sum, p) => sum + (p.unrealizedPnl !== null ? parseFloat(p.unrealizedPnl) : 0), 0);
  const initialMargin = positions.reduce((sum, p) => sum + parseFloat(p.initialMargin), 0);
  const maintenanceMargin = config
    ? positions.reduce((sum, p) => {
        const notional = parseFloat(p.size) * parseFloat(p.markPrice ?? p.entryPrice);
        const tier = getLeverageTier(config.leverageTiers, notional);
        return sum + (tier ? notional * tier.maintenanceMarginRate : 0);
      }, 0)
    : 0;
  const initialMarginPct = marginBalance > 0 ? (initialMargin / marginBalance) * 100 : 0;
  const maintenanceMarginPct = marginBalance > 0 ? (maintenanceMargin / marginBalance) * 100 : 0;

  const mask = (s: string) => (showBalance ? s : '****');

  return (
    <div style={styles.wrap}>
      <div style={styles.headerRow}>
        <span style={styles.title}>{t('futures.accountTitle')}</span>
        <div style={styles.headerRight}>
          <button type="button" onClick={() => setShowBalance((s) => !s)} style={styles.eyeBtn}>
            {showBalance ? <EyeIcon /> : <EyeOffIcon />}
          </button>
          <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: pnl >= 0 ? 'var(--buy)' : 'var(--sell)' }}>
            {t('futures.unrealizedPnl')} {mask(`${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`)}
          </span>
        </div>
      </div>

      <div style={styles.barRow}>
        <div style={styles.barLabelRow}>
          <span>{t('futures.initialMarginPct')}</span>
          <span className="mono">{initialMarginPct.toFixed(2)}%</span>
        </div>
        <div style={styles.barTrack}>
          <div style={{ ...styles.barFill, width: `${Math.min(100, initialMarginPct)}%`, background: 'var(--accent)' }} />
        </div>
      </div>

      <div style={styles.barRow}>
        <div style={styles.barLabelRow}>
          <span>{t('futures.maintenanceMarginPct')}</span>
          <span className="mono">{maintenanceMarginPct.toFixed(2)}%</span>
        </div>
        <div style={styles.barTrack}>
          <div style={{ ...styles.barFill, width: `${Math.min(100, maintenanceMarginPct)}%`, background: '#f0a63a' }} />
        </div>
      </div>

      <div style={styles.statRow}>
        <span style={{ color: 'var(--text-secondary)' }}>{t('futures.marginBalance')}</span>
        <span className="mono">{mask(marginBalance.toFixed(2))} {quoteAsset}</span>
      </div>
      <div style={styles.statRow}>
        <span style={{ color: 'var(--text-secondary)' }}>{t('futures.availableMargin')}</span>
        <span className="mono">{mask(balance.available.toFixed(2))} {quoteAsset}</span>
      </div>

      <div style={styles.actionsRow}>
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
    borderRadius: 10,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  eyeBtn: { background: 'transparent', border: 'none', color: 'var(--text-tertiary)', display: 'flex' },
  barRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  barLabelRow: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-tertiary)' },
  barTrack: { height: 4, borderRadius: 999, background: 'var(--panel)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  statRow: { display: 'flex', justifyContent: 'space-between', fontSize: 11 },
  actionsRow: { display: 'flex', gap: 8, marginTop: 2 },
  actionBtn: {
    flex: 1,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 0',
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: 700,
  },
};
