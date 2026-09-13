import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { HomeMarket, byVolume } from './useHomeMarket';
import { LiveValue } from './LiveValue';

export function HomeSapphireTape({ market }: { market: HomeMarket }) {
  const rows = byVolume(market.tickers, 12);
  const tape = useRef<HTMLDivElement>(null), group = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLInputElement>(null), hold = useRef(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const node = tape.current, set = group.current, range = bar.current;
    if (!node || !set || !range) return;
    const sync = () => {
      range.max = String(set.offsetWidth);
      range.value = String(node.scrollLeft % Math.max(1, set.offsetWidth));
      range.style.setProperty('--thumb-width', `${Math.max(35, range.clientWidth * node.clientWidth / Math.max(1, node.scrollWidth))}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node); observer.observe(set);
    node.addEventListener('scroll', sync, { passive: true });
    return () => { observer.disconnect(); node.removeEventListener('scroll', sync); };
  }, [rows.length]);
  useEffect(() => {
    const node = tape.current, set = group.current;
    if (!node || !set) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, previous = 0, position = node.scrollLeft, visible = false;
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(node);
    const move = (now: number) => {
      const dt = previous ? Math.min((now - previous) / 1000, .05) : 0;
      previous = now;
      if (!paused && !market.tickersStale && !document.hidden && visible
        && !node.contains(document.activeElement) && now > hold.current && set.offsetWidth > 0) {
        // The identical second set makes the wrap visually continuous. The
        // owner requested motion by default; reduced motion uses a gentler speed.
        position = (position + dt * (motion.matches ? 12 : 34)) % set.offsetWidth;
        node.scrollLeft = position;
      } else position = node.scrollLeft;
      frame = requestAnimationFrame(move);
    };
    frame = requestAnimationFrame(move);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [paused, market.tickersStale]);
  const stop = () => { hold.current = performance.now() + 8000; };
  const renderRows = (duplicate: boolean) => rows.map(row => (
    <Link className="tick" key={row.pair} tabIndex={duplicate ? -1 : undefined} to={`/trade?pair=${encodeURIComponent(row.pair)}`}>
      <CryptoIcon symbol={row.base} imageUrl={market.logoOf(row.base)} size={31}/>
      <span><small>{row.pair}</small><LiveValue value={row.price}/></span>
      <LiveValue value={row.change} className={row.change >= 0 ? 'up' : 'down'} format={v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}/>
    </Link>
  ));
  return <div className="hs-tape hs-tape-continuous" data-stale={market.tickersStale}>
    <button className="tape-motion-toggle" type="button" aria-label={paused ? 'Resume scrolling' : 'Pause scrolling'} aria-pressed={paused} onClick={() => setPaused(!paused)}>
      {paused ? <Play size={13}/> : <Pause size={13}/>}
    </button>
    <div ref={tape} className="ticker-strip" tabIndex={0} role="region" aria-label={market.tickersStale ? 'Stale market quotes — scroll horizontally' : 'Market quotes — scroll horizontally'} onPointerDown={stop} onWheel={stop} onTouchStart={stop} onKeyDown={e => {
      const node = tape.current; if (!node) return; stop();
      const max = group.current?.offsetWidth ?? 0;
      const target: Record<string, number> = { Home: 0, End: max, ArrowLeft: Math.max(0, node.scrollLeft - 180), ArrowRight: Math.min(max, node.scrollLeft + 180) };
      if (e.key in target) { e.preventDefault(); node.scrollLeft = target[e.key]; }
    }}>
      <div ref={group} className="tape-set">{renderRows(false)}{!rows.length && <div className="hs-tape-empty">{market.tickersStatus === 'loading' ? 'Loading market data…' : 'Data unavailable'}</div>}</div>
      {!!rows.length && <div className="tape-set" aria-hidden="true">{renderRows(true)}</div>}
    </div>
    <input ref={bar} className="tape-scrollbar" type="range" min="0" max="0" defaultValue="0" step="1" aria-label="Scroll market quotes horizontally" onPointerDown={stop} onChange={e => { stop(); if (tape.current) tape.current.scrollLeft = Number(e.target.value); }}/>
  </div>;
}