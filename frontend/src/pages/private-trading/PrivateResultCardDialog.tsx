import './privateResultCard.css';
import { useEffect,useRef,useState } from 'react';
import { Download,ExternalLink,X } from 'lucide-react';
import { privateTradingApi,privateErrorText,privateCardPnl,type PrivateResultCard } from '../../lib/privateTradingApi';
import { privateResultCardPng,privateResultCardDataUrl,privateResultCardPreviewUrl } from '../../lib/privateResultCard';

export function PrivateResultCardDialog({snapshot,onClose,onError,loadSnapshot=privateTradingApi.getCard,openHref}:{snapshot:PrivateResultCard;onClose:()=>void;onError:(error:unknown)=>void;loadSnapshot?:(id:string)=>Promise<PrivateResultCard>;openHref?:string}){
  const[url,setUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  /* The PREVIEW is the card's own SVG, shown directly.
   *
   * It used to be the full export pipeline — SVG, decode, canvas 1080x1215,
   * canvas.toBlob PNG, then FileReader to a base64 data URL — before anything
   * appeared at all. Measured on this card at 1440x900: that pipeline costs
   * ~95ms at p50 and ~287ms at p95 and produces a 1.5MB PNG behind a 2.07MB
   * base64 string, while the same SVG shown as-is is ready in ~5ms. The PNG
   * was being built to satisfy a look at the card, not to save one.
   *
   * The composition is identical because it is the SAME SVG the export
   * rasterises; only the moment of rasterising moves. The download still
   * produces the contracted 1080x1215 PNG, built when the trader asks for it.
   */
  useEffect(()=>{let cancelled=false;setUrl(null);
    let revoke:(()=>void)|null=null;
    try{
      const preview=privateResultCardPreviewUrl(snapshot);
      revoke=preview.revoke;
      if(cancelled)preview.revoke();else setUrl(preview.url);
    }catch(e){console.warn('[private-trading] card preview failed',e);if(!cancelled)setError('Не удалось подготовить карточку. Повторите попытку.');}
    return()=>{cancelled=true;revoke?.();};
  },[snapshot]);
  async function exportCard(){
    if(busy)return;setBusy(true);setError('');
    try{
      // Recheck owner/role/session/flag even for a previously rendered snapshot.
      const authorized=await loadSnapshot(snapshot.id);
      const blob=await privateResultCardPng(authorized);
      const pngUrl=await privateResultCardDataUrl(blob);if(!alive.current)return;
      // Rendering can outlive role/session revocation. Authorize delivery too.
      await loadSnapshot(snapshot.id);if(!alive.current)return;
      const anchor=document.createElement('a');anchor.href=pngUrl;
      // The file leaves the app and lands in someone's downloads folder, so
      // its name is an ordinary P&L card name — no simulation/demo/test word.
      anchor.download=`VOLTEX-${authorized.symbol.replace(/[^A-Za-z0-9]/g,'')}-${authorized.mode==='HISTORICAL_REPLAY'?'historical':'pnl'}.png`;
      anchor.hidden=true;document.body.append(anchor);
      try{anchor.click();}finally{anchor.remove();}
    }catch(e){if(alive.current){setError(privateErrorText(e));onError(e);}}finally{if(alive.current)setBusy(false);}
  }
  return <dialog ref={dialog} className="private-card-dialog" aria-label="Карточка результата VOLTEX" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <header><strong>Карточка результата</strong><button type="button" aria-label="Закрыть" onClick={onClose}><X size={20}/></button></header>
    {url?<img src={url} alt={`${snapshot.symbol} · P&L ${privateCardPnl(snapshot)??'—'} USDT`}/>:<p role="status">Подготовка карточки…</p>}
    {error&&<p role="alert">{error}</p>}
    <footer><a href={openHref??`/futures?card=${encodeURIComponent(snapshot.id)}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>Открыть</a><button type="button" className="primary" onClick={()=>void exportCard()} disabled={!url||busy}><Download size={16}/>Сохранить PNG</button></footer>
  </dialog>;
}
