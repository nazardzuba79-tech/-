import { lazy,Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
const FuturesPage=lazy(()=>import('./FuturesPage').then(module=>({default:module.FuturesPage})));
const PrivateTradingPage=lazy(()=>import('./private-trading/PrivateTradingPage').then(module=>({default:module.PrivateTradingPage})));

/** A route selector is not authorization: private data is server-gated after it. */
export function FuturesRoute(){
  const[params]=useSearchParams();
  return <Suspense fallback={<div role="status">Загрузка…</div>}>
    {params.get('card')?<PrivateTradingPage/>:<FuturesPage/>}
  </Suspense>;
}
