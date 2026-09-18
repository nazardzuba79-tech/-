import { useState, useEffect } from 'react';
import { ApiError } from '../lib/api';
import { useFuturesExecution } from '../lib/futuresExecution';
import { futuresOrderErrorMessage } from '../lib/futuresOrderErrors';
import { useLanguage } from '../lib/i18n';
import { useFuturesAccount } from '../lib/useFuturesAccount';
import { FuturesPositionProtectionCell } from './FuturesPositionProtection';
import './FuturesPositionParity.css';

type Tab = 'open' | 'history';

export function FuturesPositionsPanel({
  refreshKey,
  tab: controlledTab,
  onCount,
  onLimitClose,
}: {
  refreshKey: number;
  /** Hand this position to the order form as a reduce-only LIMIT ticket.
   *  Absent means the terminal offers no limit close, and the button is
   *  not rendered rather than rendered dead. */
  onLimitClose?: (position: { id: string; symbol: string; side: 'LONG' | 'SHORT'; size: string; marginType: 'ISOLATED' | 'CROSS' }) => void;
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
  //
  // History asks for NO cadence at all, which is what an absent key means
  // to the store: no timer is ever created for it. It changes only when a
  // position closes, so it is loaded when its tab becomes active and
  // refreshed explicitly on the events that can change it.
  const account = useFuturesAccount(tab === 'open' ? { positions: 4000 } : {});
  const execution = useFuturesExecution();

  /** `null` = not known yet, or the request failed. It is deliberately NOT
   *  coerced to `[]`: an empty array is the server saying "you have none",
   *  and rendering "no open positions" over a failed request would be a
   *  claim about the account that nobody made. */
  const positions = account.positions.data;
  const history = account.positionHistory.data;
  const activeResource = tab === 'open' ? account.positions : account.positionHistory;

  // The one history load, on tab activation.
  useEffect(() => {
    if (tab === 'history') execution.refresh(['positionHistory']);
  }, [tab]);

  // `refreshKey` still means "the page says the account changed" — it now
  // asks the shared store rather than issuing this panel's own request.
  useEffect(() => {
    if (refreshKey > 0) execution.refresh(tab === 'open' ? ['positions'] : ['positionHistory']);
  }, [refreshKey, tab]);

  useEffect(() => {
    if (account.positions.data) onCount?.(account.positions.data.length);
  }, [account.positions.data, onCount]);

  async function handleClose(positionId: string) {
    setError(null);
    setClosingId(positionId);
    try {
      await execution.closePosition(positionId);
      // A close changes the open list, the history AND the margin the
      // position was holding, so all three are refreshed at once instead of
      // only this panel's own list.
      execution.refresh(['positions', 'positionHistory', 'balances']);
    } catch (err) {
      setError(futuresOrderErrorMessage(
        err,
        t,
        err instanceof ApiError ? err.message : t('futures.closePositionError'),
      ));
    } finally {
      setClosingId(null);
    }
  }

  function renderState(message: string, failed = false) {
    const resource = tab === 'open' ? account.positions : account.positionHistory;
    const columns = tab === 'open'
      ? ['trade.market', 'futures.side', 'futures.size', 'futures.entryPrice', 'futures.markPrice', 'futures.liqPrice', 'futures.unrealizedPnl', 'futures.roe', 'futures.tpsl'] as const
      : ['trade.market', 'futures.side', 'futures.entryPrice', 'futures.realizedPnl', 'trade.status'] as const;
    return <>
    <div className="futures-state-columns" tabIndex={0}>
      <table style={styles.table}><thead><tr>{columns.map(key => <th key={key} style={styles.th}>{t(key)}</th>)}</tr></thead></table>
    </div>
    <div className="futures-position-state" style={styles.empty} role="status" aria-busy={resource.loading || resource.refreshing}>
      <svg aria-hidden="true" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.3">
        <rect x="7" y="4" width="18" height="24" rx="3" /><path d="M12 11h8M12 16h8M12 21h5" />
      </svg>
      <span>{message}</span>
      {failed && <button type="button" disabled={resource.loading || resource.refreshing}
        onClick={() => execution.refresh([tab === 'open' ? 'positions' : 'positionHistory'])}>{t('trade.retry')}</button>}
    </div></>;
  }

  return (
    <div className="futures-positions-panel" style={styles.wrap}>
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
      {activeResource.failed && !!activeResource.data?.length && <div className="terminal-account-state" role="alert" aria-busy={activeResource.refreshing}>
        <span>{t('futures.loadPositionsError')}</span>
        <button type="button" className="terminal-account-retry" disabled={activeResource.loading || activeResource.refreshing}
          onClick={() => execution.refresh([tab === 'open' ? 'positions' : 'positionHistory'])}>{t('trade.retry')}</button>
      </div>}

      {tab === 'open' ? (
        positions === null ? (
          // Unknown, not empty. Same distinction CfdPositionsPanel already
          // makes, with the same two existing strings.
          renderState(account.positions.failed ? t('futures.loadPositionsError') : t('trade.loading'), account.positions.failed)
        ) : positions.length === 0 ? (
          renderState(t(account.positions.failed ? 'futures.loadPositionsError' : 'futures.noPositions'), account.positions.failed)
        ) : (
          <div className="futures-positions-scroll" style={styles.tableWrap}>
            <table className="futures-positions-table" style={styles.table}>
              <thead>
                <tr>
                  <Th>{t('trade.market')}</Th>
                  <Th>{t('futures.size')}</Th>
                  <Th>{t('futures.positionValue')}</Th>
                  <Th>{t('futures.entryPrice')}</Th>
                  <Th>{t('futures.markPrice')}</Th>
                  <Th>{t('futures.liqPrice')}</Th>
                  <Th>{t('futures.unrealizedPnl')}</Th>
                  <Th>{t('futures.realizedPnl')}</Th>
                  <Th>{t('futures.tpsl')}</Th>
                  <Th>{t('futures.closeBy')}</Th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const pnl = p.unrealizedPnl !== null ? parseFloat(p.unrealizedPnl) : null;
                  const roe = p.roe !== null ? parseFloat(p.roe) : null;
                  const positive = (pnl ?? 0) >= 0;
                  const quoteAsset = p.symbol.split('/')[1] ?? '';
                  // Position value is the size at the price the position is
                  // currently marked at — the same two server figures the
                  // row already shows, multiplied. Unknown mark, unknown
                  // value: it is NOT silently valued at entry instead.
                  const markNumber = p.markPrice === null ? null : parseFloat(p.markPrice);
                  const value = markNumber === null ? null : parseFloat(p.size) * markNumber;
                  // Realized and unrealized are shown APART and never added:
                  // the size that banked the realized figure is no longer in
                  // the size that carries the unrealized one, and the fees
                  // and funding already inside the realized figure would be
                  // counted a second time by a total.
                  const realized = parseFloat(p.realizedPnl);
                  /**
                   * A native Cross liquidation reference is only meaningful
                   * when the engine and the account header use the same
                   * collateral pool. They now do: the wallet valuation is
                   * journaled into the engine state with every command, so
                   * the engine's estimate and `aggregate.walletCollateral`
                   * come from one figure. What still cannot be answered is
                   * an account whose collateral is only partly priced — a
                   * price computed on a floor is not a liquidation price —
                   * so that stays a dash, never a smaller-pool number
                   * pretending to be account-authoritative.
                   *
                   * Isolated is self-contained, and the real engine stores
                   * its own liquidation price, so neither path is changed.
                   */
                  const aggregate = execution.account_aggregate;
                  const nativeCrossLiquidationUnknown = execution.engine === 'NATIVE'
                    && p.marginType === 'CROSS'
                    && (aggregate === null || !aggregate.collateralComplete);
                  const liquidationPrice = nativeCrossLiquidationUnknown ? null : p.liquidationPrice;
                  return (
                    <tr key={p.id} className="futures-position-row">
                      {/* Contract, with Cross and the leverage under it. */}
                      <Td>
                        <div className="futures-position-contract">
                          <b>{p.symbol}</b>
                          <small className={p.side === 'LONG' ? 'text-buy' : 'text-sell'}>
                            {p.side === 'LONG' ? t('futures.long') : t('futures.short')}
                            {' · '}
                            {p.marginType === 'ISOLATED' ? t('futures.isolated') : t('futures.cross')} {p.leverage}x
                          </small>
                        </div>
                      </Td>
                      <Td className="mono">{p.size} <span className="futures-position-unit">{p.symbol.split('/')[0]}</span></Td>
                      <Td className="mono">{value === null ? '—' : `${value.toFixed(2)} ${quoteAsset}`}</Td>
                      <Td className="mono">{p.entryPrice}</Td>
                      <Td className="mono">{p.markPrice ?? '—'}</Td>
                      <Td className="mono" style={{ color: 'var(--sell)' }}>{liquidationPrice ?? '—'}</Td>
                      {/* Unrealized, with ROI under it — one cell, two facts
                          about the same open exposure. */}
                      <Td className={`mono ${positive ? 'text-buy' : 'text-sell'}`}>
                        <div className="futures-position-pnl">
                          <span
                            className="futures-position-money"
                            data-unit={pnl !== null ? quoteAsset : undefined}
                            data-positive={pnl !== null && pnl > 0 ? 'true' : undefined}
                          >{pnl !== null ? pnl.toFixed(2) : '—'}</span>
                          <small
                            className="futures-position-roi"
                            data-positive={roe !== null && roe > 0 ? 'true' : undefined}
                          >{roe !== null ? `${roe.toFixed(2)}%` : '—'}</small>
                        </div>
                      </Td>
                      <Td className={`mono ${realized >= 0 ? 'text-buy' : 'text-sell'}`}>
                        <span
                          className="futures-position-realized"
                          data-unit={Number.isFinite(realized) ? quoteAsset : undefined}
                          data-positive={Number.isFinite(realized) && realized > 0 ? 'true' : undefined}
                        >{Number.isFinite(realized) ? realized.toFixed(2) : '—'}</span>
                      </Td>
                      <Td>
                        {/* Real server-held protection, carried on the same
                            positions payload this table already reads — no
                            extra endpoint and no extra timer. */}
                        <FuturesPositionProtectionCell
                          positionId={p.id}
                          protection={p.protection ?? null}
                          onSaved={() => execution.refresh(['positions'])}
                        />
                      </Td>
                      <Td>
                        <div className="futures-position-actions">
                          {/* "Лимитный" is only offered where a limit close
                              really exists — it hands the order form a
                              reduce-only ticket for this position. Without
                              that handler it is not rendered at all, because
                              a button that does nothing is worse than an
                              absent one. */}
                          {onLimitClose && (
                            <button type="button" className="futures-position-close" onClick={() => onLimitClose(p)}>
                              {t('trade.limit')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="futures-position-close"
                            onClick={() => handleClose(p.id)}
                            disabled={closingId === p.id}
                          >
                            {closingId === p.id ? t('futures.closing') : t('trade.market')}
                          </button>
                          {/* The P&L card, as a compact icon button with a
                              name — only where a card service exists. */}
                          {execution.showPnlCard && (
                            <button
                              type="button"
                              className="futures-position-card"
                              title={t('futures.pnlCard')}
                              aria-label={`${t('futures.pnlCard')} · ${p.symbol}`}
                              onClick={() => execution.showPnlCard!(p.id)}
                            >
                              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
                                stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
                                <path d="M8 15l3-3.5 2.4 2.4L16.5 10" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : history === null ? (
        renderState(account.positionHistory.failed ? t('futures.loadPositionsError') : t('trade.loading'), account.positionHistory.failed)
      ) : history.length === 0 ? (
        renderState(t(account.positionHistory.failed ? 'futures.loadPositionsError' : 'futures.noPositionHistory'), account.positionHistory.failed)
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
  error: { margin: 10, background: 'var(--sell-dim)', color: 'var(--sell)', padding: '6px 10px', borderRadius: 6, fontSize: 13 },
  tableWrap: { flex: 1, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 14px', color: 'var(--text-secondary)', fontWeight: 400, fontSize: 12 },
  td: { padding: '8px 14px', color: 'var(--text-primary)', borderTop: '1px solid var(--border)' },
  closeBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
};