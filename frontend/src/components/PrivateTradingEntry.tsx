import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { onSessionChange } from '../lib/api';
import { privateTradingApi } from '../lib/privateTradingApi';

const ACCESS_POLL_MS=60_000;

/** Hidden for ordinary accounts, other admins and disabled server flags. */
export function PrivateTradingEntry(){
  const[allowed,setAllowed]=useState(false);
  useEffect(()=>{let active=true;const controller=new AbortController();
    const check=()=>{if(document.hidden)return;void privateTradingApi.access(controller.signal).then(result=>{if(active)setAllowed(result.allowed===true);}).catch(()=>{if(active)setAllowed(false);});};
    check();const timer=window.setInterval(check,ACCESS_POLL_MS);
    const visible=()=>{if(!document.hidden)check();};document.addEventListener('visibilitychange',visible);
    const stop=onSessionChange(()=>{active=false;controller.abort();setAllowed(false);clearInterval(timer);document.removeEventListener('visibilitychange',visible);});
    return()=>{active=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);stop();};
  },[]);
  return allowed?<Link to="/futures?demo=1" title="Приватный режим" aria-label="Открыть приватный режим" style={{display:'inline-flex',alignItems:'center',gap:6,color:'#e9c578',fontSize:12,textDecoration:'none'}}><LockKeyhole size={15}/><span>Приватный</span></Link>:null;
}
