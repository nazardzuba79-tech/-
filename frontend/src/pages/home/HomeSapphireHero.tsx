import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { LogoMark } from '../../components/Logo';
import { useLanguage } from '../../lib/i18n';
import { HomeHeroAssets } from './HomeHeroAssets';
import { LiveValue } from './LiveValue';
import { PreviewCandles } from './TerminalPreview';
import { HomeMarket, byVolume, formatPriceValue } from './useHomeMarket';
import { useHeroStream } from './useHeroStream';
import { HomeSapphireTape } from './HomeSapphireTape';

// Approved 1672x941 artwork. Project a real DOM display over its screen;
// the bitmap is decoration, never the authority for prices or order state.
export const SAPPHIRE_SCREEN = [[878,333],[1593,298],[1563,760],[809,721]];
export function sapphireProjection(width: number, height: number, mobile: boolean) {
  const scale=Math.max(width/1672,height/941), ox=(width-1672*scale)*(mobile?1:.5), oy=(height-941*scale)/2;
  const points=SAPPHIRE_SCREEN.map(([x,y])=>[ox+x*scale,oy+y*scale]);
  const from=[[0,0],[1000,0],[1000,600],[0,600]], a:number[][]=[];
  for(let i=0;i<4;i++){const[x,y]=from[i],[u,v]=points[i];a.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);}
  for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(a[r][c])>Math.abs(a[p][c]))p=r;
    [a[p],a[c]]=[a[c],a[p]];const d=a[c][c];for(let j=c;j<9;j++)a[c][j]/=d;
    for(let r=0;r<8;r++)if(r!==c){const f=a[r][c];for(let j=c;j<9;j++)a[r][j]-=f*a[c][j];}}
  const h=a.map(r=>r[8]);return `matrix3d(${h[0]},${h[3]},0,${h[6]},${h[1]},${h[4]},0,${h[7]},0,0,1,0,${h[2]},${h[5]},0,1)`;
}
function SapphireTerminal({market}:{market:HomeMarket}){
  const f=market.hero,pair=f.pair??'BTC/USDT',lead=market.tickers.find(t=>t.pair===pair),base=pair.split('/')[0];
  const candles=f.candles.filter(c=>[c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));
  const price=f.livePrice??lead?.price;
  const rows=byVolume(market.tickers.filter(r=>r.quote==='USDT'),8);
  const href=`/trade?pair=${encodeURIComponent(pair)}`;
  return <div id="home-live-terminal" className="terminal-screen-content" data-stale={market.tickersStale||f.stale}>
    <div className="ts-nav"><span className="ts-brand"><LogoMark size={17}/> VOLTEX</span><span className="ts-active">Spot</span><span>Markets</span><span>Futures</span><span className="feed-state">{market.tickersStale||f.stale?'Stale':f.streaming?'● Streaming':'15s refresh'}</span></div>
    <div className="ts-grid"><aside className="pairs"><div className="search">⌕ Search pairs</div>{rows.map(row=><Link className="pair" to={`/trade?pair=${encodeURIComponent(row.pair)}`} key={row.pair}><CryptoIcon symbol={row.base} size={23} imageUrl={market.logoOf(row.base)}/><span>{row.pair}</span></Link>)}</aside>
      <section className="ts-center"><div className="ts-price"><strong>{pair}</strong><LiveValue value={price}/></div><div className="ts-tools">1m　5m　<span className="ts-active">15m</span>　1h　4h　Indicators</div>
        <div className="hs-chart">{candles.length?<PreviewCandles candles={candles.slice(-50)} livePrice={f.livePrice} label={`${pair} · real 15-minute candles`}/>:<span className="hs-empty">{f.candlesStatus==='loading'?'Loading market data…':'Data unavailable'}</span>}</div><div className="ts-note">15-minute candles · UTC {f.candlesStatus==='error'?'· Stale':''}</div>
      </section><aside className="ts-book"><div className="book-title">Order Book</div>{f.book? <>{f.book.asks.slice(0,8).reverse().map(r=><div className="book-row ask" key={r.price}><span>{formatPriceValue(Number(r.price))}</span><span>{Number(r.quantity).toFixed(4)}</span></div>)}<div className="book-mid"><LiveValue value={price}/></div>{f.book.bids.slice(0,8).map(r=><div className="book-row bid" key={r.price}><span>{formatPriceValue(Number(r.price))}</span><span>{Number(r.quantity).toFixed(4)}</span></div>)}</>:<span>Data unavailable</span>}{f.bookStatus==='error'&&f.book&&<small>Stale</small>}</aside>
      <aside className="ts-order"><div className="ts-tabs"><Link to={href}>Buy</Link><Link to={href}>Sell</Link></div><div>Limit　 Market</div><div className="ts-label">Price ({lead?.quote??'USDT'})</div><div className="ts-input"><LiveValue value={price}/></div><div className="ts-label">Amount ({base})</div><div className="ts-input">—</div><div className="ts-label">Total ({lead?.quote??'USDT'})</div><div className="ts-input">—</div><Link className="ts-buy" to={href}>Open terminal ↗</Link><div className="ts-label">Public market preview</div></aside>
    </div><div className="ts-footer">Public trades <span>{f.trades[0]?`${f.trades[0].side} · ${formatPriceValue(Number(f.trades[0].price))}`:'—'}</span></div>
  </div>;
}
export function HomeSapphireHero({market}:{market:HomeMarket}){
  const live=useHeroStream(market),{t}=useLanguage(),art=useRef<HTMLImageElement>(null),display=useRef<HTMLDivElement>(null),hero=useRef<HTMLDivElement>(null);
  const [aligned,setAligned]=useState(false);
  useEffect(()=>{const image=art.current,screen=display.current,section=hero.current;if(!image||!screen||!section)return;
    const align=()=>{const b=image.getBoundingClientRect(),p=section.getBoundingClientRect();if(!b.width||!b.height)return;screen.style.transform=sapphireProjection(b.width,b.height,window.innerWidth<=900);screen.style.left=`${b.left-p.left}px`;screen.style.top=`${b.top-p.top}px`;setAligned(true);};
    const observer=new ResizeObserver(align);observer.observe(section);observer.observe(image);image.addEventListener('load',align);align();return()=>{observer.disconnect();image.removeEventListener('load',align);};},[]);
  return <section id="home-global-hero" className="hs-root" data-design="sapphire-gold" aria-labelledby="hs-title">
    <div className="hero" ref={hero}><img ref={art} className="art" src="/hero/sapphire-refined.png" width="1672" height="941" alt="" aria-hidden="true" fetchPriority="high"/>
      <div className="terminal-screen" ref={display} style={{visibility:aligned?'visible':'hidden'}}><SapphireTerminal market={live}/></div>
      <HomeHeroAssets market={live} englishLabels/>
      <div className="shade" aria-hidden="true"/><div className="copy"><p className="eyebrow">GLOBAL MARKETS. REAL OPPORTUNITIES.</p><h1 id="hs-title">OWN YOUR{' '}<span>FUTURE<i>.</i></span></h1><p className="subtitle">{t('home.hero.subtitle')}</p><p className="description">{t('home.hero.description')}</p><div className="actions"><Link className="primary" to="/trade">{t('home.cta.openTerminal')}<ArrowRight size={19}/></Link><Link className="secondary" to="/markets">{t('home.cta.viewMarkets')}</Link></div><div className="product-links"><Link to="/trade">Spot</Link><Link to="/futures">Futures</Link><Link to="/copy-trading">Copy Trading</Link><Link to="/card">Crypto Card</Link></div></div>
    </div><HomeSapphireTape market={market}/>
  </section>;
}
