import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { onSessionChange } from '../lib/api';
import { privateTradingApi } from '../lib/privateTradingApi';

/** Hidden for ordinary accounts, other admins and disabled server flags. */
export function PrivateTradingEntry(){
  const[allowed,setAllowed]=useState(false);
  useEffect(()=>{let active=true;const controller=new AbortController();
    const check=()=>privateTradingApi.access(controller.signal).then(result=>{if(active)setAllowed(result.allowed===true);}).catch(()=>{if(active)setAllowed(false);});
    void check();const timer=window.setInterval(()=>void check(),15_000);
    const stop=onSessionChange(()=>{active=false;controller.abort();setAllowed(false);clearInterval(timer);});
    return()=>{active=false;controller.abort();clearInterval(timer);stop();};
  },[]);
  return allowed?<Link to="/futures?privateTrading=1" title="Приватный режим" aria-label="Открыть приватный режим" style={{display:'inline-flex',alignItems:'center',gap:6,color:'#e9c578',fontSize:12,textDecoration:'none'}}><LockKeyhole size={15}/><span>Приватный</span></Link>:null;
}
