import { useEffect, useRef, type CSSProperties } from 'react';
import type { HomeMarket } from './useHomeMarket';
import { TerminalPreview } from './TerminalPreview';

// Reference-derived 1672×941 plane. Project live HTML onto measured screen
// corners. The hardware asset contains no text or market information.
const DISPLAY = [[803, 214], [1526, 231], [1497, 750], [736, 693]];
function screenTransform() {
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] = DISPLAY;
  const dx1=x1-x2, dx2=x3-x2, dx3=x0-x1+x2-x3;
  const dy1=y1-y2, dy2=y3-y2, dy3=y0-y1+y2-y3;
  const denominator=dx1*dy2-dx2*dy1;
  const g=(dx3*dy2-dx2*dy3)/denominator, h=(dx1*dy3-dx3*dy1)/denominator;
  const a=x1-x0+g*x1, b=x3-x0+h*x3, d=y1-y0+g*y1, e=y3-y0+h*y3;
  return `matrix3d(${a/1000},${d/1000},0,${g/1000},${b/680},${e/680},0,${h/680},0,0,1,0,${x0},${y0},0,1)`;
}
const transform = screenTransform();
const hubs = [
  { name:'New York', x:635, y:205, tx:-16, ty:-15, anchor:'end' },
  { name:'London', x:948, y:104, tx:-12, ty:19, anchor:'end' },
  { name:'Frankfurt', x:1153, y:95, tx:14, ty:7, anchor:'start' },
  { name:'Dubai', x:1351, y:150, tx:14, ty:5, anchor:'start' },
  { name:'Singapore', x:1516, y:224, tx:12, ty:-17, anchor:'start' },
  { name:'Tokyo', x:1560, y:345, tx:15, ty:-8, anchor:'start' },
];
const routes = [
  'M635 205 Q803 -50 948 104', 'M948 104 Q1014 0 1153 95',
  'M948 104 Q1242 -12 1351 150', 'M1351 150 Q1480 90 1516 224',
  'M1516 224 Q1630 248 1560 345', 'M635 205 Q1658 -33 1560 345',
  'M520 542 Q372 172 635 205', 'M1153 95 Q1615 -150 1630 574',
];

export function HeroReferenceScene({ market }: { market: HomeMarket }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element=ref.current;
    if (!element) return;
    const media=window.matchMedia('(max-width: 1100px)');
    const size=()=>{
      const width=element.clientWidth, height=element.clientHeight;
      const sx=width/(media.matches ? 1070 : 1672);
      element.style.setProperty('--scene-sx',String(sx));
      element.style.setProperty('--scene-sy',String(media.matches ? sx : height/941));
    };
    size();
    const observer=new ResizeObserver(size); observer.observe(element);
    media.addEventListener('change',size);
    return ()=>{ observer.disconnect(); media.removeEventListener('change',size); };
  },[]);
  return <>
    <picture className="vx-reference-backdrop" aria-hidden="true">
      <source media="(max-width: 1100px)" srcSet="/hero/earth-market-reference-mobile.webp"/>
      <img src="/hero/earth-market-reference.webp" width="1672" height="941" alt="" decoding="async" fetchPriority="high"/>
    </picture>
    <div className="vx-reference-shade" aria-hidden="true"/>
    <svg className="vx-reference-routes" viewBox="0 0 1672 941" preserveAspectRatio="none" aria-hidden="true">
      <defs><filter id="vx-ref-light"><feGaussianBlur stdDeviation="3"/></filter></defs>
      {routes.map((path,index)=><g key={path} style={{'--route-delay':`${-index*3}s`} as CSSProperties}>
        <path d={path} className="vx-reference-route"/>
        <path d={path} pathLength="1000" className="vx-reference-route-pulse"/>
      </g>)}
      {hubs.map((hub,index)=><g key={hub.name} className="vx-reference-hub" style={{'--hub-delay':`${-index*1.3}s`} as CSSProperties}>
        <circle cx={hub.x} cy={hub.y} r="14" fill="#ffb953" filter="url(#vx-ref-light)" className="vx-reference-halo"/>
        <circle cx={hub.x} cy={hub.y} r="3.5" fill="#fff0ce"/>
        <text x={hub.x+hub.tx} y={hub.y+hub.ty} textAnchor={hub.anchor as 'start'|'end'}>{hub.name.toUpperCase()}</text>
      </g>)}
    </svg>
    <div className="vx-reference-light-field" aria-hidden="true"><i/><i/><i/></div>
    <div ref={ref} className="vx-reference-product">
      <div className="vx-reference-laptop-canvas">
        <img className="vx-reference-hardware" src="/hero/laptop-reference.webp" width="1672" height="941" alt="" aria-hidden="true" decoding="async"/>
        <div className="vx-reference-display" style={{ transform }}><TerminalPreview market={market}/></div>
      </div>
    </div>
  </>;
}
