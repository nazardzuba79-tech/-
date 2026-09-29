import { isBrowserInactive, browserSetInterval, browserClearInterval, addBrowserActivityListener, removeBrowserActivityListener } from '../lib/browserActivity';

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
    const check=()=>{if(isBrowserInactive())return;void privateTradingApi.access(controller.signal).then(result=>{if(active)setAllowed(result.allowed===true);}).catch(()=>{if(active)setAllowed(false);});};
    check();const timer=browserSetInterval(check,ACCESS_POLL_MS);
    const visible=()=>{if(!isBrowserInactive())check();};addBrowserActivityListener(visible);
    const stop=onSessionChange(()=>{active=false;controller.abort();setAllowed(false);browserClearInterval(timer);removeBrowserActivityListener(visible);});
    return()=>{active=false;controller.abort();browserClearInterval(timer);removeBrowserActivityListener(visible);stop();};
  },[]);
  return allowed?<Link to="/futures?demo=1" title="Приватный режим" aria-label="Открыть приватный режим" style={{display:'inline-flex',alignItems:'center',gap:6,color:'#e9c578',fontSize:12,textDecoration:'none'}}><LockKeyhole size={15}/><span>Приватный</span></Link>:null;
}
