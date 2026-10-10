import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import BigNumber from 'bignumber.js';
import { useLanguage } from '../../lib/i18n';
import { OrderFamilyTabs, type OrderFamily } from '../../components/OrderFamilyPresentation';
import { StockRequestError } from './stockRequestError';
import { simulatorText } from './stockSimulatorText';
import './stockSimulator.css';

declare const __VOLTEX_STOCKS_SIMULATOR__: boolean;
export const simulatorEnabled = typeof __VOLTEX_STOCKS_SIMULATOR__ !== 'undefined' && __VOLTEX_STOCKS_SIMULATOR__
  && typeof window !== 'undefined' && window.location.hostname === '127.0.0.1';
type Currency = 'USDT' | 'USDC';
type Quote = { priceUsd: string; timestamp: number; receivedAt: number; marketOpen: boolean; status: string; provider: string };
type Position = { symbol: string; currency: Currency; quantity: string; available: string; reserved: string; average: string | null; mark: string | null; unrealized: string | null; realized: string };
type Order = { id: string; symbol: string; currency: Currency; side: 'BUY' | 'SELL'; type: 'MARKET' | 'LIMIT'; quantity: string; limitPrice: string | null; status: string; createdAt: number };
type Fill = { id: string; symbol: string; currency: Currency; side: string; quantity: string; price: string; fee: string; realized: string; timestamp: number };
type State = {
  revision: number; token?: string; maxQuoteAgeSeconds: number; serverTime: number;
  settings: { feeBps: number; usdPerUnit: Record<Currency, string> };
  wallets: Record<Currency, { cash: string; available: string; reserved: string }>;
  positions: Record<string, Position>; orders: Order[]; fills: Fill[]; quotes: Record<string, Quote>;
  realized: Record<Currency, string>; source: { mode: string; errors: Record<string, string> };
  adjustments?: Array<{ id: string; timestamp: number; balances: Record<Currency, string> }>;
};
type Draft = { symbol: string; currency: Currency; quantity: string; nonce: number };
type SimContext = { state: State | null; currency: Currency; setCurrency: (c: Currency) => void; busy: boolean; connected: boolean;
  error: string; message: string; symbol: string; draft: Draft | null; prepareSell: (p: Position, half: boolean) => void;
  act: (path: string, body: unknown, message?: string) => Promise<boolean>; reload: () => Promise<void> };
const Context = createContext<SimContext | null>(null);
const useSim = () => useContext(Context)!;
const format = (value: string | null | undefined, digits = 8) => value == null ? '—' : new BigNumber(value).toFixed(digits, BigNumber.ROUND_DOWN).replace(/\.?0+$/, '') || '0';
const positive = (value: string) => /^\d+(\.\d{1,8})?$/.test(value) && new BigNumber(value).gt(0);
const fresh = (q: Quote | undefined, state: State | null) => !!q && !!state && q.status === 'READY' && Date.now() - q.timestamp <= state.maxQuoteAgeSeconds * 1000 && Date.now() - q.receivedAt <= 30_000;
const KEY = 'voltex.stocks.simulator.pending.v1';

export function SimulatorProvider({ symbol, children }: { symbol: string; children: ReactNode }) {
  const [state, setState] = useState<State | null>(null), [busy, setBusy] = useState(false), [connected, setConnected] = useState(false);
  const [currency, setCurrency] = useState<Currency>('USDT'), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null); const token = useRef(''); const gate = useRef(false); const navigate = useNavigate();
  const accept = useCallback((next: State) => { if (next.token) token.current = next.token; setState(old => !old || next.revision >= old.revision ? next : old); }, []);
  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/__stocks_simulator/state?symbol=${encodeURIComponent(symbol)}`, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw Error('LOCAL_SERVICE_ERROR'); const next = await res.json();
      if (next.schema !== 1 || typeof next.revision !== 'number') throw Error('LOCAL_SERVICE_ERROR');
      accept(next); setConnected(true);
    } catch { setConnected(false); }
  }, [symbol, accept]);
  const act = useCallback(async (path: string, body: unknown, notice = '') => {
    if (gate.current) return false; gate.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/__stocks_simulator/' + path, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'X-Stocks-Token': token.current }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
      const data = await res.json(); if (!res.ok) throw new StockRequestError(data.error);
      accept(data); setConnected(true); setMessage(notice); return true;
    } catch (e) { setError(e instanceof StockRequestError ? e.code : 'LOCAL_SERVICE_ERROR'); return false; }
    finally { gate.current = false; setBusy(false); }
  }, [accept]);
  useEffect(() => {
    let active = true;
    void reload().then(() => { if (active && token.current) void act('refresh', { symbol }); });
    const timer = window.setInterval(() => { void reload(); }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [symbol, reload, act]);
  const prepareSell = (p: Position, half: boolean) => {
    const quantity = new BigNumber(p.available).dividedBy(half ? 2 : 1).toFixed(8, BigNumber.ROUND_DOWN);
    setCurrency(p.currency); setDraft({ symbol: p.symbol, currency: p.currency, quantity, nonce: Date.now() });
    navigate(`/stocks/${encodeURIComponent('XNGS:' + p.symbol)}`);
  };
  return <Context.Provider value={{ state, currency, setCurrency, busy, connected, error, message, symbol, draft, prepareSell, act, reload }}>{children}</Context.Provider>;
}

export function SimulatorTicket() {
  const sim = useSim(), { t, lang } = useLanguage(), labels = simulatorText(lang);
  const { state, symbol, currency, setCurrency, busy, connected } = sim;
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY'), [family, setFamily] = useState<OrderFamily>('MARKET');
  const [price, setPrice] = useState(''), [quantity, setQuantity] = useState('');
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (sim.draft?.symbol === symbol) { setSide('SELL'); setFamily('MARKET'); setQuantity(sim.draft.quantity); form.current?.scrollIntoView({ block: 'nearest' }); } }, [sim.draft, symbol]);
  const quote = state?.quotes[symbol], ready = connected && fresh(quote, state);
  const marketPrice = ready ? new BigNumber(quote!.priceUsd).dividedBy(state!.settings.usdPerUnit[currency]).toFixed(8, side === 'BUY' ? BigNumber.ROUND_CEIL : BigNumber.ROUND_FLOOR) : '';
  const effectivePrice = family === 'MARKET' ? marketPrice : price;
  const amount = positive(effectivePrice) && positive(quantity) ? new BigNumber(effectivePrice).times(quantity).decimalPlaces(8, side === 'BUY' ? BigNumber.ROUND_CEIL : BigNumber.ROUND_FLOOR) : null;
  const fee = amount && state ? amount.times(state.settings.feeBps).div(10000).decimalPlaces(8, BigNumber.ROUND_CEIL) : null;
  const total = amount && fee ? (side === 'BUY' ? amount.plus(fee) : amount.minus(fee)).toFixed(8, side === 'BUY' ? BigNumber.ROUND_CEIL : BigNumber.ROUND_FLOOR) : '';
  const sourceError = state?.source.errors[symbol] || (state?.source.mode === 'public-aapl-trial' && symbol !== 'AAPL' ? 'SOURCE_KEY_REQUIRED' : quote?.status !== 'READY' ? quote?.status : !ready ? 'QUOTE_STALE' : '');
  const send = async () => {
    const order = { symbol, currency, side, type: family, quantity: new BigNumber(quantity).toFixed(8), ...(family === 'LIMIT' ? { limitPrice: new BigNumber(price).toFixed(8) } : {}) };
    const signature = JSON.stringify(order); let id = crypto.randomUUID();
    try { const pending = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (pending?.signature === signature && typeof pending.id === 'string') id = pending.id; sessionStorage.setItem(KEY, JSON.stringify({ signature, id })); } catch { /* Server idempotency still protects this in-flight request. */ }
    if (await sim.act('orders', { ...order, id }, labels.sent)) { try { sessionStorage.removeItem(KEY); } catch {} setQuantity(''); }
  };
  return <section className="vxs-order-panel vxs-sim-ticket" aria-label={t('nav.trade')}>
    <h2 className="vxs-order-heading">{t('nav.trade')} <span className="vxs-sim-pair">{symbol}/{currency}</span></h2>
    <div className="vxs-order-content">
      <p className="vxs-sim-notice">{labels.notice}</p>
      <div className="vxs-sim-currencies" role="group" aria-label={labels.pair}>{(['USDT','USDC'] as const).map(c => <button type="button" key={c} aria-pressed={c === currency} onClick={() => setCurrency(c)}>{symbol}/{c}</button>)}</div>
      <div className="vxs-side-tabs" role="tablist" aria-label={t('nav.trade')}>{(['BUY','SELL'] as const).map(value => <button type="button" key={value} role="tab" aria-selected={value === side} className={`${value.toLowerCase()}${side === value ? ' active' : ''}`} onClick={() => setSide(value)}>{t(value === 'BUY' ? 'trade.buy' : 'trade.sell')}</button>)}</div>
      <OrderFamilyTabs value={family} onChange={setFamily} archive allowedFamilies={['LIMIT','MARKET']} />
      <div className="vxs-order-available"><span>{labels.available}</span><strong>{format(side === 'BUY' ? state?.wallets[currency].available : state?.positions[`${symbol}/${currency}`]?.available ?? '0')} {side === 'BUY' ? currency : symbol}</strong></div>
      <form ref={form} className="vxs-order-form" onSubmit={e => { e.preventDefault(); void send(); }}>
        <label className="vxs-order-field"><span>{labels.price}</span><div><input aria-label={labels.price} inputMode="decimal" value={effectivePrice} placeholder="—" readOnly={family === 'MARKET'} onChange={e => setPrice(e.target.value)} /><span>{currency}</span></div></label>
        <label className="vxs-order-field"><span>{labels.quantity}</span><div><input aria-label={labels.quantity} inputMode="decimal" autoComplete="off" value={quantity} placeholder="0.00" onChange={e => setQuantity(e.target.value)} /><span>{symbol}</span></div></label>
        <label className="vxs-order-field"><span>{labels.total}</span><div><input aria-label={labels.total} value={total ? format(total) : ''} placeholder="—" readOnly /><span>{currency}</span></div></label>
        <div className="vxs-sim-meta"><span>{labels.fee}</span><span>{state ? state.settings.feeBps / 100 + '%' : '—'}</span></div>
        <button type="submit" className={`vxs-order-submit ${side.toLowerCase()}`} disabled={busy || !state || !connected || !positive(quantity) || !positive(effectivePrice) || (family === 'MARKET' && !ready)}>{t(side === 'BUY' ? 'trade.buy' : 'trade.sell')} {symbol}</button>
      </form>
      {(sim.error || sim.message) && <p className={`vxs-sim-feedback${sim.error ? ' is-error' : ''}`} role="status">{sim.error ? labels.errors[sim.error] || labels.unknown : sim.message}</p>}
      <div className="vxs-sim-source">
        <strong>{labels.source}: {ready ? `${format(quote!.priceUsd)} USD` : '—'}</strong>
        <span>{quote?.provider || '—'} · {labels.min}</span>
        {quote && <span>{new Date(quote.timestamp).toISOString().slice(11,19)} UTC · {labels.age}: {Math.max(0,Math.floor((Date.now()-quote.timestamp)/1000))} {labels.seconds}</span>}
        <span>{labels.conversion}: 1 {currency} = {format(state?.settings.usdPerUnit[currency])} USD</span>
        {!connected && <span role="status">{state ? labels.unavailable : labels.waiting}</span>}
        {sourceError && <span className="vxs-sim-source-error" role="status">{labels.errors[sourceError] || labels.noQuote}</span>}
        <button type="button" disabled={busy || !connected} onClick={() => void sim.act('refresh', { symbol })}>{labels.refresh}</button>
      </div>
      {state && <WalletSettings />}
    </div>
  </section>;
}

function WalletSettings() {
  const sim = useSim(), state = sim.state!, { lang } = useLanguage(), labels = simulatorText(lang);
  const [balances, setBalances] = useState({ USDT: format(state.wallets.USDT.cash), USDC: format(state.wallets.USDC.cash) });
  const [rates, setRates] = useState({ USDT: format(state.settings.usdPerUnit.USDT), USDC: format(state.settings.usdPerUnit.USDC) });
  const [fee, setFee] = useState(String(state.settings.feeBps)); const locked = state.orders.length > 0;
  return <details className="vxs-sim-settings" onToggle={e => { if (e.currentTarget.open) setBalances({ USDT: format(state.wallets.USDT.cash), USDC: format(state.wallets.USDC.cash) }); }}><summary>{labels.settings}</summary>
    {locked && <p>{labels.settingsLocked}</p>}
    <form onSubmit={e => { e.preventDefault(); void sim.act(locked ? 'balances' : 'settings', locked ? { id: crypto.randomUUID(), balances } : { balances, usdPerUnit: rates, feeBps: Number(fee) }, labels.configured); }}>
      {(['USDT','USDC'] as const).map(c => <div key={c}><label>{labels.balance} {c}<input aria-label={`${labels.balance} ${c}`} inputMode="decimal" value={balances[c]} onChange={e => setBalances({ ...balances, [c]: e.target.value })} /></label>
        <label>1 {c} = USD<input aria-label={`USD / ${c}`} inputMode="decimal" disabled={locked} value={rates[c]} onChange={e => setRates({ ...rates, [c]: e.target.value })} /></label></div>)}
      <p>{labels.conversionHelp}</p><label>{labels.feeBps}<input aria-label={labels.feeBps} inputMode="numeric" disabled={locked} value={fee} onChange={e => setFee(e.target.value)} /></label>
      <button type="submit" disabled={sim.busy}>{labels.apply}</button>
    </form>
    {(state.adjustments || []).slice(-5).reverse().map(a => <p key={a.id}>{new Date(a.timestamp).toLocaleString(lang)} · {format(a.balances.USDT)} USDT · {format(a.balances.USDC)} USDC</p>)}
  </details>;
}

export function SimulatorAccount() {
  const sim = useSim(), { lang } = useLanguage(), labels = simulatorText(lang), state = sim.state;
  const [tab, setTab] = useState<'positions' | 'active' | 'orders' | 'fills'>('positions');
  const positions = Object.values(state?.positions || {}).filter(p => new BigNumber(p.quantity).gt(0));
  const orders = (state?.orders || []).filter(o => tab !== 'active' || o.status === 'OPEN').slice(-100).reverse();
  const stamp = (time: number) => new Date(time).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return <section className="vxs-tile vxs-sim-account" aria-label={labels.positions}>
    <div className="vxs-sim-wallets">{(['USDT','USDC'] as const).map(c => <div key={c}><strong>{format(state?.wallets[c].available)} <small>{c}</small></strong><span>{labels.reserved}: {format(state?.wallets[c].reserved)} · {labels.realized}: {format(state?.realized[c])}</span></div>)}</div>
    <div className="vxs-sim-account-tabs" role="tablist" aria-label={labels.orders}>{(['positions','active','orders','fills'] as const).map(id => <button type="button" key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{labels[id]}{id === 'positions' ? ` (${positions.length})` : id === 'active' ? ` (${state?.orders.filter(o=>o.status==='OPEN').length ?? 0})` : ''}</button>)}</div>
    <div className="vxs-sim-records" role="tabpanel">
      {!state && <p className="vxs-sim-empty">{labels.waiting}</p>}
      {state && tab === 'positions' && (!positions.length ? <p className="vxs-sim-empty">{labels.empty}</p> : positions.map(p => <article className="vxs-sim-position" key={`${p.symbol}/${p.currency}`}>
        <div className="vxs-sim-record-title"><strong>{p.symbol}/{p.currency}</strong><span>{format(p.quantity)} {p.symbol}</span></div>
        <dl><div><dt>{labels.average}</dt><dd>{format(p.average)}</dd></div><div><dt>{labels.mark}</dt><dd>{fresh(state.quotes[p.symbol],state) ? format(p.mark) : '—'}</dd></div><div><dt>{labels.unrealized}</dt><dd className={p.unrealized?.startsWith('-') ? 'loss' : 'gain'}>{fresh(state.quotes[p.symbol],state) ? format(p.unrealized) : '—'} {p.currency}</dd></div><div><dt>{labels.realized}</dt><dd>{format(p.realized)} {p.currency}</dd></div></dl>
        <div className="vxs-sim-position-actions"><span>{labels.reserved}: {format(p.reserved)}</span><button type="button" disabled={sim.busy || !positive(p.available)} onClick={() => sim.prepareSell(p,true)}>{labels.half}</button><button type="button" disabled={sim.busy || !positive(p.available)} onClick={() => sim.prepareSell(p,false)}>{labels.all}</button></div>
      </article>))}
      {(tab === 'active' || tab === 'orders') && (!orders.length ? <p className="vxs-sim-empty">{labels.empty}</p> : orders.map(o => <article className="vxs-sim-record" key={o.id}>
        <div className="vxs-sim-record-title"><strong>{o.symbol}/{o.currency}</strong><span className={o.side === 'BUY' ? 'gain' : 'loss'}>{o.side} · {o.type}</span></div>
        <div>{format(o.quantity)} {o.symbol} · {o.limitPrice ? format(o.limitPrice) + ' ' + o.currency : 'Market'} <span>{stamp(o.createdAt)}</span></div>
        <div><span>{o.status === 'FILLED' ? labels.filled : o.status === 'OPEN' ? labels.open : labels.cancelledStatus}</span>{o.status === 'OPEN' && <button type="button" disabled={sim.busy} onClick={() => void sim.act('cancel', { id: o.id }, labels.cancelled)}>{labels.cancel}</button>}</div>
      </article>))}
      {tab === 'fills' && (!(state?.fills.length) ? <p className="vxs-sim-empty">{labels.empty}</p> : state.fills.slice(-100).reverse().map(f => <article className="vxs-sim-record" key={f.id}>
        <div className="vxs-sim-record-title"><strong>{f.symbol}/{f.currency}</strong><span className={f.side === 'BUY' ? 'gain' : 'loss'}>{f.side}</span></div>
        <div>{format(f.quantity)} × {format(f.price)} {f.currency}<span>{stamp(f.timestamp)}</span></div><div>{labels.realized}: {format(f.realized)} {f.currency} · {labels.fee}: {format(f.fee)}</div>
      </article>))}
    </div>
  </section>;
}
