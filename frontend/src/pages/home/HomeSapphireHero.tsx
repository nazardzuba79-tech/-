import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChartCandlestick, TrendingUp, Copy, CreditCard } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { HomeV0Coins } from './HomeV0Coins';
import { HomeMarket } from './useHomeMarket';
import { HomeSapphireTape } from './HomeSapphireTape';
import { SapphireTerminal } from './SapphireTerminal';
import { referenceMarketLegend } from './globalHeroCopy';

// Measured on the owner's 1619x971 reference. Only its decorative 60..876
// vertical interval is shown; the real header/tape are not baked into the image.
export const SAPPHIRE_SCREEN = [[948,349],[1573,306],[1545,753],[899,724]];
export function sapphireProjection(width: number, height: number, mobile: boolean) {
  const scale=width/1619, ox=0, oy=0;
  const points=SAPPHIRE_SCREEN.map(([x,y])=>[ox+x*scale,oy+y*scale]);
  const from=[[0,0],[1000,0],[1000,600],[0,600]], a:number[][]=[];
  for(let i=0;i<4;i++){const[x,y]=from[i],[u,v]=points[i];a.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);}
  for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(a[r][c])>Math.abs(a[p][c]))p=r;
    [a[p],a[c]]=[a[c],a[p]];const d=a[c][c];for(let j=c;j<9;j++)a[c][j]/=d;
    for(let r=0;r<8;r++)if(r!==c){const f=a[r][c];for(let j=c;j<9;j++)a[r][j]-=f*a[c][j];}}
  const h=a.map(r=>r[8]);return `matrix3d(${h[0]},${h[3]},0,${h[6]},${h[1]},${h[4]},0,${h[7]},0,0,1,0,${h[2]},${h[5]},0,1)`;
}
export function HomeSapphireHero({market}:{market:HomeMarket}){
  const {t,lang}=useLanguage(),art=useRef<HTMLImageElement>(null),display=useRef<HTMLDivElement>(null),hero=useRef<HTMLDivElement>(null);
  const [aligned,setAligned]=useState(false);
  useEffect(()=>{const image=art.current,screen=display.current,section=hero.current;if(!image||!screen||!section)return;
    const align=()=>{const b=image.getBoundingClientRect(),p=section.getBoundingClientRect();if(!b.width||!b.height)return;screen.style.transform=sapphireProjection(b.width,b.height,window.innerWidth<=900);screen.style.left=`${b.left-p.left}px`;screen.style.top=`${b.top-p.top}px`;setAligned(true);};
    const observer=new ResizeObserver(align);observer.observe(section);observer.observe(image);image.addEventListener('load',align);align();return()=>{observer.disconnect();image.removeEventListener('load',align);};},[]);
  return <section id="home-global-hero" className="hs-root v0-approved-hero" data-design="sapphire-gold" aria-labelledby="hs-title">
    <div className="hero" ref={hero}><img ref={art} className="art" src="/hero/v0-reference-clean.png" width="1619" height="971" alt="" aria-hidden="true" fetchPriority="high"/>
      <div className="terminal-screen" ref={display} style={{visibility:aligned?'visible':'hidden'}}><SapphireTerminal market={market}/></div>
      <HomeV0Coins market={market}/>
      <div className="shade" aria-hidden="true"/><div className="copy">
        <p className="eyebrow">GLOBAL MARKETS. REAL OPPORTUNITIES.</p>
        <h1 id="hs-title">OWN YOUR{' '}<span>FUTURE<i>.</i></span></h1>
        <p className="subtitle">{t('home.hero.subtitle')}</p>
        <p className="description">{t('home.hero.description')}</p>
        <div className="actions">
          <Link className="primary" to="/trade">{t('home.cta.openTerminal')}<ArrowRight size={19}/></Link>
          <Link className="secondary" to="/markets">{t('home.cta.viewMarkets')}</Link>
        </div>
        <nav className="product-links product-shortcuts" aria-label="VOLTEX products">
          <Link to="/trade"><ChartCandlestick aria-hidden="true" size={18}/><span>Spot</span></Link>
          <Link to="/futures"><TrendingUp aria-hidden="true" size={18}/><span>Futures</span></Link>
          <Link to="/copy-trading"><Copy aria-hidden="true" size={18}/><span>Copy Trading</span></Link>
          <Link to="/card"><CreditCard aria-hidden="true" size={18}/><span>Crypto Card</span></Link>
        </nav>
        <p className="reference-market-legend">{referenceMarketLegend[lang]}</p>
      </div>
    </div><HomeSapphireTape market={market}/>
  </section>;
}
