import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Nav } from '../../components/Nav';
import { useStocks, type StockCatalogue } from '../../lib/stocks';
import { readFavorites, writeFavorites } from './stockModel';
import './stocks.css';

// Each view is its own chunk: the overview never downloads the chart library,
// and only the view on screen is mounted.
const StocksTerminal = lazy(() => import('./StocksTerminal'));
const StocksOverview = lazy(() => import('./StocksOverview'));

/**
 * /stocks                      working panel (reopens the last valid instrument)
 * /stocks/:instrumentId        working panel of that canonical instrument
 * /stocks?view=overview        light overview
 * Both views read the same cached catalogue; there is one data pipeline.
 */
export function StocksPage() {
  const { instrumentId } = useParams();
  const [params] = useSearchParams();
  const overview = !instrumentId && params.get('view') === 'overview';
  const catalogue = useStocks<StockCatalogue>('/stocks');
  const [favoriteIds, setFavoriteIds] = useState<string[]>(readFavorites);
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const toggleFavorite = useCallback((id: string) => setFavoriteIds(old => {
    const next = old.includes(id) ? old.filter(x => x !== id) : [...old, id].slice(0, 250);
    writeFavorites(next);
    return next;
  }), []);

  return (
    <div className={overview ? 'vx-stocks-overview' : 'vx-stocks-terminal'}>
      <Nav active="/stocks" hideTicker readProfile={false} />
      <main className="vxs-main">
        <Suspense fallback={<div className="vxs-route-hold" aria-busy="true" />}>
          {overview
            ? <StocksOverview catalogue={catalogue} favorites={favorites} onToggleFavorite={toggleFavorite} />
            : <StocksTerminal instrumentId={instrumentId} catalogue={catalogue} favorites={favorites} onToggleFavorite={toggleFavorite} />}
        </Suspense>
      </main>
    </div>
  );
}
