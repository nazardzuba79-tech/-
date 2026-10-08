import { SCENE_INSTRUMENTS, type SceneInstrument } from './v0MarketScene';

// BTC/ETH glyph paths: spothq/cryptocurrency-icons, CC0-1.0.
// All other pictograms below are local neutral asset illustrations, NOT
// corporate logos or an assertion that stock trading is available.
const bitcoin = 'M23.189 14.02c.314-2.096-1.283-3.223-3.465-3.975l.708-2.84-1.728-.43-.69 2.765c-.454-.114-.92-.22-1.385-.326l.695-2.783L15.596 6l-.708 2.839c-.376-.086-.746-.17-1.104-.26l.002-.009-2.384-.595-.46 1.846s1.283.294 1.256.312c.7.175.826.638.805 1.006l-.806 3.235c.048.012.11.03.18.057l-.183-.045-1.13 4.532c-.086.212-.303.531-.793.41.018.025-1.256-.313-1.256-.313l-.858 1.978 2.25.561c.418.105.828.215 1.231.318l-.715 2.872 1.727.43.708-2.84c.472.127.93.245 1.378.357l-.706 2.828 1.728.43.715-2.866c2.948.558 5.164.333 6.097-2.333.752-2.146-.037-3.385-1.588-4.192 1.13-.26 1.98-1.003 2.207-2.538zm-3.95 5.538c-.533 2.147-4.148.986-5.32.695l.95-3.805c1.172.293 4.929.872 4.37 3.11zm.535-5.569c-.487 1.953-3.495.96-4.47.717l.86-3.45c.975.243 4.118.696 3.61 2.733z';
const ethereum = '<path d="M16.498 4L9 16.22l7.498-3.35zM16.498 27.995v-6.028L9 17.616z"/><path fill-opacity=".58" d="M16.498 4v8.87l7.497 3.35zM16.498 21.968v6.027L24 17.616zM9 16.22l7.498 4.353v-7.701z"/><path fill-opacity=".25" d="M16.498 20.573l7.497-4.353-7.497-3.348z"/>';

function symbol(instrument: SceneInstrument): string {
  switch (instrument.id) {
    case 'BTCUSDT': return `<g transform="translate(12,-6) scale(7.2)"><path d="${bitcoin}"/></g>`;
    case 'ETHUSDT': return `<g transform="translate(28,10) scale(6)">${ethereum}</g>`;
    case 'XAUUSD': case 'XAGUSD': return '<path d="M90 64h49l14 33H77zM62 109h49l14 33H48zM138 109h49l14 33h-77z"/><path d="M90 64l-13 33 14-7h47l15 7-14-33" fill="none" stroke="#fff6d1" stroke-width="3"/>';
    case 'WTI': case 'BRENT': return '<path d="M128 42c-6 26-39 56-39 83 0 49 78 49 78 0 0-27-33-57-39-83z"/><path d="M105 127c0 19 13 27 25 26" stroke="#99a5b3" stroke-width="3" fill="none"/>';
    case 'EURUSD': case 'GBPUSD': case 'USDJPY': return '<rect x="76" y="62" width="104" height="75" rx="10" fill="#f9f4df"/><path d="M76 71h104M76 89h104M76 107h104M76 125h104" stroke="#b34045" stroke-width="9"/><path d="M76 62h44v41H76z" fill="#203c73"/><path d="M82 71h31m-31 9h31m-31 9h31" stroke="#eff6ff" stroke-width="2"/>';
    case 'US500': case 'NAS100': return '<path d="M74 137V90h23v47zm41 0V71h23v66zm41 0V49h23v88z"/><path d="M70 77l35-21 29 7 49-36" stroke="#a32c36" stroke-width="5" fill="none"/>';
    case 'NVDA': case 'MSFT': return '<rect x="91" y="62" width="74" height="74" rx="10" fill="none" stroke="currentColor" stroke-width="8"/><rect x="111" y="82" width="34" height="34" rx="4"/><path d="M80 78H66m14 22H66m14 22H66m124-44h-14m14 22h-14m14 22h-14M106 51V37m22 14V37m22 14V37m-44 124v-14m22 14v-14m22 14v-14" stroke="currentColor" stroke-width="5"/>';
    default: return `<path d="M128 43l48 29v56l-48 28-48-28V72z" fill="none" stroke="currentColor" stroke-width="4"/><text x="128" y="111" text-anchor="middle" font-family="Arial,sans-serif" font-size="${instrument.ticker.length > 4 ? 29 : 34}" font-weight="700" letter-spacing="-1">${instrument.ticker}</text>`;
  }
}

// SVG artwork, not canvas text coins. The face has a multi-stop metallic
// reflection, concentric lathe lines, relief highlights and a small ticker.
// A real 3D bevel/rim in the renderer supplies thickness during every turn.
export function medallionSvg(instrument: SceneInstrument) {
  const dark = instrument.market === 'stock' || instrument.id === 'EURUSD';
  const gold = instrument.id === 'BTCUSDT' || instrument.metal === 'gold';
  const colors = dark ? ['#222e3b', '#070c13', '#34404c', '#080d15', '#1e2936']
    : gold ? ['#795226', '#ffe6a4', '#ba8743', '#674422', '#ebc475']
      : ['#78838d', '#f5f6f3', '#b0b7bd', '#edf0ee', '#7d8790'];
  const relief = dark || gold ? '#fff2cc' : '#192532';
  const shape = symbol(instrument);
  const label = instrument.id === 'XAUUSD' ? 'GOLD' : instrument.id === 'WTI' ? 'OIL' : instrument.ticker;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">${colors.map((color,i)=>`<stop offset="${i*25}%" stop-color="${color}"/>`).join('')}</linearGradient><linearGradient id="rim"><stop stop-color="#fff4cc"/><stop offset=".2" stop-color="#8f591a"/><stop offset=".48" stop-color="#fff0b5"/><stop offset=".7" stop-color="#9f631d"/><stop offset="1" stop-color="#f6cf79"/></linearGradient><radialGradient id="light" cx="32%" cy="18%" r="74%"><stop stop-color="#fff" stop-opacity=".25"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></radialGradient></defs><circle cx="128" cy="128" r="126" fill="url(#rim)"/><circle cx="128" cy="128" r="119" fill="url(#metal)" stroke="#342a1d" stroke-width="3"/><circle cx="128" cy="128" r="115" fill="none" stroke="#fff8d1" stroke-opacity=".7" stroke-width="1.5"/>${[105,108,111].map(r=>`<circle cx="128" cy="128" r="${r}" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width=".6"/>`).join('')}<circle cx="128" cy="128" r="113" fill="url(#light)"/><g color="#18130d" fill="#18130d" transform="translate(2 4)">${shape}</g><g color="${relief}" fill="${relief}">${shape}</g><text x="128" y="201" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="${label.length > 6 ? 21 : 25}" fill="${dark||gold?'#fff3d4':'#18212b'}">${label}</text></svg>`;
}

export const MEDALLION_URLS = new Map(SCENE_INSTRUMENTS.map(instrument => [instrument.id, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(medallionSvg(instrument))}`]));
