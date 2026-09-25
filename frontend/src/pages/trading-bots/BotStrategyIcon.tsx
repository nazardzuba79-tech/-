import type { CSSProperties } from 'react';

const accents: Record<string, string> = {
  atlas: '#edc975', ether: '#b2a6f5', sol: '#70dbbc', delta: '#85b7ed',
  range: '#e7ac79', balance: '#92cbb5', breakout: '#e6c36d',
};

/** Decorative strategy marks; the adjacent bot name supplies the accessible label. */
export function BotStrategyIcon({ id }: { id: string }) {
  const artwork = (() => {
    switch (id) {
      case 'atlas': return <><path d="M16 3 28 10v12l-12 7L4 22V10Z" fill="currentColor" fillOpacity=".08"/><path d="m4 10 12 7 12-7M16 17v12M10 6.5l12 7v12M22 6.5l-12 7v12" opacity=".65"/><path d="m16 3 12 7v12l-12 7L4 22V10Z"/><circle cx="16" cy="17" r="2" fill="#f5f3ee" stroke="none"/></>;
      case 'ether': return <><path d="m16 3 9 13-9 5-9-5Z" fill="currentColor" fillOpacity=".14"/><path d="m16 3 0 18M7 16l9-4 9 4" opacity=".55"/><path d="m7 21 9 8 9-8"/><path d="m11 23 5 2 5-2" stroke="#f5f3ee"/></>;
      case 'sol': return <><path d="M6 8h17l3-4H9ZM6 14h17l3 4H9ZM6 28h17l3-4H9Z" fill="currentColor" fillOpacity=".2" strokeWidth="1.3"/><path d="m18 8-6 9h7l-5 8" stroke="#f5f3ee" strokeWidth="1.8"/></>;
      case 'delta': return <><path d="m16 4 13 23H3Z" fill="currentColor" fillOpacity=".08"/><path d="m16 12 7 12H9Z" stroke="#f5f3ee"/><path d="M4 17h8m8 0h8" opacity=".55"/><circle cx="16" cy="4" r="2" fill="currentColor" stroke="none"/></>;
      case 'range': return <><path d="M5 8h22M5 24h22" opacity=".55"/><path d="M4 19h4l4-7 6 9 5-8h5" strokeWidth="1.8"/><circle cx="4" cy="19" r="2" fill="#f5f3ee" stroke="none"/><circle cx="28" cy="13" r="2" fill="currentColor" stroke="none"/></>;
      case 'balance': return <><circle cx="16" cy="16" r="10" strokeDasharray="3 4" opacity=".5"/><path d="m16 6 9.5 7-3.5 11H10L6.5 13Z" opacity=".6"/><path d="m16 6 0 10 9.5-3M16 16l6 8m-6-8-6 8m6-8-9.5-3" opacity=".35"/><circle cx="16" cy="16" r="3" fill="#f5f3ee" stroke="none"/>{[[16,6],[25.5,13],[22,24],[10,24],[6.5,13]].map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r="2" fill="currentColor" stroke="none"/>)}</>;
      case 'breakout': return <><path d="M5 5v22h22" opacity=".4"/><path d="M5 12h23" strokeDasharray="2 3" opacity=".65"/><path d="m8 23 7-7 4 3 9-13m-7 0h7v7" strokeWidth="1.9"/><circle cx="8" cy="23" r="2" fill="#f5f3ee" stroke="none"/></>;
      default: return <><rect x="6" y="9" width="20" height="17" rx="5"/><path d="M16 9V4m-3 0h6M11 17h1m8 0h1M12 22h8"/></>;
    }
  })();
  return <span className="vb-avatar vb-strategy-icon" data-bot-icon={id} style={{ '--bot-accent': accents[id] || accents.atlas } as CSSProperties} aria-hidden="true">
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" focusable="false">{artwork}</svg>
  </span>;
}
