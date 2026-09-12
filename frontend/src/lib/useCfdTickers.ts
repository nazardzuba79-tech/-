import { useEffect, useState, useRef } from 'react';
import { api } from './api';
import type { CfdTickerRow } from '../components/CfdInstrumentList';

// Reference-only mode polls once per minute. Approved execution quotes
// use a bounded shorter cadence, while the server owns upstream credit limits.
const POLL_MS = 60_000;

/**
 * A number that arrived over the wire, as the string the UI formats.
 *
 * `null` means "not a number" — NOT zero. `formatCfdPrice` already renders
 * a dash for a value it cannot format, and `parseChangePercentOrNull`
 * already distinguishes unknown from flat; this only stops a value that is
 * not number-shaped at all from reaching them.
 *
 * A real `0` passes through unchanged: zero is a fact, and the server is
 * entitled to report it.
 */
function numericString(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  return value.trim() !== '' && Number.isFinite(Number(value)) ? value : null;
}

/**
 * Validate the wire payload before it reaches React state.
 *
 * The response shape is a contract, not a guarantee: a proxy error page, a
 * truncated body or a changed upstream can all produce a 200 whose
 * `tickers` is not an array. That used to flow straight into state, and
 * `resolveCfdSymbol` read `.length` off it on the next render — which
 * took the whole Trade page down through the error boundary.
 *
 * Returns `null` for a payload that cannot be trusted, so the caller can
 * keep the last good data instead of replacing it with nonsense.
 *
 * Listed instruments may carry a null price and remain visible. Trading requires
 * explicit approval, status and both timestamps; merely having a row cannot
 * enable the form. Malformed non-null prices are rejected.
 *
 * `name` falls back to the symbol — a label, not a market value.
 * `changePercent24h` is passed through when present and omitted when it is
 * not number-shaped, which the `CfdTickerRow` contract already defines as
 * "unknown", rendered as a dash rather than as 0.00%.
 */
function parseTickerPayload(value: unknown): CfdTickerRow[] | null {
  if (!Array.isArray(value)) return null;

  const rows: CfdTickerRow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;

    const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim() : '';
    if (symbol === '') continue;

    const price = numericString(raw.price);
    if (price === null && raw.price !== null) continue;

    const change = numericString(raw.changePercent24h);
    rows.push({
      symbol,
      name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : symbol,
      price,
      status: typeof raw.status === 'string' ? raw.status : 'unavailable',
      stale: raw.stale !== false,
      executionAllowed: raw.executionAllowed === true,
      providerTimestamp: typeof raw.providerTimestamp === 'number' ? raw.providerTimestamp : null,
      fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : null,
      maxQuoteAgeMs: typeof raw.maxQuoteAgeMs === 'number' ? raw.maxQuoteAgeMs : undefined,
      ...(change === null ? {} : { changePercent24h: change }),
    });
  }

  // A genuinely empty list is valid — the provider may legitimately have
  // nothing to report, and the UI has a state for that. But an array that
  // arrived carrying entries of which NONE parsed is a broken payload, not
  // an empty instrument list, and saying "no instruments" would be a claim
  // this response does not support.
  return value.length > 0 && rows.length === 0 ? null : rows;
}

/** Shared poll so the instrument list and the price panel don't each open
 * their own interval against the same endpoint. */
export function useCfdTickers() {
  const [tickers, setTickers] = useState<CfdTickerRow[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const cadence = useRef(POLL_MS);
  const startedAt = useRef(-Infinity);
  const inFlight = useRef(false);

  function load() {
    if (inFlight.current) return;
    inFlight.current = true; startedAt.current = Date.now();
    setLoadError(false);
    api
      .getCfdTickers()
      .then((res) => {
        const rows = res && typeof res === 'object' ? parseTickerPayload(res.tickers) : null;
        if (rows === null) {
          // Same outcome as a rejected request, because it is the same
          // situation: we did not get the data. The last good rows stay on
          // screen; `configured` keeps its last known value rather than
          // asserting "CFD is unavailable" on the strength of a payload we
          // could not read. With nothing good to keep, the instrument
          // list's existing error state and retry button show.
          setLoadError(true);
          setTickers(old => old.map(t => ({...t, stale:true, executionAllowed:false})));
          return;
        }
        if (typeof res.configured === 'boolean') setConfigured(res.configured);
        cadence.current = rows.some(t => t.executionAllowed) ? 2500 : POLL_MS;
        setTickers(rows);
      })
      .catch(() => { setLoadError(true); setTickers(old => old.map(t => ({...t, stale:true, executionAllowed:false}))); })
      .finally(() => { inFlight.current = false; });
  }

  useEffect(() => {
    load();
    const interval = window.setInterval(() => { if (Date.now()-startedAt.current >= cadence.current) load(); }, 2500);
    return () => clearInterval(interval);
  }, []);

  return { tickers, configured, loadError, reload: load };
}
