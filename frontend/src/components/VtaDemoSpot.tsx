import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, getToken, type VtaDemoSnapshot, type VtaSaleReceipt } from '../lib/api';
import { useVisibleAccountRead } from '../lib/useVisibleAccountRead';
import { useTestMarket, TEST_MARKET_TERMINAL_INTERVAL_MS } from '../lib/testMarketStore';
import './VtaDemoSpot.css';

const number = (value: string | number, digits = 8) => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: digits });

/** Private administrator ledger. Never contributes to real wallet totals,
 * deposits, withdrawal availability or the normal Spot order form. */
export function VtaDemoSpot({ wallet = false, hidden = false, children }: { wallet?: boolean; hidden?: boolean; children?: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<VtaDemoSnapshot | null>(null);
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<VtaSaleReceipt | null>(null);
  const pending = useRef<{ requestId: string; quantity: string } | null>(null);
  const sending = useRef(false);
  const refresh = useVisibleAccountRead({
    load: async () => { const me = await api.getMe(); return me.isAdmin ? { id: me.id, data: await api.getVtaDemo() } : null; },
    accept: value => { setUserId(value?.id ?? null); setSnapshot(value?.data ?? null); setError(''); },
    reset: () => { setUserId(null); setSnapshot(null); setResult(null); setQuantity(''); pending.current = null; },
    fail: () => { setSnapshot(null); setError('Не удалось загрузить баланс. Обновите данные.'); },
    staleMs: 30_000, poll: false,
  });
  const market = useTestMarket(userId ? 'VTA/USDT' : null, TEST_MARKET_TERMINAL_INTERVAL_MS);
  const price = market.asset?.state.phase === 'live' ? market.asset.state.lastPrice : null;
  const available = snapshot?.balances.find(b => b.asset === 'VTA')?.available ?? '0';
  const usdt = snapshot?.balances.find(b => b.asset === 'USDT')?.available ?? '0';
  const normalized = quantity.trim().replace(',', '.');
  const valid = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(normalized) && Number(normalized) > 0 && Number(normalized) <= Number(available);
  const estimate = price !== null && valid ? price * Number(normalized) : null;

  const sell = async () => {
    if (sending.current || (!pending.current && (!snapshot || !price || !valid))) return;
    const session = getToken();
    sending.current = true; setBusy(true); setError(''); setResult(null);
    // A network retry reuses the same key and quantity. Editing is locked until
    // the server resolves that request, preventing accidental double sales.
    pending.current ??= { requestId: crypto.randomUUID(), quantity: normalized };
    try {
      const receipt = await api.sellVtaDemo(pending.current.requestId, pending.current.quantity);
      if (getToken() !== session) return;
      pending.current = null; setResult(receipt); setQuantity(''); await refresh();
    } catch (e) {
      if (getToken() !== session) return;
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) pending.current = null;
      setError(e instanceof Error ? e.message : 'Не удалось подтвердить продажу. Повторите запрос.');
    } finally { sending.current = false; setBusy(false); }
  };

  if (!userId) return <>{children}</>;
  return <section className={`vta-demo-spot${wallet ? ' vta-demo-wallet' : ''}`} aria-label="VOLTORA — спотовый счёт">
    <header><strong>VOLTORA <span>VTA · Spot</span></strong></header>
    <div className="vta-demo-balance"><span>Доступно</span><strong>{hidden ? '••••••' : snapshot ? `${number(available)} VTA` : '—'}</strong></div>
    <div className="vta-demo-balance"><span>USDT</span><strong>{hidden ? '••••••' : snapshot ? number(usdt) : '—'}</strong></div>
    {wallet ? <div className="vta-demo-wallet-actions"><Link to="/trade?pair=VTA%2FUSDT">Продать VTA →</Link><Link to={`/admin/users/${userId}`}>Управление балансом</Link></div> : <>
      <div className="vta-demo-field"><span>Цена · Рыночная</span><strong>{price === null ? 'После листинга' : `${number(price, 10)} USDT`}</strong></div>
      <label className="vta-demo-field"><span>Количество · VTA</span><input aria-label="Количество VTA" inputMode="decimal" value={quantity} disabled={busy || pending.current !== null} onChange={e => setQuantity(e.target.value)} placeholder="0.00000000" /></label>
      <button className="vta-demo-max" type="button" disabled={!snapshot || busy || pending.current !== null} onClick={() => setQuantity(available)}>100%</button>
      <div className="vta-demo-balance"><span>Итого, USDT</span><strong>{estimate === null ? '—' : `≈ ${number(estimate, 8)}`}</strong></div>
      <button className="vta-demo-sell" type="button" disabled={busy || (!pending.current && (!snapshot || price === null || !valid))} onClick={() => void sell()}>{busy ? 'Обработка…' : pending.current ? 'Проверить продажу' : 'Продать VTA'}</button>
      {result && <p role="status">Продано {number(result.quantity)} VTA · Зачислено {number(result.proceeds)} USDT</p>}
      {snapshot && snapshot.sales.length > 0 && <details><summary>История продаж</summary>{snapshot.sales.map(s => <p key={s.id}>{new Date(s.createdAt).toLocaleString('ru-RU')} · {number(s.quantity)} VTA · {number(s.proceeds)} USDT</p>)}</details>}
    </>}
    {error && <p role="alert">{error}</p>}
    <button className="vta-demo-refresh" type="button" disabled={busy} onClick={() => void refresh()}>Обновить баланс</button>
  </section>;
}
