import { useState, useEffect } from 'react';
import { useFuturesExecution } from '../lib/futuresExecution';
import { futuresOrderErrorMessage } from '../lib/futuresOrderErrors';
import { useLanguage } from '../lib/i18n';
import { useFuturesAccount } from '../lib/useFuturesAccount';
import { FuturesPositionProtectionCell } from './FuturesPositionProtection';
import './FuturesPositionParity.css';

type Tab = 'open' | 'history';

/**
 * Money as the reference prints it: grouped thousands and a fixed number of
 * decimals. Grouping only ever changes how a figure is SPELLED — the value
 * itself is the server's, unrounded until this call, and the caller decides
 * how many decimals the column carries.
 */
function group(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

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
      // Our sentence, not the server's — see futuresOrderErrors.ts.
      setError(futuresOrderErrorMessage(err, t, t('futures.closePositionError')));
    } finally {
      setClosingId(null);
    }
  }

  /**
   * Nothing to show yet: the tabs, then one short centred line.
   *
   * This used to draw the full strip of column headings above the message —
   * nine headings, 31px, over no rows at all. It reads as a table that has
   * broken rather than an account that simply has no positions, and on the
   * owner's own screen that strip is the first thing the eye lands on.
   *
   * The headings belong to rows; with no rows they say nothing that the
   * message does not say better. What the strip was carrying instead is
   * preserved where it belongs: whether this is a real zero or an unknown
   * stays in the MESSAGE and in the retry button — «Нет открытых позиций»
   * is an answer, a load failure is not, and only the failure offers the
   * retry. Absence of data is never painted as a confirmed zero.
   */
  function renderState(message: string, failed = false) {
    const resource = tab === 'open' ? account.positions : account.positionHistory;
    return <>
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
                  <Th>{t('futures.colContracts')}</Th>
                  <Th>{t('futures.colQty')}</Th>
                  <Th>{t('futures.colValue')}</Th>
                  <Th>{t('futures.colEntry')}</Th>
                  <Th>{t('futures.colMark')}</Th>
                  <Th>{t('futures.colLiq')}</Th>
                  <Th>{t('futures.colUnrealized')}</Th>
                  <Th>{t('futures.colRealized')}</Th>
                  <Th>{t('futures.tpsl')}</Th>
                  <Th>{t('futures.colCloseAs')}</Th>
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
                    <tr key={p.id} className="futures-position-row" data-side={p.side}>
                      {/* Contract, with Cross and the leverage under it. */}
                      <Td>
                        <div className="futures-position-contract">
                          <span className="futures-position-ticker">
                            <b>{p.symbol.replace('/', '')}</b>
                            <i className="futures-position-perp">{t('futures.perpetual')}</i>
                          </span>
                          <small className={p.side === 'LONG' ? 'text-buy' : 'text-sell'}>
                            {t('futures.marginTrading')}{' '}
                            {p.marginType === 'ISOLATED' ? t('futures.isolated') : t('futures.cross')}{' '}
                            {Number(p.leverage).toFixed(2)}x
                          </small>
                        </div>
                      </Td>
                      <Td className={`mono ${p.side === 'LONG' ? 'text-buy' : 'text-sell'}`}>
                        {p.size} <span className="futures-position-unit">{p.symbol.split('/')[0]}</span>
                      </Td>
                      <Td className="mono">
                        {value === null ? '—' : (
                          <>{group(value, 2)} <span className="futures-position-unit">{quoteAsset}</span></>
                        )}
                      </Td>
                      <Td className="mono">{p.entryPrice}</Td>
                      <Td className="mono">{p.markPrice ?? '—'}</Td>
                      <Td className="mono" style={{ color: 'var(--sell)' }}>{liquidationPrice ?? '—'}</Td>
                      {/* Unrealized, with ROI under it — one cell, two facts
                          about the same open exposure. */}
                      <Td className={`mono ${positive ? 'text-buy' : 'text-sell'}`}>
                        <div className="futures-position-pnl">
                          <span className="futures-position-figure">
                            <span
                              className="futures-position-money"
                              data-unit={pnl !== null ? quoteAsset : undefined}
                              data-positive={pnl !== null && pnl > 0 ? 'true' : undefined}
                            >{pnl !== null ? group(pnl, 4) : '—'}</span>
                            <small
                              className="futures-position-roi"
                              data-positive={roe !== null && roe > 0 ? 'true' : undefined}
                            >{roe !== null ? `${roe.toFixed(2)}%` : '—'}</small>
                          </span>
                          {pnl !== null && (
                            <small className="futures-position-approx">≈{group(pnl, 2)} USD</small>
                          )}
                        </div>
                      </Td>
                      <Td className={`mono ${realized >= 0 ? 'text-buy' : 'text-sell'}`}>
                        <div className="futures-position-pnl">
                          <span
                            className="futures-position-realized"
                            data-unit={Number.isFinite(realized) ? quoteAsset : undefined}
                            data-positive={Number.isFinite(realized) && realized > 0 ? 'true' : undefined}
                          >{Number.isFinite(realized) ? group(realized, 4) : '—'}</span>
                          {Number.isFinite(realized) && (
                            <small className="futures-position-approx">≈{group(realized, 2)} USD</small>
                          )}
                        </div>
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
                              {t('futures.closeLimit')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="futures-position-close"
                            onClick={() => handleClose(p.id)}
                            disabled={closingId === p.id}
                          >
                            {closingId === p.id ? t('futures.closing') : t('futures.closeMarket')}
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
  // No fontSize here on purpose. An inline size beats every stylesheet,
  // which is why the terminal's own rules had to carry `!important` to
  // set a column heading at all. With the size left to CSS those can go,
  // and the heading scale lives in one place instead of three.
  th: { textAlign: 'left', padding: '10px 14px', color: 'var(--text-secondary)', fontWeight: 400 },
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