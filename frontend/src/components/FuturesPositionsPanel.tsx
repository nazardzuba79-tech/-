import { useState, useEffect } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useFuturesAccount, refreshFuturesAccount } from '../lib/useFuturesAccount';

type Tab = 'open' | 'history';

export function FuturesPositionsPanel({
  refreshKey,
  tab: controlledTab,
  onCount,
}: {
  refreshKey: number;
  /** When the page owns the tab row (the futures terminal does, so there is
   *  one row of tabs rather than two stacked), pass the active tab here and
   *  this panel renders content only. Left out, it keeps its own tabs and
   *  works standalone. */
  tab?: 'open' | 'history';
  /** Reports the real open-position count so the page's own Positions tab
   *  can show it as a badge, the same way OpenOrdersPanel reports its count
   *  to the spot terminal's Open Orders tab. */
  onCount?: (n: number) => void;
}) {
  const { t } = useLanguage();
  const [ownTab, setTab] = useState<Tab>('open');
  const tab: Tab = controlledTab ?? ownTab;
  const [closingId, setClosingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Open positions keep the 4s cadence this panel always polled at — it is
  // the fastest any component asks for, and the shared store honours the
  // fastest request, so nothing here refreshes more slowly than before.
  // History is deliberately NOT polled: it only changes when a position
  // closes, and this panel already refreshes it on that event.
  const account = useFuturesAccount(tab === 'open' ? { positions: 4000 } : { positionHistory: 60_000 });
  const positions = account.positions.data ?? [];
  const history = account.positionHistory.data ?? [];

  // `refreshKey` still means "the page says the account changed" — it now
  // asks the shared store rather than issuing this panel's own request.
  useEffect(() => {
    if (refreshKey > 0) refreshFuturesAccount(tab === 'open' ? ['positions'] : ['positionHistory']);
  }, [refreshKey, tab]);

  useEffect(() => {
    if (account.positions.data) onCount?.(account.positions.data.length);
  }, [account.positions.data, onCount]);

  async function handleClose(positionId: string) {
    setError(null);
    setClosingId(positionId);
    try {
      await api.closeFuturesPosition(positionId);
      // A close changes the open list, the history AND the margin the
      // position was holding, so all three are refreshed at once instead of
      // only this panel's own list.
      refreshFuturesAccount(['positions', 'positionHistory', 'balances']);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('futures.closePositionError'));
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div style={styles.wrap}>
      {controlledTab === undefined && <div style={styles.tabs}>
        <button
          onClick={() => setTab('open')}
          style={{ ...styles.tab, ...(tab === 'open' ? styles.tabActive : {}) }}
        >
          {t('futures.positions')}
        </button>
        <button
          onClick={() => setTab('history')}
          style={{ ...styles.tab, ...(tab === 'history' ? styles.tabActive : {}) }}
        >
          {t('futures.positionHistory')}
        </button>
      </div>}

      {error && <div style={styles.error}>{error}</div>}

      {tab === 'open' ? (
        positions.length === 0 ? (
          <div style={styles.empty}>{t('futures.noPositions')}</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <Th>{t('trade.market')}</Th>
                  <Th>{t('futures.side')}</Th>
                  <Th>{t('futures.size')}</Th>
                  <Th>{t('futures.entryPrice')}</Th>
                  <Th>{t('futures.markPrice')}</Th>
                  <Th>{t('futures.liqPrice')}</Th>
                  <Th>{t('futures.unrealizedPnl')}</Th>
                  <Th>{t('futures.roe')}</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const pnl = p.unrealizedPnl !== null ? parseFloat(p.unrealizedPnl) : null;
                  const roe = p.roe !== null ? parseFloat(p.roe) : null;
                  const positive = (pnl ?? 0) >= 0;
                  return (
                    <tr key={p.id}>
                      <Td>
                        {p.symbol} <span style={{ color: 'var(--text-tertiary)' }}>{p.leverage}x {p.marginType === 'ISOLATED' ? t('futures.isolated') : t('futures.cross')}</span>
                      </Td>
                      <Td>
                        <span className={p.side === 'LONG' ? 'text-buy' : 'text-sell'} style={{ fontWeight: 700 }}>
                          {p.side === 'LONG' ? t('futures.long') : t('futures.short')}
                        </span>
                      </Td>
                      <Td className="mono">{p.size}</Td>
                      <Td className="mono">{p.entryPrice}</Td>
                      <Td className="mono">{p.markPrice ?? '—'}</Td>
                      <Td className="mono" style={{ color: 'var(--sell)' }}>{p.liquidationPrice}</Td>
                      <Td className={`mono ${positive ? 'text-buy' : 'text-sell'}`}>{pnl !== null ? pnl.toFixed(2) : '—'}</Td>
                      <Td className={`mono ${positive ? 'text-buy' : 'text-sell'}`}>{roe !== null ? `${roe.toFixed(2)}%` : '—'}</Td>
                      <Td>
                        <button
                          onClick={() => handleClose(p.id)}
                          disabled={closingId === p.id}
                          style={styles.closeBtn}
                        >
                          {closingId === p.id ? t('futures.closing') : t('futures.close')}
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : history.length === 0 ? (
        <div style={styles.empty}>{t('futures.noPositionHistory')}</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <Th>{t('trade.market')}</Th>
                <Th>{t('futures.side')}</Th>
                <Th>{t('futures.entryPrice')}</Th>
                <Th>{t('futures.realizedPnl')}</Th>
                <Th>{t('trade.status')}</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((p) => {
                const pnl = parseFloat(p.realizedPnl);
                const positive = pnl >= 0;
                return (
                  <tr key={p.id}>
                    <Td>
                      {p.symbol} <span style={{ color: 'var(--text-tertiary)' }}>{p.leverage}x</span>
                    </Td>
                    <Td>
                      <span className={p.side === 'LONG' ? 'text-buy' : 'text-sell'} style={{ fontWeight: 700 }}>
                        {p.side === 'LONG' ? t('futures.long') : t('futures.short')}
                      </span>
                    </Td>
                    <Td className="mono">{p.entryPrice}</Td>
                    <Td className={`mono ${positive ? 'text-buy' : 'text-sell'}`}>{pnl.toFixed(2)}</Td>
                    <Td>{p.status === 'LIQUIDATED' ? <span style={{ color: 'var(--sell)' }}>{p.status}</span> : p.status}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th style={styles.th}>{children}</th>;
}
function Td({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <td className={className} style={{ ...styles.td, ...style }}>
      {children}
    </td>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
  tabs: { display: 'flex', gap: 4, padding: '0 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  tab: { background: 'transparent', border: 'none', padding: '12px 6px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' },
  tabActive: { color: 'var(--text-primary)', boxShadow: 'inset 0 -2px 0 var(--accent)' },
  empty: { padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 },
  error: { margin: 10, background: 'var(--sell-dim)', color: 'var(--sell)', padding: '6px 10px', borderRadius: 6, fontSize: 11 },
  tableWrap: { flex: 1, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', padding: '8px 14px', color: 'var(--text-tertiary)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.03em' },
  td: { padding: '8px 14px', color: 'var(--text-primary)', borderTop: '1px solid var(--border)' },
  closeBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
};
