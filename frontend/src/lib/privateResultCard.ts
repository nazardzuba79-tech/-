import { privateNumber,privateUtc,privateCardPnl,type PrivateResultCard } from './privateTradingApi';

const escapeXml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
/** One frozen server snapshot drives both the on-screen PNG and downloaded PNG. */
export function privateResultCardSvg(card:PrivateResultCard):string{
  if(!['DEMO_LIVE','HISTORICAL_REPLAY'].includes(card.mode)||!card.label?.trim())throw new Error('Недоступен подтверждённый снимок карточки');
  const open=card.status==='OPEN',pnl=privateCardPnl(card);
  const pnlLabel=card.pnlKind==='NET_SCENARIO'||card.mode==='HISTORICAL_REPLAY'?'Результат сценария · net':card.pnlKind==='UNREALIZED'||open?'Нереализованный P&L':'P&L · net';
  const color=pnl!==null&&Number(pnl)<0?'#fb6479':'#21cca3';
  const text=(x:number,y:number,label:string,size=22,fill='#dce5ef',weight=400)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${escapeXml(label)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#182633"/><stop offset="1" stop-color="#080e16"/></linearGradient></defs><rect width="1200" height="760" rx="28" fill="url(#bg)"/><rect x="1" y="1" width="1198" height="758" rx="27" fill="none" stroke="#314354"/><g font-family="Arial, sans-serif"><g transform="translate(58 47) scale(1.5)"><ellipse cx="20" cy="20" rx="17" ry="6" stroke="#f1f5fa" stroke-width="1.4" fill="none" transform="rotate(-15 20 20)"/><circle cx="20" cy="20" r="10" fill="#f1f5fa"/><path d="M4 31 36 9" stroke="#182633" stroke-width="3.4" stroke-linecap="round"/></g>${text(132,90,'VOLTEX',36,'#f1f5fa',700)}<rect x="825" y="54" width="315" height="48" rx="24" fill="#e5b85018" stroke="#a18c50"/>${text(848,86,card.label,24,'#f0cd76',600)}${text(60,171,`${card.symbol}  ·  ${card.side==='LONG'?'Long':'Short'}  ·  ${card.leverage}×`,30,'#e6eef6',600)}${text(60,225,'ROI на выделенную маржу',21,'#8eabba')}${text(56,326,`${privateNumber(card.roiPercent)}%`,92,color,700)}${text(60,386,`${pnlLabel}  ${privateNumber(pnl)} USDT`,33,color,600)}${text(60,430,`USD  ${privateNumber(card.usdPnl)}`,23,'#9db1c3')}<path d="M60 468H1140" stroke="#304252"/>${text(60,516,'Цена входа',21,'#8eabba')}${text(60,559,privateNumber(card.entryPrice,6),30,'#eef3f9',600)}${text(620,516,open?'Цена оценки':'Цена выхода',21,'#8eabba')}${text(620,559,privateNumber(card.valuationPrice,6),30,'#eef3f9',600)}${text(60,650,privateUtc(card.asOf),22,'#c5d3e2')}${text(60,703,card.label,24,'#f0cd76',600)}${text(620,703,'Снимок результата · USDT perpetual',20,'#8eabba')}</g></svg>`;
}

export async function privateResultCardPng(card:PrivateResultCard):Promise<Blob>{
  const svg=privateResultCardSvg(card);
  const source=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const image=new Image();
    await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Не удалось подготовить карточку'));image.src=source;});
    const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1520;
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
    reader.onload=()=>typeof reader.result==='string'&&reader.result.startsWith('data:image/png;base64,')
      ?resolve(reader.result):reject(new Error('Не удалось подготовить PNG'));
    reader.readAsDataURL(png);
  });
}
