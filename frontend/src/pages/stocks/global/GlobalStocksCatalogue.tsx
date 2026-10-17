import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Search, Star, TrendingUp } from 'lucide-react';
import { clearToken, getToken, onSessionChange } from '../../../lib/api';
import { useLanguage, type Key } from '../../../lib/i18n';
import { globalStockErrorText } from '../stockRequestError';
import { StockSessionFence } from './accountSession';
import { VisibleStockReads, startVisibleStockPolling } from './readWork';
import { StockOverloadCircuit, stockOverloadCode, stockOverloadText, type StockOverloadState, type StockReadResult } from './overload';
import { quoteAge } from './tradeMarkers';
import { useStocksText } from './useStocksText';
import { catalogueObservation, filterCatalogue, isAssetCatalogue, readCatalogueFavorites, STOCKS_FAVORITES_KEY, type CatalogueTab } from './stockCatalogueModel';
import OriginalStocksHeader from './OriginalStocksHeader';
import { originalStocksText } from './stockOriginalText';
import type { Asset } from './types';
import './stocksOriginal.css';

const TABS: Array<[CatalogueTab, Key]> = [['all', 'stocks.all'], ['US', 'stocks.USA'], ['RU', 'stocks.Russia'], ['Asia', 'stocks.Asia'], ['index', 'stocks.index'], ['favorites', 'stocks.favorites']];
// Names are reference presentation only. No fixture prices, candles or sparklines.
const INDEX_NAMES = ['S&P 500', 'NASDAQ 100', 'Индекс МосБиржи', 'Nikkei 225', 'Hang Seng', 'NIFTY 50'];

export default function GlobalStocksCatalogue() {
  const { t } = useLanguage(); const { s, lang, locale } = useStocksText();
  const copy = originalStocksText(lang);
  const [assets, setAssets] = useState<Asset[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [tab, setTab] = useState<CatalogueTab>('all'), [query, setQuery] = useState(''), [provider, setProvider] = useState('all'), [currency, setCurrency] = useState('all');
  const [descending, setDescending] = useState(false), [favorites, setFavorites] = useState(readCatalogueFavorites), [now, setNow] = useState(Date.now);
  const [overload, setOverload] = useState<StockOverloadState | null>(null);
  const fence = useRef(new StockSessionFence(getToken)), reads = useRef(new VisibleStockReads(() => document.hidden));
  const circuit = useRef(new StockOverloadCircuit(setOverload, () => document.hidden));
  const lifetime = useRef<AbortController | null>(null);
  const read = useCallback((recovery = false): Promise<StockReadResult> => {
    if (circuit.current.paused && !recovery) return Promise.resolve({ kind: 'failed' });
    return reads.current.run('catalogue', async (): Promise<StockReadResult> => {
      const currentLifetime = lifetime.current;
      if (!currentLifetime || currentLifetime.signal.aborted) return { kind: 'failed' };
      const request = fence.current.capture(() => !currentLifetime.signal.aborted);
      if (!getToken()) { setError('AUTH_REQUIRED'); setLoading(false); return { kind: 'failed' }; }
      setLoading(true);
      try {
        const response = await fetch('/__stocks_global/catalogue', { headers: request.headers, credentials: 'omit', cache: 'no-store',
          signal: AbortSignal.any([currentLifetime.signal, AbortSignal.timeout(10000)]) });
        const body: unknown = await response.json();
        if (!request.current()) return { kind: 'failed' };
        if (response.status === 401) { request.reject(clearToken); setAssets([]); setError('AUTH_REQUIRED'); return { kind: 'failed' }; }
        if (!response.ok) {
          const failure = body as { error?: unknown; retryAfterMs?: unknown }; const code = stockOverloadCode(failure?.error);
          if (code) { if (!recovery) circuit.current.trip(code, failure.retryAfterMs); return { kind: 'overload', code, retryAfterMs: failure.retryAfterMs }; }
          setError(typeof failure?.error === 'string' ? failure.error : 'LOCAL_SERVICE_ERROR'); return { kind: 'failed' };
        }
        if (!isAssetCatalogue(body)) { setError('LOCAL_SERVICE_ERROR'); return { kind: 'failed' }; }
        setAssets(body.catalogue); setError(''); return { kind: 'ready' };
      } catch { if (request.current()) setError('LOCAL_SERVICE_ERROR'); return { kind: 'failed' }; }
      finally { if (request.current()) setLoading(false); }
    }) || Promise.resolve({ kind: 'failed' });
  }, []);
  useEffect(() => {
    lifetime.current = new AbortController();
    const change = () => { fence.current.invalidate(); lifetime.current?.abort(); lifetime.current = new AbortController(); reads.current.reset(); circuit.current.reset(); setAssets([]); setError(''); void read(); };
    const unsubscribe = onSessionChange(change);
    const visibility = () => { if (document.hidden) circuit.current.cancelRecovery(); };
    document.addEventListener('visibilitychange', visibility);
    const stop = startVisibleStockPolling(() => { void read(); }, 60000);
    const stopClock = startVisibleStockPolling(() => setNow(Date.now()), 1000);
    return () => { stop(); stopClock(); unsubscribe(); document.removeEventListener('visibilitychange', visibility); fence.current.invalidate(); lifetime.current?.abort(); circuit.current.reset(false); };
  }, [read]);
  const shown = useMemo(() => filterCatalogue(assets, { tab, query, provider, currency, descending }, favorites, locale), [assets, tab, query, provider, currency, descending, favorites, locale]);
  const providers = [...new Set(assets.map(asset => asset.provider))].sort(), currencies = [...new Set(assets.map(asset => asset.currency))].sort();
  const toggle = (id: string) => setFavorites(previous => { const next = previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]; try { localStorage.setItem(STOCKS_FAVORITES_KEY, JSON.stringify(next)); } catch { /* Preferences do not affect account state. */ } return next; });
  const number = (value: string | number) => Number(value).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return <div className="vxo-original-page">
    <OriginalStocksHeader />
    <main className="vxo-original-catalogue">
      <div className="vxo-original-title"><h1>{t('stocks.title')}</h1><p>{copy.subtitle}</p></div>
      <section className="vxo-original-indices" aria-label={t('stocks.index')}><h2>{copy.indices}</h2><div>
        {INDEX_NAMES.map(name => <article key={name}><strong>{name}</strong><b>—</b><small>{t('stocks.unavailable')}</small><TrendingUp size={24} aria-hidden="true" /></article>)}
      </div></section>
      <div className="vxo-original-tabs" role="group" aria-label={t('stocks.filters')}>
        {TABS.map(([value, key]) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => { setTab(value); setProvider('all'); setCurrency('all'); }}>{t(key)}</button>)}
      </div>
      <div className="vxo-original-filters">
        <label className="vxo-original-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label={t('stocks.search')} placeholder={t('stocks.search')} value={query} onChange={event => setQuery(event.target.value.slice(0,64))} /></label>
        <label><select aria-label={t('stocks.exchange')} value={provider} onChange={event => setProvider(event.target.value)}><option value="all">{t('stocks.exchange')}: {t('stocks.all')}</option>{providers.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label>
        <label><select disabled aria-label={copy.sector}><option>{copy.sector}</option></select><ChevronDown size={14} aria-hidden="true" /></label>
        <label><select aria-label={t('stocks.currency')} value={currency} onChange={event => setCurrency(event.target.value)}><option value="all">{t('stocks.currency')}: {t('stocks.all')}</option>{currencies.map(value => <option key={value}>{value}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label>
      </div>
      {error && <div className="vxo-original-status" role="alert">{globalStockErrorText(error, lang)} {error === 'AUTH_REQUIRED' ? <Link to="/login?next=%2Fstocks">{s('Войти')}</Link> : <button disabled={loading || !!overload} onClick={() => void read()}>{t('stocks.retry')}</button>}</div>}
      {overload && <div className="vxo-original-status" role="alert">{stockOverloadText(overload.code,lang)} <button disabled={overload.recovering || now < overload.retryAt} onClick={() => void circuit.current.recover(() => read(true), () => Promise.resolve({ kind: 'ready' }))}>{t('stocks.retry')}{now < overload.retryAt ? ` (${Math.ceil((overload.retryAt-now)/1000)}s)` : ''}</button></div>}
      <p className="vxo-original-found" aria-live="polite">{loading && !assets.length ? t('stocks.loading') : t('stocks.found', { count: shown.length })}</p>
      <section className="vxo-original-table" aria-label={t('stocks.instruments')} aria-busy={loading}>
        <div className="vxo-original-columns"><span /><button type="button" onClick={() => setDescending(value => !value)}>{t('stocks.instrument')} <span aria-hidden="true">{descending ? '↓' : '↑'}</span></button><span>{s('Цена')}</span><span>{s('За 24 часа')}</span><span>{t('stocks.volume')}</span><span>{t('stocks.exchange')}</span><span>{t('stocks.session')}</span></div>
        {shown.map(asset => { const quote = catalogueObservation(asset, now); return <article className="vxo-original-row" key={asset.id}>
          <button type="button" className="vxo-original-favorite" aria-label={`${t(favorites.includes(asset.id) ? 'stocks.removeFavorite' : 'stocks.addFavorite')} ${asset.asset} ${asset.provider}`} aria-pressed={favorites.includes(asset.id)} onClick={() => toggle(asset.id)}><Star size={18} fill={favorites.includes(asset.id) ? 'currentColor' : 'none'} aria-hidden="true" /></button>
          <Link className="vxo-original-instrument" to={'/stocks/'+encodeURIComponent(asset.id)}><span className="vxo-original-logo" aria-hidden="true">{asset.ticker.slice(0,2)}</span><span><strong>{asset.name}</strong><small>{asset.asset} · {asset.provider.toUpperCase()}</small></span></Link>
          <div className="vxo-original-price"><strong>{quote ? number(quote.price) : '—'}</strong> <small>{asset.currency}</small><span className="vxo-original-mobile-change" data-direction={quote?.change != null && quote.change < 0 ? 'down' : 'up'}>{quote?.change == null ? '—' : `${quote.change > 0 ? '+' : ''}${number(quote.change)}%`}</span><small className="vxo-original-age">{quote ? quoteAge(quote.timestamp, now, lang) : t('stocks.unavailable')}</small></div>
          <span className="vxo-original-change" data-direction={quote?.change != null && quote.change < 0 ? 'down' : 'up'}>{quote?.change == null ? '—' : `${quote.change > 0 ? '+' : ''}${number(quote.change)}%`}</span>
          <span className="vxo-original-secondary">—</span><span className="vxo-original-secondary">{asset.provider.toUpperCase()}</span><span className="vxo-original-secondary">—</span>
        </article>; })}
        {!loading && !shown.length && <p className="vxo-original-empty">{t('stocks.empty')}{tab === 'favorites' && <small>{t('stocks.favoritesEmpty')}</small>}</p>}
      </section>
    </main>
  </div>;
}
