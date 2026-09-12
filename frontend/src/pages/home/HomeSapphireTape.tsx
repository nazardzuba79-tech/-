import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CryptoIcon } from '../../components/CryptoIcon';
import { HomeMarket, byVolume } from './useHomeMarket';
import { LiveValue } from './LiveValue';

export function HomeSapphireTape({market}:{market:HomeMarket}){
  const rows=byVolume(market.tickers,12),tape=useRef<HTMLDivElement>(null),bar=useRef<HTMLInputElement>(null),hold=useRef(0),[paused,setPaused]=useState(false);
  useEffect(()=>{const motion=matchMedia('(prefers-reduced-motion: reduce)');const sync=()=>setPaused(motion.matches);sync();motion.addEventListener('change',sync);return()=>motion.removeEventListener('change',sync);},[]);
  useEffect(()=>{const node=tape.current,range=bar.current;if(!node||!range)return;const sync=()=>{range.max=String(Math.max(0,node.scrollWidth-node.clientWidth));range.value=String(node.scrollLeft);range.style.setProperty('--thumb-width',`${Math.max(35,range.clientWidth*node.clientWidth/Math.max(1,node.scrollWidth))}px`);};sync();const observer=new ResizeObserver(sync);observer.observe(node);node.addEventListener('scroll',sync,{passive:true});return()=>{observer.disconnect();node.removeEventListener('scroll',sync);};},[rows.length]);
  useEffect(()=>{const node=tape.current;if(!node)return;let frame=0,previous=0,position=node.scrollLeft,visible=false,hover=false;
    const observer=new IntersectionObserver(([e])=>visible=e.isIntersecting);observer.observe(node);const enter=()=>hover=true,leave=()=>hover=false;node.addEventListener('mouseenter',enter);node.addEventListener('mouseleave',leave);
    const move=(now:number)=>{const dt=previous?Math.min((now-previous)/1000,.05):0;previous=now;if(!paused&&!market.tickersStale&&!document.hidden&&visible&&!hover&&!node.contains(document.activeElement)&&now>hold.current){position+=dt*17;const max=node.scrollWidth-node.clientWidth;if(position>max){position=0;hold.current=now+1800;}node.scrollLeft=position;}else position=node.scrollLeft;frame=requestAnimationFrame(move);};frame=requestAnimationFrame(move);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();node.removeEventListener('mouseenter',enter);node.removeEventListener('mouseleave',leave);};
  },[paused,market.tickersStale]);
  const stop=()=>hold.current=performance.now()+8000;
  return <div className="hs-tape" data-stale={market.tickersStale}><div className="tape-controls"><span>{market.tickersStale?'Stale quotes':'Market quotes'} · 15s</span><button type="button" aria-pressed={paused} onClick={()=>setPaused(!paused)}>{paused?'Resume scrolling':'Pause scrolling'}</button></div>
    <div ref={tape} className="ticker-strip" tabIndex={0} role="region" aria-label="Market quotes — scroll horizontally" onPointerDown={stop} onWheel={stop} onTouchStart={stop} onKeyDown={e=>{const node=tape.current;if(!node)return;stop();const max=node.scrollWidth-node.clientWidth;const target:{[k:string]:number}={Home:0,End:max,ArrowLeft:Math.max(0,node.scrollLeft-180),ArrowRight:Math.min(max,node.scrollLeft+180)};if(e.key in target){e.preventDefault();node.scrollLeft=target[e.key];}}}>
      {rows.map(row=><Link className="tick" key={row.pair} to={`/trade?pair=${encodeURIComponent(row.pair)}`}><CryptoIcon symbol={row.base} imageUrl={market.logoOf(row.base)} size={31}/><span><small>{row.pair}</small><LiveValue value={row.price}/></span><LiveValue value={row.change} className={row.change>=0?'up':'down'} format={v=>`${v>=0?'+':''}${v.toFixed(2)}%`}/></Link>)}
      {!rows.length&&<div className="hs-tape-empty">{market.tickersStatus==='loading'?'Loading market data…':'Data unavailable'}</div>}
    </div><input ref={bar} className="tape-scrollbar" type="range" min="0" max="0" defaultValue="0" step="1" aria-label="Scroll market quotes horizontally" onPointerDown={stop} onChange={e=>{stop();if(tape.current)tape.current.scrollLeft=Number(e.target.value);}}/>
  </div>;
}
