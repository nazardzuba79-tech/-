import { useState, useEffect } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';

type Tab = 'open' | 'history';

/** CFD counterpart of FuturesPositionsPanel — same layout, no marginType
 * column (CFD is ISOLATED-only, see CfdPositionService). */
export function CfdPositionsPanel({ refreshKey }: { refreshKey: number }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('open');
  const [positions, setPositions] = useState<Awaited<ReturnType<typeof api.getCfdPositions>>>([]);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.getCfdPositionHistory>>>([]);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    function load() {
      if (tab === 'open') {
        api.getCfdPositions().then((res) => !cancelled && setPositions(res)).catch(() => {});
      } else {
        api.getCfdPositionHistory().then((res) => !cancelled && setHistory(res)).catch(() => {});
      }
    }
    load();
    const interval = tab === 'open' ? setInterval(load, 4000) : null;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [tab, refreshKey, localRefresh]);

  async function handleClose(positionId: string) {
    setError(null);
    setClosingId(positionId);
    try {
      await api.closeCfdPosition(positionId);
      setLocalRefresh((k) => k + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('futures.closePositionError'));
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.tabs}>
        <button onClick={() => setTab('open')} style={{ ...styles.tab, ...(tab === 'open' ? styles.tabActive : {}) }}>
          {t('futures.positions')}
        </button>
        <button onClick={() => setTab('history')} style={{ ...styles.tab, ...(tab === 'history' ? styles.tabActive : {}) }}>
          {t('futures.positionHistory')}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {tab === 'open' ? (
        positions.length === 0 ? (
          <div style={styles.empty}>{t('futures.noPositions')}</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <Th>{t('trade.cfdInstrument')}</Th>
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
                        {p.symbol} <span style={{ color: 'var(--text-tertiary)' }}>{p.leverage}x</span>
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
                        <button onClick={() => handleClose(p.id)} disabled={closingId === p.id} style={styles.closeBtn}>
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
                <Th>{t('trade.cfdInstrument')}</Th>
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
  closeBtn: { background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' },
};
