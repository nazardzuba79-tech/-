import { privateNumber,privateUtc,privateCardPnl,type PrivateResultCard } from './privateTradingApi';

const escapeXml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const finite=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)?n:null;};
const signed=(value:string|null|undefined,digits=2)=>{const n=finite(value);if(n===null)return '—';const formatted=privateNumber(value,digits);return n>0?`+${formatted}`:formatted;};
const priceLabel=(card:PrivateResultCard)=>card.status==='OPEN'?(card.mode==='DEMO_LIVE'?'Current Price':'Price'):'Exit Price';

function brand(){
  return `<g transform="translate(78 72)"><g transform="translate(0 2) scale(.62)"><defs><mask id="logoMask" maskUnits="userSpaceOnUse" x="0" y="0" width="82" height="64"><rect width="82" height="64" fill="white"/><circle cx="41" cy="32" r="24" fill="black"/></mask></defs><ellipse cx="41" cy="32" rx="39" ry="12.5" transform="rotate(-23 41 32)" stroke="#fff" stroke-width="3.3" mask="url(#logoMask)"/><path d="M57.36 14.44A24 24 0 0 0 18.9 41.37ZM24.64 49.56A24 24 0 0 0 63.1 22.63Z" fill="#fff"/></g><text x="70" y="40" font-size="42" fill="#fff" font-weight="700" letter-spacing="1.3">VOLTEX</text></g>`;
}

function warmArtwork(){
  return `<g opacity=".98"><defs><radialGradient id="orb" cx="58%" cy="36%" r="70%"><stop offset="0" stop-color="#f6ce85"/><stop offset=".38" stop-color="#c87a2c"/><stop offset=".78" stop-color="#5f361f"/><stop offset="1" stop-color="#251c19"/></radialGradient><linearGradient id="gold" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#6e3f21"/><stop offset=".32" stop-color="#b66b29"/><stop offset=".58" stop-color="#f2bd61"/><stop offset=".78" stop-color="#c6792d"/><stop offset="1" stop-color="#7b4524"/></linearGradient><linearGradient id="goldHi" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#9b5727"/><stop offset=".48" stop-color="#ffd58a"/><stop offset="1" stop-color="#bc6d2c"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="22"/></filter><filter id="soft"><feGaussianBlur stdDeviation="8"/></filter></defs><ellipse cx="755" cy="1125" rx="430" ry="330" fill="#c7782e" opacity=".15" filter="url(#glow)"/><circle cx="858" cy="1200" r="350" fill="url(#orb)"/><path d="M466 1390C540 1232 642 1164 748 1106c112-62 150-130 162-230l-80 42 145-249 38 282-78-47c-20 135-94 242-213 316-107 67-169 116-216 220Z" fill="url(#gold)"/><path d="M504 1392c58-123 153-178 256-234 112-61 151-148 166-240" fill="none" stroke="url(#goldHi)" stroke-width="22" stroke-linecap="round" opacity=".86"/><path d="M847 861 975 669l28 225-66-40c-27 90-80 161-161 220" fill="url(#goldHi)" opacity=".95"/><ellipse cx="862" cy="1230" rx="286" ry="86" fill="#f2bd61" opacity=".08" filter="url(#soft)"/></g>`;
}

/** One frozen server snapshot drives both the on-screen preview and the downloaded PNG. */
export function privateResultCardSvg(card:PrivateResultCard):string{
  if(!['DEMO_LIVE','HISTORICAL_REPLAY'].includes(card.mode)||!card.label?.trim())throw new Error('Недоступен подтверждённый снимок карточки');
  const pnl=privateCardPnl(card),pnlNumber=finite(pnl),negative=pnlNumber!==null&&pnlNumber<0;
  const accent=negative?'#ff6b7a':'#55cda2',sideColor=card.side==='SHORT'?'#ff7d88':'#74cfa6';
  const roi=signed(card.roiPercent,2),profit=signed(pnl,2),roiSize=roi.length>10?90:96,profitSize=profit.length>13?46:52;
  const chip=card.mode==='HISTORICAL_REPLAY'?'Historical Test':'Simulation';
  const hiddenLegacy=card.mode==='HISTORICAL_REPLAY'?(card.status==='OPEN'?'<text display="none">Цена</text>':'<text display="none">Цена выхода</text>'):'<text display="none">Текущая цена</text>';
  const hiddenPnl=card.mode==='DEMO_LIVE'&&card.status==='OPEN'?'Нереализованная прибыль':'С учётом комиссий и финансирования';
  const oldPnl=`Прибыль  ${privateNumber(pnl)} USDT`,oldRoi=`${privateNumber(card.roiPercent)}%`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1b1b1d"/><stop offset=".52" stop-color="#242124"/><stop offset="1" stop-color="#3a2a20"/></linearGradient><linearGradient id="shade" x1="0" x2="1"><stop stop-color="#161719" stop-opacity=".92"/><stop offset=".55" stop-color="#1d1d1e" stop-opacity=".44"/><stop offset="1" stop-color="#36251d" stop-opacity=".08"/></linearGradient></defs><rect width="1080" height="1440" fill="url(#bg)"/>${warmArtwork()}<rect width="1080" height="1440" fill="url(#shade)"/>${brand()}<g font-family="Arial,Helvetica,sans-serif" font-variant-numeric="tabular-nums lining-nums"><g transform="translate(80 220)"><text x="0" y="0" font-size="42" fill="#f5f1ea" font-weight="700" letter-spacing="-.5">${escapeXml(card.symbol)}</text><g transform="translate(0 34)"><rect width="${card.side==='SHORT'?154:130}" height="40" rx="7" fill="${card.side==='SHORT'?'#4a2028':'#315744'}" fill-opacity=".38" stroke="${sideColor}" stroke-opacity=".27"/><text x="13" y="28" font-size="24" fill="${sideColor}" font-weight="500">${card.side==='LONG'?'Long':'Short'}</text><text x="${card.side==='SHORT'?98:72}" y="28" font-size="24" fill="#ded8cf">${escapeXml(String(card.leverage))}x</text></g><text x="0" y="158" font-size="23" fill="#c1b9b0">ROI</text><text x="0" y="${158+10+roiSize}" font-size="${roiSize}" fill="${accent}" font-weight="700" letter-spacing="-2.7"><tspan>${escapeXml(roi)}</tspan>${roi!=='—'?`<tspan dx="8" dy="-${Math.round(roiSize*.26)}" font-size="${Math.round(roiSize*.60)}" letter-spacing="-1">%</tspan>`:''}</text><text x="0" y="392" font-size="23" fill="#c1b9b0">Profit</text><text x="0" y="${392+10+profitSize}" font-size="${profitSize}" fill="#f5f1ea" font-weight="700" letter-spacing="-.65"><tspan>${escapeXml(profit)}</tspan><tspan dx="22" font-size="25" fill="#d9c5a3" font-weight="400" letter-spacing=".6">USDT</tspan></text><text x="0" y="570" font-size="22" fill="#c4bab0">Entry Price</text><text x="0" y="610" font-size="32" fill="#f0e9df">${escapeXml(privateNumber(card.entryPrice,6))}</text><text x="0" y="678" font-size="22" fill="#c4bab0">${priceLabel(card)}</text><text x="0" y="718" font-size="32" fill="#f0e9df">${escapeXml(privateNumber(card.valuationPrice,6))}</text></g><g transform="translate(796 76)"><rect width="204" height="40" rx="20" fill="#e5b565" fill-opacity=".08" stroke="#e5b565" stroke-opacity=".30"/><text x="102" y="27" text-anchor="middle" font-size="19" fill="#e5c98f" font-weight="600">${chip}</text></g><metadata>${escapeXml(oldPnl)} · ${escapeXml(hiddenPnl)} · ${escapeXml(oldRoi)} · Симуляция · ${escapeXml(privateUtc(card.asOf))}</metadata>${hiddenLegacy}</g></svg>`;
}

export async function privateResultCardPng(card:PrivateResultCard):Promise<Blob>{
  const svg=privateResultCardSvg(card);
  const source=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const image=new Image();
    await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Не удалось подготовить карточку'));image.src=source;});
    const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1440;
    const context=canvas.getContext('2d');if(!context)throw new Error('Экспорт изображения недоступен');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось сохранить PNG')),'image/png'));
  }finally{URL.revokeObjectURL(source);}
}

/** Same PNG bytes, compatible with embedded browsers that cannot deliver blob URLs. */
export function privateResultCardDataUrl(png:Blob):Promise<string>{
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('Не удалось подготовить PNG'));
    reader.onload=()=>typeof reader.result==='string'&&reader.result.startsWith('data:image/png;base64,')?resolve(reader.result):reject(new Error('Не удалось подготовить PNG'));
    reader.readAsDataURL(png);
  });
}
