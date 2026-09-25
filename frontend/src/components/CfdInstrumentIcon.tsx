import './CfdInstrumentIcon.css';

type IconKind='metal'|'wti'|'brent'|'fx';

const METALS=new Set(['XAUUSD','XAGUSD','XPTUSD','XPDUSD']);
const FX=new Set(['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD']);

function kindOf(symbol:string):IconKind{
  if(METALS.has(symbol))return'metal';
  if(symbol==='WTIUSD')return'wti';
  if(symbol==='XBRUSD')return'brent';
  return FX.has(symbol)?'fx':'fx';
}

/**
 * Premium CFD instrument mark rendered entirely as inline SVG.
 *
 * No <img>, remote asset, provider icon, CDN or API request is involved.
 * The surrounding terminal already contains the symbol/name for accessible
 * identification, so this mark is decorative.
 */
export function CfdInstrumentIcon({symbol,compact=false}:{symbol:string;compact?:boolean}){
  const kind=kindOf(symbol);
  return <span className={`cfd-instrumentIcon cfd-instrumentIcon-${symbol} cfd-instrumentIcon-${kind}${compact?' cfd-instrumentIcon--compact':''}`} aria-hidden="true">
    <svg viewBox="0 0 32 32" focusable="false">
      {kind==='metal'&&<>
        <path className="cfd-icon-primary" d="M8.25 21.25 11.1 11.5h9.8l2.85 9.75H8.25Z"/>
        <path className="cfd-icon-secondary" d="M11.1 11.5 16 8.8l4.9 2.7M12 17.2h8"/>
        <path className="cfd-icon-shine" d="M23.8 8.1v3.2M22.2 9.7h3.2"/>
      </>}
      {kind==='wti'&&<>
        <ellipse className="cfd-icon-primary" cx="16" cy="9.3" rx="6.8" ry="2.7"/>
        <path className="cfd-icon-primary" d="M9.2 9.3v13.2c0 1.5 3 2.7 6.8 2.7s6.8-1.2 6.8-2.7V9.3"/>
        <path className="cfd-icon-secondary" d="M9.2 15.7c0 1.5 3 2.7 6.8 2.7s6.8-1.2 6.8-2.7M9.2 21c0 1.5 3 2.7 6.8 2.7s6.8-1.2 6.8-2.7"/>
      </>}
      {kind==='brent'&&<>
        <path className="cfd-icon-primary cfd-icon-fill-soft" d="M16 6.8c-1.8 3.2-6.3 8.2-6.3 12.6A6.3 6.3 0 0 0 16 25.7a6.3 6.3 0 0 0 6.3-6.3C22.3 15 17.8 10 16 6.8Z"/>
        <path className="cfd-icon-secondary" d="M12.7 20.1c.5 1.6 1.7 2.5 3.5 2.7"/>
        <path className="cfd-icon-shine" d="M22.8 7.2v3M21.3 8.7h3"/>
      </>}
      {kind==='fx'&&<>
        <circle className="cfd-icon-secondary cfd-icon-fill-soft" cx="11.2" cy="12.2" r="5.1"/>
        <circle className="cfd-icon-primary cfd-icon-fill-soft" cx="20.8" cy="19.8" r="5.1"/>
        <path className="cfd-icon-primary" d="M8.3 22.8h6.5l-2-2M23.7 9.2h-6.5l2 2"/>
        <path className="cfd-icon-secondary" d="M14.8 22.8a8.3 8.3 0 0 0 8.3-8.3M17.2 9.2a8.3 8.3 0 0 0-8.3 8.3"/>
      </>}
    </svg>
  </span>;
}
