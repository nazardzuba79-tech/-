import { Link } from 'react-router-dom';
import { CryptoIcon } from '../../components/CryptoIcon';
import { LogoMark } from '../../components/Logo';
import { HomeMarket, byVolume, formatPriceValue, formatCompactUsd } from './useHomeMarket';
import { LiveValue } from './LiveValue';
import { PreviewCandles } from './TerminalPreview';

const positive=(v:unknown):number|null=> (typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
const qty=(v:number)=>v.toLocaleString('en-US',{maximumFractionDigits:5});
const pct=(v:number)=>`${v>=0?'+':''}${v.toFixed(2)}%`;
const time=(v:number)=>new Date(v<1e12?v*1000:v).toLocaleTimeString('en-GB',{timeZone:'UTC',hour12:false});

export function SapphireTerminal({market}:{market:HomeMarket}){
  const f=market.hero,pair=f.pair??'BTC/USDT',lead=market.tickers.find(t=>t.pair===pair),base=pair.split('/')[0],quote=lead?.quote??'USDT';
  const candles=f.candles.filter(c=>[c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));
  const price=f.livePrice??lead?.price, last=candles[candles.length-1];
  const rows=byVolume(market.tickers.filter(r=>r.quote==='USDT'),12);
  const clean=(rows:{price:string;quantity:string}[])=>rows.filter(r=>positive(r.price)!==null&&positive(r.quantity)!==null).slice(0,10);
  const bids=clean(f.book?.bids??[]),asks=clean(f.book?.asks??[]);
  const maxQty=Math.max(1e-12,...[...bids,...asks].map(r=>Number(r.quantity)));
  const bidQty=bids.reduce((s,r)=>s+Number(r.quantity),0),askQty=asks.reduce((s,r)=>s+Number(r.quantity),0),total=bidQty+askQty;
  const bidShare=total>0?bidQty/total*100:null;
  const spread=bids.length&&asks.length?Number(asks[0].price)-Number(bids[0].price):null;
  const stale=market.tickersStale||f.stale,href=`/trade?pair=${encodeURIComponent(pair)}`;
  const updated=f.book?.timestamp??f.updatedAt;
  const trades=f.trades.filter(r=>positive(r.price)!==null&&positive(r.quantity)!==null&&Number.isFinite(r.time)&&r.time>0&&(r.side==='BUY'||r.side==='SELL')).slice(0,6);
  const bookRows=(side:'ask'|'bid',rows:typeof bids)=>rows.map(r=><div className={`book-row ${side}`} key={r.price}><i className="hs-depth-bar" style={{width:`${Number(r.quantity)/maxQty*100}%`}}/><LiveValue value={Number(r.price)}/><LiveValue value={Number(r.quantity)} format={qty}/></div>);
  return <div id="home-live-terminal" className="terminal-screen-content hs-terminal-detail" data-stale={stale}>
    <div className="ts-nav"><span className="ts-brand"><LogoMark size={17}/> VOLTEX</span><span className="ts-active">Spot</span><span>Markets</span><span>Futures</span><span className="feed-state"><i className="hs-receipt" key={stale?'stale':updated??'loading'}/>{stale?'Stale':f.streaming?'Streaming':'15s refresh'}</span></div>
    <div className="hs-market-summary"><div className="hs-summary-pair"><CryptoIcon symbol={base} size={27} imageUrl={market.logoOf(base)}/><strong>{pair}</strong><LiveValue value={price} className={(lead?.change??0)>=0?'bid':'ask'}/></div><div><small>24h Change</small><LiveValue value={lead?.change} format={pct} className={(lead?.change??0)>=0?'bid':'ask'}/></div><div><small>24h High</small><LiveValue value={lead?.high}/></div><div><small>24h Low</small><LiveValue value={lead?.low}/></div><div><small>24h Volume ({quote})</small><LiveValue value={lead?.quoteVolume} format={formatCompactUsd}/></div></div>
    <div className="ts-grid"><aside className="pairs"><div className="search">⌕ Search pairs</div><div className="hs-pairs-heading"><span>USDT</span><span>24h %</span></div>{rows.map(row=><Link className="pair" to={`/trade?pair=${encodeURIComponent(row.pair)}`} key={row.pair}><CryptoIcon symbol={row.base} size={20} imageUrl={market.logoOf(row.base)}/><span className="hs-pair-name">{row.base}<LiveValue value={row.price}/></span><LiveValue value={row.change} className={row.change>=0?'bid':'ask'} format={pct}/></Link>)}</aside>
      <section className="ts-center"><div className="ts-tools">1m　5m　<span className="ts-active">15m</span>　1h　4h　Indicators</div><div className="hs-ohlc">{(['open','high','low','close'] as const).map(k=><span key={k}>{k[0].toUpperCase()} <LiveValue value={last?.[k]}/></span>)}</div><div className="hs-chart">{candles.length?<PreviewCandles candles={candles.slice(-50)} livePrice={f.livePrice} label={`${pair} · real 15-minute candles`}/>:<span className="hs-empty">{f.candlesStatus==='loading'?'Loading market data…':'Data unavailable'}</span>}</div><div className="ts-note">15-minute candles · UTC {f.candlesStatus==='error'?'· Stale':''}</div></section>
      <aside className="ts-book"><div className="book-title">Order Book <small>{f.bookStatus==='error'?'Stale':quote}</small></div><div className="hs-book-heading"><span>Price</span><span>Amount ({base})</span></div>{bids.length&&asks.length?<>{bookRows('ask',[...asks].reverse())}<div className="book-mid"><LiveValue value={price}/><small>Spread <LiveValue value={spread!==null&&spread>=0?spread:null}/></small></div>{bookRows('bid',bids)}</>:<span className="hs-empty">Data unavailable</span>}</aside>
      <aside className="ts-order"><div className="ts-tabs"><Link to={href}>Buy</Link><Link to={href}>Sell</Link></div><div>Limit　 Market</div><div className="ts-label">Price ({quote})</div><div className="ts-input"><LiveValue value={price}/></div><div className="ts-label">Amount ({base})</div><div className="ts-input">—</div><div className="ts-label">Total ({quote})</div><div className="ts-input">—</div><Link className="ts-buy" to={href}>Open terminal ↗</Link><div className="hs-depth-title">Visible depth ({base})</div><div className="hs-depth-share"><span className="bid">Buy {bidShare===null?'—':bidShare.toFixed(1)+'%'}</span><span className="ask">Sell {bidShare===null?'—':(100-bidShare).toFixed(1)+'%'}</span></div>{bidShare!==null&&<div className="hs-depth-track"><i style={{width:`${bidShare}%`}}/></div>}</aside>
    </div><div className="hs-recent-trades"><div className="hs-trades-title">Recent market trades <small>{f.tradesStatus==='error'?'Stale':pair}</small></div><div className="hs-trade-head"><span>Time (UTC)</span><span>Pair</span><span>Side</span><span>Price ({quote})</span><span>Amount ({base})</span></div>{trades.map(r=><div className="hs-trade-row" key={r.id??`${r.time}-${r.side}-${r.price}-${r.quantity}`}><span>{time(r.time)}</span><span>{pair}</span><span className={r.side==='BUY'?'bid':'ask'}>{r.side==='BUY'?'Buy':'Sell'}</span><span>{formatPriceValue(Number(r.price))}</span><span>{qty(Number(r.quantity))}</span></div>)}{!trades.length&&<span className="hs-empty">Data unavailable</span>}</div>
    <div className="ts-footer"><span>{stale?'Stale market data':'Public market data'} · {market.tickerSource||'—'}</span><span>Updated {updated?time(updated):'—'} UTC</span></div>
  </div>;
}
