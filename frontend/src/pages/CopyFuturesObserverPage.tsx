import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { onSessionChange, request } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { futuresObserverText } from './copy-trading-bolt/futuresObserverText';
import './copy-trading-bolt/FuturesObserver.css';

interface ObserverSnapshot {
  mode: 'OBSERVATION_ONLY';
  automaticCopying: false;
  subscription: null | { traderId: string; status: 'OBSERVING' | 'STOPPED';
    lastRevision: number; maxLeverage: string; maxFillUsdt: string };
  events: { sourceEventId: string; kind: string; symbol: string;
    quantity: string; price: string; status: 'OBSERVED_ONLY' }[];
}
interface ScanResult {
  mode: 'OBSERVATION_ONLY'; automaticCopying: false;
  scannedRevisions: number; accepted: number; rejected: number;
  lastRevision: number; hasMore: boolean;
}
const API = '/copy-trading/futures-demo-observer';

/** Dedicated opt-in fixture route. No wallet state, order controls or polling. */
export default function CopyFuturesObserverPage() {
  const { lang } = useLanguage(), t = futuresObserverText[lang];
  const [snapshot, setSnapshot] = useState<ObserverSnapshot | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [traderId, setTrader] = useState('VX-001');
  const [maxLeverage, setLeverage] = useState('');
  const [maxFillUsdt, setFill] = useState('');
  const current = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    // A logout, login or cross-tab account switch invalidates all displayed
    // observer data immediately, before another account can see it.
    const unsubscribe = onSessionChange(() => {
      current.current++;
      setSnapshot(null);
      setError(true);
      setBusy(false);
      setTrader('VX-001');
      setLeverage('');
      setFill('');
    });
    const version = ++current.current;
    setBusy(true);
    void request<ObserverSnapshot>(API).then(data => {
      if (!mounted.current || version !== current.current) return;
      if (data.mode !== 'OBSERVATION_ONLY' || data.automaticCopying !== false)
        throw new Error('Unverified Futures observer mode');
      setSnapshot(data);
      if (data.subscription) {
        setTrader(data.subscription.traderId);
        setLeverage(data.subscription.maxLeverage);
        setFill(data.subscription.maxFillUsdt);
      }
    }).catch(() => {
      if (mounted.current && version === current.current) setError(true);
    }).finally(() => {
      if (mounted.current && version === current.current) setBusy(false);
    });
    return () => { mounted.current = false; current.current++; unsubscribe(); };
  }, []);
  const act = async (method: 'GET' | 'PUT' | 'POST' | 'DELETE', body?: object) => {
    const version = ++current.current;
    setBusy(true); setError(false);
    try {
      const suffix = method === 'PUT' || method === 'DELETE'
        ? '/subscription' : method === 'POST' ? '/scan' : '';
      // Scanning never creates trades. It only collects source receipts and
      // requires a separate GET for the authoritative current server state.
      if (method === 'POST') await request<ScanResult>(API + suffix, { method });
      else if (method !== 'GET') await request(API + suffix, {
        method, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const next = await request<ObserverSnapshot>(API);
      if (!mounted.current || version !== current.current) return;
      if (next.mode !== 'OBSERVATION_ONLY' || next.automaticCopying !== false)
        throw new Error('Unverified Futures observer mode');
      setSnapshot(next);
      if (next.subscription) {
        setTrader(next.subscription.traderId);
        setLeverage(next.subscription.maxLeverage);
        setFill(next.subscription.maxFillUsdt);
      }
    } catch {
      // Unknown server outcome may have committed a subscription. Do not show
      // stale "active" or "stopped" claims after a failed write or refresh.
      if (mounted.current && version === current.current) {
        setSnapshot(null); setError(true);
      }
    } finally {
      if (mounted.current && version === current.current) setBusy(false);
    }
  };
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void act('PUT', { traderId, maxLeverage, maxFillUsdt });
  };
  const status = error ? t.error : snapshot?.subscription?.status === 'OBSERVING'
    ? t.active : snapshot?.subscription?.status === 'STOPPED' ? t.stopped : t.none;
  return <main className="copy-futures-observer">
    <Link to="/copy-trading">← VOLTEX Copy Trading</Link>
    <h1>{t.title}</h1>
    <p className="observer-warning" role="note">{t.warning}</p>
    <p className="observer-no-trade"><strong>{t.noTrade}</strong></p>
    <p role="status" aria-live="polite">{busy ? t.loading : status}</p>
    {error && <p role="alert">{t.error}</p>}
    <div className="observer-actions">
      <button type="button" onClick={() => void act('GET')} disabled={busy}>{t.refresh}</button>
      <button type="button" onClick={() => void act('POST')}
        disabled={busy || error || snapshot?.subscription?.status !== 'OBSERVING'}>{t.scan}</button>
    </div>
    <form onSubmit={save}>
      <label>{t.source}
        <select value={traderId} onChange={e => setTrader(e.target.value)}
          disabled={busy || !!snapshot?.subscription}>
          <option value="VX-001">Nazar · VX-001</option>
          <option value="VX-KSENIA">Ksenia · VX-KSENIA</option>
        </select>
      </label>
      <label>{t.leverage}
        <input inputMode="decimal" required value={maxLeverage} onChange={e => setLeverage(e.target.value)} disabled={busy} />
      </label>
      <label>{t.fill}
        <input inputMode="decimal" required value={maxFillUsdt} onChange={e => setFill(e.target.value)} disabled={busy} />
      </label>
      <div className="observer-actions">
        <button type="submit" disabled={busy || error || !snapshot}>{t.save}</button>
        <button type="button" onClick={() => void act('DELETE')}
          disabled={busy || error || snapshot?.subscription?.status !== 'OBSERVING'}>{t.stop}</button>
      </div>
    </form>
    <p>{t.disclaimer}</p><p>{t.noBackfill}</p>
    {snapshot && !error && <section>
      <h2>{t.events}</h2>
      <p>{t.revision}: {snapshot.subscription?.lastRevision ?? '—'}</p>
      {!snapshot.events.length && <p>{t.empty}</p>}
      <ul>{snapshot.events.map(e => <li key={e.sourceEventId}>
        <strong>{e.symbol}</strong> · {e.kind} · {e.quantity} @ {e.price} · {t.observed}
      </li>)}</ul>
    </section>}
  </main>;
}
