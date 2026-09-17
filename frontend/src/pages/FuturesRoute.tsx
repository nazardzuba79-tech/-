import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FuturesPage } from './FuturesPage';

const PrivateTradingPage = lazy(() => import('./private-trading/PrivateTradingPage')
  .then(module => ({ default: module.PrivateTradingPage })));

/**
 * A route selector is not authorization: private data is server-gated after it.
 *
 * The ordinary Futures terminal is imported statically inside the already-lazy
 * FuturesRoute chunk. That removes the old App -> FuturesRoute -> FuturesPage
 * sequential lazy waterfall. The private `?card=` surface remains lazy because
 * it is exceptional and should not inflate the normal terminal path.
 */
export function FuturesRoute() {
  const [params] = useSearchParams();
  if (!params.get('card')) return <FuturesPage />;
  return <Suspense fallback={<div role="status">Загрузка…</div>}>
    <PrivateTradingPage />
  </Suspense>;
}
