import { FormEvent, useEffect, useRef, useState } from 'react';
import { onSessionChange, request } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { futuresCopyText } from './futuresCopyText';

interface Consent {
  status: 'ACTIVE' | 'STOPPED'; ratio: string; maxLeverage: string; maxFillUsdt: string;
  maxTotalExposureUsdt: string; maxDeviationBps: string;
}
interface Mirror {
  sourceEventId: string; kind: string; status: 'APPLIED' | 'REJECTED'; reason: string | null;
  symbol: string | null; side: string | null; filledQuantity: string | null; createdAt: string;
}
export interface FuturesCopySnapshot { automatic?: boolean; consent: Consent | null; mirrors: Mirror[] }
const API = '/copy-trading/futures-demo-execution';
/** Only a confirmed server shape is shown; anything else is treated as unavailable. */
const verified = (next: unknown): FuturesCopySnapshot => {
  const v = next as FuturesCopySnapshot | null;
  if (!v || typeof v !== 'object' || !('consent' in v) || !Array.isArray(v.mirrors)
    || (v.consent !== null && v.consent.status !== 'ACTIVE' && v.consent.status !== 'STOPPED'))
    throw new Error('Unverified copy state');
  return v;
};
const OBSERVER = '/copy-trading/futures-demo-observer';

/**
 * The follower's own Futures order copying. Only what the server confirms is
 * shown: the consent state and one row per source trade, "Executed" with the
 * actual filled quantity or "Not executed" with its reason. If the feature is
 * switched off on the server the panel is not rendered at all.
 */
export function FuturesCopyPanel({ observing, onActive }: { observing: boolean; onActive: (active: boolean) => void }) {
  const { lang } = useLanguage(), t = futuresCopyText[lang];
  const [data, setData] = useState<FuturesCopySnapshot | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [form, setForm] = useState({ ratio: '', maxLeverage: '', maxFillUsdt: '', maxTotalExposureUsdt: '', maxDeviationBps: '' });
  const version = useRef(0), mounted = useRef(true);
  const accept = (next: FuturesCopySnapshot) => {
    setData(next); onActive(next.consent?.status === 'ACTIVE');
    if (next.consent) setForm({ ratio: next.consent.ratio, maxLeverage: next.consent.maxLeverage, maxFillUsdt: next.consent.maxFillUsdt,
      maxTotalExposureUsdt: next.consent.maxTotalExposureUsdt, maxDeviationBps: next.consent.maxDeviationBps });
  };
  useEffect(() => {
    mounted.current = true;
    const clear = () => { version.current++; setData(null); setAvailable(false); onActive(false); setBusy(false); };
    const unsubscribe = onSessionChange(clear);
    const v = ++version.current;
    void request<FuturesCopySnapshot>(API).then(raw => {
      if (!mounted.current || v !== version.current) return;
      const next = verified(raw);
      setAvailable(true); accept(next);
    }).catch(() => { if (mounted.current && v === version.current) { setAvailable(false); onActive(false); } });
    return () => { mounted.current = false; version.current++; unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const act = async (run: () => Promise<FuturesCopySnapshot>) => {
    const v = ++version.current;
    setBusy(true); setError(false);
    try {
      const next = verified(await run());
      if (mounted.current && v === version.current) accept(next);
    } catch {
      // The outcome is unknown: show nothing stale, ask for a fresh read.
      if (mounted.current && v === version.current) { setData(null); setError(true); onActive(false); }
    } finally { if (mounted.current && v === version.current) setBusy(false); }
  };
  if (!available) return null;
  const active = data?.consent?.status === 'ACTIVE';
  const start = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void act(() => request<FuturesCopySnapshot>(API, { method: 'PUT', body: JSON.stringify(form) }));
  };
  const field = (key: keyof typeof form, label: string) => <label key={key}>{label}
    <input inputMode="decimal" required value={form[key]} disabled={busy || active}
      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} /></label>;
  return <section className="futures-copy" aria-labelledby="futures-copy-title">
    <h2 id="futures-copy-title">{t.title}</h2>
    <p className="observer-no-trade" role="status"><strong>{active ? (data?.automatic ? t.onAuto : t.on) : t.off}</strong></p>
    <p className="observer-warning" role="note">{t.notice}</p>
    {error && <p role="alert">{t.reasons.other}</p>}
    {!observing && !active && <p>{t.needObservation}</p>}
    <form onSubmit={start}>
      {field('ratio', t.ratio)}{field('maxLeverage', t.leverage)}{field('maxFillUsdt', t.fill)}
      {field('maxTotalExposureUsdt', t.exposure)}{field('maxDeviationBps', t.deviation)}
      <div className="observer-actions">
        <button type="submit" disabled={busy || active || !observing}>{t.start}</button>
        <button type="button" disabled={busy || !active}
          onClick={() => void act(async () => {
            await request(`${OBSERVER}/scan`, { method: 'POST' });
            return request<FuturesCopySnapshot>(`${API}/run`, { method: 'POST' });
          })}>{t.apply}</button>
        <button type="button" disabled={busy || !active}
          onClick={() => void act(() => request<FuturesCopySnapshot>(API, { method: 'DELETE' }))}>{t.stopCopy}</button>
      </div>
    </form>
    <p>{t.stopNote}</p>
    <h3>{t.history}</h3>
    {data && !data.mirrors.length && <p>{t.none}</p>}
    <ul>{data?.mirrors.map(m => <li key={m.sourceEventId} data-status={m.status}>
      <strong>{m.symbol ?? '—'}</strong> · {m.kind === 'OPEN' ? t.open : t.close}
      {m.side ? ` · ${m.side}` : ''} · {m.status === 'APPLIED'
        ? `${t.applied} · ${t.qty} ${m.filledQuantity}`
        : `${t.rejected} · ${t.reasons[m.reason ?? ''] ?? t.reasons.other}`}
    </li>)}</ul>
  </section>;
}
