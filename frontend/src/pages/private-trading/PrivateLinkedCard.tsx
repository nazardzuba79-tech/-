import { useEffect,useState } from 'react';
import { Link,useNavigate } from 'react-router-dom';
import { privateTradingApi,PrivateTradingError,privateErrorText,type PrivateResultCard } from '../../lib/privateTradingApi';
import { PrivateResultCardDialog } from './PrivateResultCardDialog';

/** Mounted only after the route's server access gate; the snapshot read reauthorizes its owner. */
export function PrivateLinkedCard({id,onDenied}:{id:string;onDenied:()=>void}){
  const navigate=useNavigate();
  const[snapshot,setSnapshot]=useState<PrivateResultCard|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let active=true;setSnapshot(null);setError('');
    privateTradingApi.getCard(id).then(card=>{if(active)setSnapshot(card);}).catch(cause=>{
      if(!active)return;
      if(cause instanceof PrivateTradingError&&[401,403].includes(cause.status))onDenied();
      else setError(privateErrorText(cause));
    });
    return()=>{active=false;};
  },[id,attempt]);
  return <main className="private-access-state"><h1>Карточка результата VOLTEX</h1>
    {!snapshot&&!error&&<p role="status">Загрузка карточки…</p>}
    {error&&<><p role="alert">{error}</p><button type="button" onClick={()=>setAttempt(value=>value+1)}>Повторить</button></>}
    <Link to="/futures?privateTrading=1">Вернуться в приватный терминал</Link>
    {snapshot&&<PrivateResultCardDialog snapshot={snapshot} onClose={()=>navigate('/futures?privateTrading=1',{replace:true})} onError={cause=>{
      if(cause instanceof PrivateTradingError&&[401,403].includes(cause.status)){setSnapshot(null);onDenied();}
      else setError(privateErrorText(cause));
    }}/>}
  </main>;
}
