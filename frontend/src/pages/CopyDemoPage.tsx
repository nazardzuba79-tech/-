import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { copyDemoText, copyDemoExposure, copyDemoReason } from './copy-trading-bolt/copyDemoText';
import './copy-trading-bolt/CopyDemo.css';

interface Snapshot {
  mode: 'ISOLATED_DEMO';
  subscription: null | { id: string; traderId: string; status: string; ratio: string; maxOrderUsdt: string; maxExposureUsdt: string };
  executions: { id: string; pair: string; side: string; status: string; reason: string | null; cancelRequested: boolean;
    order?: { status: string; originalQuantity: string; remainingQuantity: string } }[];
  positions: { pair: string; quantity: string; costUsdt: string }[];
  realizedPnlUsdt: string; exposureUsdt: string;
}
export default function CopyDemoPage() {
  const { lang } = useLanguage(), t = copyDemoText[lang];
  const [data, setData] = useState<Snapshot | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const [traderId, setTrader] = useState('VX-001'), [ratio, setRatio] = useState(''), [maxOrderUsdt, setOrder] = useState(''), [maxExposureUsdt, setExposure] = useState('');
  const current = useRef(0);
  const load = async (method = 'GET', body?: object) => {
    const version = ++current.current; setBusy(true); setError(false);
    try {
      const next = await request<Snapshot>('/copy-trading/demo' + (method === 'GET' ? '' : '/subscription'), { method, body: body ? JSON.stringify(body) : undefined });
      if (version !== current.current) return;
      setData(next);
      if (next.subscription) { setTrader(next.subscription.traderId); setRatio(next.subscription.ratio); setOrder(next.subscription.maxOrderUsdt); setExposure(next.subscription.maxExposureUsdt); }
    } catch { if (version === current.current) setError(true); }
    finally { if (version === current.current) setBusy(false); }
  };
  useEffect(() => { void load(); return () => { current.current++; }; }, []);
  const submit = (event: FormEvent) => { event.preventDefault(); void load('PUT', { traderId, ratio, maxOrderUsdt, maxExposureUsdt }); };
  const status = !data?.subscription ? t.none : ({ ACTIVE: t.active, STOPPING: t.stopping, STOPPED: t.stopped }[data.subscription.status] ?? t.error);
  const orderStatus = (e: Snapshot['executions'][number]) => e.status === 'PENDING' ? t.waiting : e.status === 'REJECTED' ? copyDemoReason(lang, e.reason) : e.status === 'SKIPPED' ? t.skipped
    : e.cancelRequested ? t.stopping : ({ FILLED: t.filled, PARTIALLY_FILLED: t.partial, CANCELLED: t.cancelled, OPEN: t.open }[e.order?.status ?? ''] ?? t.pending);
  return <main className="copy-demo-review">
    <Link to="/copy-trading">← VOLTEX Copy Trading</Link><h1>{t.title}</h1><p>{t.notice}</p>
    <p role="status">{busy ? t.pending : error ? t.error : status}</p>
    {error && <p role="alert">{t.error}</p>}
    <button onClick={() => void load()} disabled={busy}>{t.refresh}</button>
    <form onSubmit={submit}>
      <label>{t.strategy}<select value={traderId} onChange={e => setTrader(e.target.value)} disabled={busy || !!data?.subscription}>
        <option value="VX-001">Nazar · VX-001</option><option value="VX-KSENIA">Ksenia · VX-KSENIA</option>
      </select></label>
      <label>{t.ratio}<input required inputMode="decimal" value={ratio} onChange={e => setRatio(e.target.value)} disabled={busy} /></label>
      <label>{t.order}<input required inputMode="decimal" value={maxOrderUsdt} onChange={e => setOrder(e.target.value)} disabled={busy} /></label>
      <label>{t.exposure}<input required inputMode="decimal" value={maxExposureUsdt} onChange={e => setExposure(e.target.value)} disabled={busy} /></label>
      <button disabled={busy || error || !data}>{t.save}</button>
      <button type="button" disabled={busy || error || !data?.subscription || data.subscription.status === 'STOPPED'} onClick={() => void load('DELETE')}>{t.stop}</button>
    </form>
    <p>{t.retain}</p>
    {data && !error && <><dl><dt>{t.pnl}</dt><dd>{data.realizedPnlUsdt}</dd><dt>{copyDemoExposure[lang]}</dt><dd>{data.exposureUsdt}</dd></dl>
      <h2>{t.positions}</h2>{data.positions.map(p => <p key={p.pair}>{p.pair}: {p.quantity}</p>)}
      <h2>{t.history}</h2>{!data.executions.length && <p>{t.empty}</p>}
      <ul>{data.executions.map(e => <li key={e.id}>{e.pair} · {e.side} · {orderStatus(e)}{e.order && ` · ${e.order.originalQuantity} / ${e.order.remainingQuantity}`}</li>)}</ul>
    </>}
  </main>;
}
