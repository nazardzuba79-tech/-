import { useState, useEffect } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';

type Tab = 'open' | 'history';

type OpenPosition = Awaited<ReturnType<typeof api.getCfdPositions>>[number];
type HistoryPosition = Awaited<ReturnType<typeof api.getCfdPositionHistory>>[number];

/**
 * A price/PnL string as the table formats it. `null` means "not reported",
 * which renders as a dash — NOT as zero, and never as the literal "NaN"
 * that `parseFloat(undefined).toFixed(2)` used to produce.
 *
 * A real `'0'` is finite and passes through untouched: zero PnL is a fact
 * about the position, not missing data.
 */
function optionalNumeric(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  return value.trim() !== '' && Number.isFinite(Number(value)) ? value : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The fields both tables dereference on every row, and that the close
 * button acts on.
 *
 * `id` and `side` are the two that matter beyond rendering: `id` is what
 * `closeCfdPosition` is called with, so a wrong or missing one would aim a
 * real close at the wrong position, and `side` decides whether the row
 * reads LONG or SHORT — anything unrecognised would silently render as
 * SHORT and misstate the direction of the user's own exposure.
 */
function validRow(raw: Record<string, unknown>): boolean {
  return nonEmptyString(raw.id)
    && nonEmptyString(raw.symbol)
    && (raw.side === 'LONG' || raw.side === 'SHORT')
    && typeof raw.leverage === 'number' && Number.isFinite(raw.leverage)
    && typeof raw.size === 'string'
    && typeof raw.entryPrice === 'string'
    && typeof raw.liquidationPrice === 'string';
}

/**
 * Validate a positions payload before it reaches render state. Returns
 * `null` for a payload that cannot be trusted.
 *
 * A 200 whose body is not an array — a proxy error page, a truncated
 * response, a changed upstream — used to go straight into state, and the
 * next render called `.map` on it and took the CFD terminal down through
 * the error boundary.
 *
 * This is deliberately ALL-OR-NOTHING, unlike the instrument list, which
 * drops unusable rows. These rows are the user's own open exposure:
 * quietly showing a subset would tell someone they have three positions
 * when they have five, which is worse than saying the list could not be
 * loaded and leaving the last good one on screen.
 */
function parsePositions(value: unknown): OpenPosition[] | null {
  if (!Array.isArray(value)) return null;
  const rows: OpenPosition[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const raw = entry as Record<string, unknown>;
    if (!validRow(raw)) return null;
    rows.push({
      ...(raw as unknown as OpenPosition),
      // The three the table treats as optional. Normalised so an absent or
      // unparseable value renders as the dash the markup already has.
      markPrice: optionalNumeric(raw.markPrice),
      unrealizedPnl: optionalNumeric(raw.unrealizedPnl),
      roe: optionalNumeric(raw.roe),
    });
  }
  // An empty array is a legitimate answer — the account has no open
  // positions — and stays one. Only a payload that is not a well-formed
  // list of positions is rejected.
  return rows;
}

/** The same contract for closed positions, which additionally print a
 *  realized PnL and a status. */
function parseHistory(value: unknown): HistoryPosition[] | null {
  if (!Array.isArray(value)) return null;
  const rows: HistoryPosition[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const raw = entry as Record<string, unknown>;
    // `realizedPnl` goes through parseFloat().toFixed(2) unguarded, so it
    // has to be a real number here or the cell prints "NaN".
    if (!validRow(raw) || !nonEmptyString(raw.status) || optionalNumeric(raw.realizedPnl) === null) return null;
    rows.push(raw as unknown as HistoryPosition);
  }
  return rows;
}

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
  // Set when the last attempt did not yield a list we can trust — a
  // rejected request or an unreadable payload. Both are the same situation
  // (we do not have the data) and neither is "no positions", which is a
  // claim about the account rather than about the request.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function load() {
      if (tab === 'open') {
        api.getCfdPositions()
          .then((res) => {
            if (cancelled) return;
            const rows = parsePositions(res);
            // Malformed: keep the last good list on screen and say so.
            // Never blank it, and never replace it with an empty list.
            if (rows === null) { setLoadFailed(true); return; }
            setPositions(rows);
            setLoadFailed(false);
          })
          .catch(() => !cancelled && setLoadFailed(true));
      } else {
        api.getCfdPositionHistory()
          .then((res) => {
            if (cancelled) return;
            const rows = parseHistory(res);
            if (rows === null) { setLoadFailed(true); return; }
            setHistory(rows);
            setLoadFailed(false);
          })
          .catch(() => !cancelled && setLoadFailed(true));
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
      {/* Only alongside rows: with none, the message takes the place of the
          empty state below instead of stacking two notices. */}
      {!error && loadFailed && (tab === 'open' ? positions.length > 0 : history.length > 0) && (
        <div className="cfd-error" role="alert">{t('futures.loadPositionsError')}</div>
      )}

      <div className="cfd-position-content" id="cfd-positions-content" role="tabpanel" aria-labelledby={`cfd-tab-${tab}`}>
      {tab === 'open' ? (
        positions.length === 0 ? (
          <div className="cfd-empty" role={loadFailed ? 'alert' : undefined}>
            {loadFailed ? t('futures.loadPositionsError') : t('futures.noPositions')}
          </div>
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
        <div className="cfd-empty" role={loadFailed ? 'alert' : undefined}>
          {loadFailed ? t('futures.loadPositionsError') : t('futures.noPositionHistory')}
        </div>
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
