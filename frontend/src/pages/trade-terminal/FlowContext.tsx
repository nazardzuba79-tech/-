import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatCompact } from '../../lib/formatNumber';
import { formatTerminalQuote as formatPrice } from '../../lib/terminalExecution';
import { krakenSocket, type BookSnapshot, type LiveTrade } from '../../lib/krakenSocket';
import { terminalBookMetrics } from '../../lib/terminalMarket';

export function FlowContext({ book, pair, onPick }: { book: BookSnapshot; pair: string; onPick: (price: string) => void }) {
  const m = terminalBookMetrics(book.bids, book.asks);
  const currency = pair.split('/')[1];
  return <section className="rail-context" aria-label="Контекст исполнения">
    <div className="context-heading"><strong>MARKET CONTEXT</strong><span>Kraken · {currency}</span></div>
    <div className="context-metrics">
      <button disabled={m.bestBid === null} onClick={() => onPick(String(m.bestBid))}><span>Best bid</span><strong className="up">{m.bestBid === null ? '—' : formatPrice(m.bestBid)}</strong></button>
      <button disabled={m.bestAsk === null} onClick={() => onPick(String(m.bestAsk))}><span>Best ask</span><strong className="down">{m.bestAsk === null ? '—' : formatPrice(m.bestAsk)}</strong></button>
      <div><span>Спред</span><strong>{m.spread === null ? '—' : formatPrice(m.spread)}</strong></div>
      <div><span>Глубина ±0,5%</span><strong>{m.depth === null ? '—' : `${formatCompact(m.depth)} ${currency}`}</strong></div>
    </div>
    {m.bidShare !== null && <><div className="liquidity-balance" aria-label={`Bids ${(m.bidShare * 100).toFixed(1)}%, asks ${((1 - m.bidShare) * 100).toFixed(1)}%`}><span style={{ width: `${m.bidShare * 100}%` }} /></div><div className="liquidity-labels"><span>BID {(m.bidShare * 100).toFixed(1)}%</span><span>ASK {((1 - m.bidShare) * 100).toFixed(1)}%</span></div></>}
    <p className="flow-source">Публичная глубина Kraken. Ордер исполняется в стакане VOLTEX.</p>
  </section>;
}

export function FlowDepth({ book, pair }: { book: BookSnapshot; pair: string }) {
  const m = useMemo(() => terminalBookMetrics(book.bids, book.asks), [book]);
  const levels = [...m.bidLevels, ...m.askLevels];
  if (!levels.length || m.mid === null) return <div className="flow-empty">Глубина рынка недоступна</div>;
  const min = Math.min(...levels.map(l => l.price));
  const max = Math.max(...levels.map(l => l.price));
  let bidTotal = 0, askTotal = 0;
  const bids = m.bidLevels.map(l => ({ price: l.price, total: bidTotal += l.quantity }));
  const asks = m.askLevels.map(l => ({ price: l.price, total: askTotal += l.quantity }));
  const peak = Math.max(bidTotal, askTotal, Number.EPSILON);
  const x = (price: number) => 30 + (price - min) / (max - min || 1) * 340;
  const y = (size: number) => 210 - size / peak * 170;
  const path = (rows: typeof bids) => rows.map((l, i) => `${i ? 'L' : 'M'}${x(l.price)},${y(l.total)}`).join(' ');
  return <section className="flow-depth"><div className="context-heading"><strong>DEPTH</strong><span>{pair}</span></div>
    <svg viewBox="0 0 400 245" role="img" aria-label={`Накопленная глубина ${pair}`}>
      {[0, .5, 1].map(v => <g key={v}><line x1="30" x2="370" y1={y(peak*v)} y2={y(peak*v)} stroke="currentColor" opacity=".12"/><text x="30" y={y(peak*v)-5} fill="currentColor" fontSize="10">{formatCompact(peak*v)}</text></g>)}
      <path d={`${path(bids)} L${x(bids[bids.length-1].price)},210 L${x(bids[0].price)},210 Z`} fill="rgba(46,189,133,.12)" /><path d={path(bids)} fill="none" stroke="#40c99c" strokeWidth="2" />
      <path d={`${path(asks)} L${x(asks[asks.length-1].price)},210 L${x(asks[0].price)},210 Z`} fill="rgba(240,97,109,.12)" /><path d={path(asks)} fill="none" stroke="#ef7b87" strokeWidth="2" />
      <text x="30" y="234" fill="currentColor" fontSize="10">{formatPrice(min)}</text><text x="370" y="234" fill="currentColor" fontSize="10" textAnchor="end">{formatPrice(max)}</text>
    </svg><p className="flow-source">Накопленный объём {pair.split('/')[0]} · доступные уровни Kraken</p>
  </section>;
}

export function FlowTape({ pair, onPick, onHover }: { pair: string; onPick: (price: string) => void; onHover: (price: number | null) => void }) {
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  useEffect(() => {
    let active = true, received = false, version = 0;
    setTrades([]);
    const unsub = krakenSocket.subscribeTrades(pair, trade => {
      received = true;
      version += 1;
      if (active) setTrades(prev => [trade, ...prev.filter(t => t.id !== trade.id)].slice(0, 60));
    });
    const load = () => {
      if (received && krakenSocket.getStatus() === 'connected') return;
      const requestedVersion = version;
      void api.getExternalTrades(pair).then(res => {
        if (active && version === requestedVersion) setTrades(res.trades.slice(0, 60));
      }).catch(() => {});
    };
    const unsubStatus = krakenSocket.subscribeStatus(status => { if (status !== 'connected') received = false; });
    load(); const timer = window.setInterval(load, 5000);
    return () => { active = false; unsub(); unsubStatus(); window.clearInterval(timer); onHover(null); };
  }, [pair, onHover]);
  return <section className="flow-tape" aria-label="Публичные сделки Kraken"><div className="flow-tape-head"><span>Цена</span><span>{pair.split('/')[0]}</span><span>Время</span></div>
    {trades.length === 0 && <div className="flow-empty">Ожидание рыночных сделок</div>}
    {trades.map(trade => <button key={trade.id} onClick={() => onPick(trade.price)} onMouseEnter={() => onHover(Number(trade.price))} onMouseLeave={() => onHover(null)} onFocus={() => onHover(Number(trade.price))} onBlur={() => onHover(null)}>
      <strong className={trade.side === 'BUY' ? 'up' : 'down'}>{formatPrice(Number(trade.price))}</strong><span>{Number(trade.quantity).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span><time>{new Date(trade.time).toLocaleTimeString()}</time>
    </button>)}<p className="flow-source">Kraken · публичные сделки, не ордера аккаунта</p>
  </section>;
}
