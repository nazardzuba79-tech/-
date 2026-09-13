import { useEffect, useState, useRef } from 'react';
import { api } from './api';
import type { CfdTickerRow } from '../components/CfdInstrumentList';

// Reference-only mode polls once per minute. Approved execution quotes
// use a bounded shorter cadence, while the server owns upstream credit limits.
const POLL_MS = 60_000;
const LOCAL_AGE_MS = 1_000;

/** null is unknown, not zero. Preserve real numeric values from the wire. */
function numericString(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  return value.trim() !== '' && Number.isFinite(Number(value)) ? value : null;
}

/** Browser clocks do not refresh source data. Between polls, locally expire
 * both executable quotes and display-only references so the UI never keeps a
 * formally expired observation green just because its next HTTP poll is later. */
export function ageCfdTickerRows(rows: CfdTickerRow[], now = Date.now()): CfdTickerRow[] {
  let changed = false;
  const next = rows.map((row) => {
    let stale = row.stale === true;
    let executionAllowed = row.executionAllowed === true;
    let status = row.status;
    let referenceLabel = row.referenceLabel;

    if (row.displayOnly === true) {
      if (typeof row.referenceValidUntil === 'number' && Number.isFinite(row.referenceValidUntil) && now > row.referenceValidUntil) {
        stale = true; executionAllowed = false; status = 'stale';
        if (referenceLabel && !referenceLabel.startsWith('Last known')) referenceLabel = `Last known · ${referenceLabel}`;
      }
    } else if (row.status === 'live') {
      const age = row.maxQuoteAgeMs;
      const times = [row.providerTimestamp, row.fetchedAt];
      const expired = typeof age !== 'number' || !Number.isFinite(age) || age < 250 || age > 10_000
        || times.some(t => typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || t > now + 1000 || now - t > age);
      if (expired) { stale = true; executionAllowed = false; status = 'stale'; }
    }

    if (stale !== row.stale || executionAllowed !== row.executionAllowed || status !== row.status || referenceLabel !== row.referenceLabel) {
      changed = true;
      return { ...row, stale, executionAllowed, status, ...(referenceLabel === undefined ? {} : { referenceLabel }) };
    }
    return row;
  });
  return changed ? next : rows;
}

/** Validate before React state. Malformed payloads keep the last good rows;
 * an actually empty list remains distinct from a failed response. */
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
    const displayOnly = raw.displayOnly === true;
    const change = displayOnly ? null : numericString(raw.changePercent24h);
    rows.push({
      symbol,
      name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : symbol,
      price,
      status: typeof raw.status === 'string' ? raw.status : 'unavailable',
      stale: raw.stale !== false,
      executionAllowed: !displayOnly && raw.executionAllowed === true,
      providerTimestamp: typeof raw.providerTimestamp === 'number' ? raw.providerTimestamp : null,
      fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : null,
      maxQuoteAgeMs: typeof raw.maxQuoteAgeMs === 'number' ? raw.maxQuoteAgeMs : undefined,
      ...(raw.displayOnly === undefined ? {} : { displayOnly }),
      ...(typeof raw.referenceLabel === 'string' && raw.referenceLabel.length <= 250 ? { referenceLabel: raw.referenceLabel } : {}),
      ...(raw.referenceKind === 'indicative' || raw.referenceKind === 'daily_reference' ? { referenceKind: raw.referenceKind } : {}),
      ...(typeof raw.referenceValidUntil === 'number' && Number.isFinite(raw.referenceValidUntil) ? { referenceValidUntil: raw.referenceValidUntil } : {}),
      ...(typeof raw.observationDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.observationDate) ? { observationDate: raw.observationDate } : {}),
      ...(change === null ? {} : { changePercent24h: change }),
    });
  }
  return value.length > 0 && rows.length === 0 ? null : ageCfdTickerRows(rows);
}

/** Shared poll so the instrument list and price panel do not own separate feeds. */
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
    api.getCfdTickers().then((res) => {
      const rows = res && typeof res === 'object' ? parseTickerPayload(res.tickers) : null;
      if (rows === null) {
        setLoadError(true);
        setTickers(old => old.map(t => ({...t, stale:true, executionAllowed:false})));
        return;
      }
      if (typeof res.configured === 'boolean') setConfigured(res.configured);
      cadence.current = rows.some(t => t.executionAllowed) ? 2500 : POLL_MS;
      setTickers(rows);
    }).catch(() => { setLoadError(true); setTickers(old => old.map(t => ({...t, stale:true, executionAllowed:false}))); })
      .finally(() => { inFlight.current = false; });
  }
  useEffect(() => {
    load();
    const interval = window.setInterval(() => {
      setTickers(old => ageCfdTickerRows(old));
      if (Date.now()-startedAt.current >= cadence.current) load();
    }, LOCAL_AGE_MS);
    return () => clearInterval(interval);
  }, []);
  return { tickers, configured, loadError, reload: load };
}
