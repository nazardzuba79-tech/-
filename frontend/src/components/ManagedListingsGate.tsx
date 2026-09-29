import { useEffect, useState, type ReactNode } from 'react';
import { ensureManagedDirectory, MANAGED_LISTINGS_BASE } from '../lib/managedListings';

/** Resolve immutable identities before any deep-linked terminal can contact a venue. */
export function ManagedListingsGate({children}:{children:ReactNode}) {
  const [state,setState] = useState(MANAGED_LISTINGS_BASE ? 'loading':'ready');
  const [attempt,setAttempt] = useState(0);
  useEffect(() => { let alive=true; ensureManagedDirectory().then(() => alive && setState('ready')).catch(() => alive && setState('error')); return () => {alive=false;}; },[attempt]);
  if (state === 'ready') return <>{children}</>;
  return <div role="status" style={{padding:32}}>{state === 'loading' ? 'Загрузка рынков…' : <>Не удалось загрузить рынки. <button onClick={() => {setState('loading');setAttempt(a=>a+1);}}>Повторить</button></>}</div>;
}
