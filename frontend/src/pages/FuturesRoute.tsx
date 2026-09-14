import { lazy,Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
const FuturesPage=lazy(()=>import('./FuturesPage').then(module=>({default:module.FuturesPage})));
const PrivateTradingPage=lazy(()=>import('./private-trading/PrivateTradingPage').then(module=>({default:module.PrivateTradingPage})));
const BybitTestnetPage=lazy(()=>import('./private-trading/BybitTestnetPage').then(module=>({default:module.BybitTestnetPage})));

/** A route selector is not authorization: every private surface is server-gated after it. */
export function FuturesRoute(){
  const[params]=useSearchParams();
  const privateMode=params.get('privateTrading');
  return <Suspense fallback={<div role="status">Загрузка…</div>}>
    {privateMode==='1'?<BybitTestnetPage/>:privateMode==='history'?<PrivateTradingPage/>:<FuturesPage/>}
  </Suspense>;
}
