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
    <div className="cfd-wrap">
      <div className="cfd-tabs" role="tablist" aria-label={t('futures.positions')}>
        <button onClick={() => setTab('open')} className={`cfd-tab${tab === 'open' ? ' active' : ''}`} role="tab" aria-selected={tab === 'open'} id="cfd-tab-open" aria-controls="cfd-positions-content">
          {t('futures.positions')}
        </button>
        <button onClick={() => setTab('history')} className={`cfd-tab${tab === 'history' ? ' active' : ''}`} role="tab" aria-selected={tab === 'history'} id="cfd-tab-history" aria-controls="cfd-positions-content">
          {t('futures.positionHistory')}
        </button>
      </div>

      {error && <div className="cfd-error" role="alert">{error}</div>}

      <div className="cfd-position-content" id="cfd-positions-content" role="tabpanel" aria-labelledby={`cfd-tab-${tab}`}>
      {tab === 'open' ? (
        positions.length === 0 ? (
          <div className="cfd-empty">{t('futures.noPositions')}</div>
        ) : (
          <div className="cfd-tableWrap">
            <table className="cfd-table">
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
                        <button onClick={() => handleClose(p.id)} disabled={closingId === p.id} className="cfd-closeBtn">
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
        <div className="cfd-empty">{t('futures.noPositionHistory')}</div>
      ) : (
        <div className="cfd-tableWrap">
          <table className="cfd-table">
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
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="cfd-th">{children}</th>;
}
function Td({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <td className={`cfd-td ${className ?? ''}`} style={style}>
      {children}
    </td>
  );
}
