import './privateResultCard.css';
import { useEffect,useRef,useState } from 'react';
import { Download,ExternalLink,X } from 'lucide-react';
import { privateTradingApi,privateErrorText,privateCardPnl,type PrivateResultCard } from '../../lib/privateTradingApi';
import { privateResultCardPng,privateResultCardDataUrl } from '../../lib/privateResultCard';

export function PrivateResultCardDialog({snapshot,onClose,onError}:{snapshot:PrivateResultCard;onClose:()=>void;onError:(error:unknown)=>void}){
  const[url,setUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  useEffect(()=>{let cancelled=false;setUrl(null);
    privateResultCardPng(snapshot).then(privateResultCardDataUrl).then(pngUrl=>{if(!cancelled)setUrl(pngUrl);}).catch(e=>{if(!cancelled)setError(e.message);});
    return()=>{cancelled=true;};
  },[snapshot]);
  async function exportCard(){
    if(busy)return;setBusy(true);setError('');
    try{
      // Recheck owner/role/session/flag even for a previously rendered snapshot.
      const authorized=await privateTradingApi.getCard(snapshot.id);
      const blob=await privateResultCardPng(authorized);
      const pngUrl=await privateResultCardDataUrl(blob);if(!alive.current)return;
      // Rendering can outlive role/session revocation. Authorize delivery too.
      await privateTradingApi.getCard(snapshot.id);if(!alive.current)return;
      const anchor=document.createElement('a');anchor.href=pngUrl;
      anchor.download=`VOLTEX-${authorized.symbol.replace(/[^A-Za-z0-9]/g,'')}-${authorized.mode==='HISTORICAL_REPLAY'?'historical':'simulation'}.png`;
      anchor.hidden=true;document.body.append(anchor);
      try{anchor.click();}finally{anchor.remove();}
    }catch(e){if(alive.current){setError(privateErrorText(e));onError(e);}}finally{if(alive.current)setBusy(false);}
  }
  return <dialog ref={dialog} className="private-card-dialog" aria-label="Карточка результата VOLTEX" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <header><strong>Карточка результата</strong><button type="button" aria-label="Закрыть" onClick={onClose}><X size={20}/></button></header>
    {url?<img src={url} alt={`Симуляция: ${snapshot.symbol}, Прибыль ${privateCardPnl(snapshot)??'—'} USDT`}/>:<p role="status">Подготовка карточки…</p>}
    {error&&<p role="alert">{error}</p>}
    <footer><a href={`/futures?privateTrading=1&card=${encodeURIComponent(snapshot.id)}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>Открыть</a><button type="button" className="primary" onClick={()=>void exportCard()} disabled={!url||busy}><Download size={16}/>Сохранить PNG</button></footer>
  </dialog>;
}
