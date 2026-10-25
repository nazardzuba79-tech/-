import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, Search, RefreshCw } from 'lucide-react';
import { Nav } from '../../components/Nav';
import { STOCKS_ONCHAIN_CATALOGUE, STOCKS_QUALITY_COUNTS, onchainChartUrl, type OnchainPoolChoice } from './onchainPoolCatalogue';
import './stocksOnchainEmbedPreview.css';

type CatalogueFilter = 'all' | 'active' | 'checked';
type FrameState = 'loading' | 'document' | 'error' | 'slow';

function poolEvidence(pool: OnchainPoolChoice): string {
  const evidence = [];
  if (pool.verifiedOnChain) evidence.push('Solana SwapEvent');
  if (pool.geckoIndexed) evidence.push('GeckoTerminal API');
  return evidence.length ? evidence.join(' + ') : 'Только DEX Screener';
}
function poolName(pool: OnchainPoolChoice): string {
  const activity = pool.tx24hReported === null ? '' : ' · ' + pool.tx24hReported.toLocaleString('ru-RU') + ' сделок/24ч*';
  return pool.dex.toUpperCase() + ' · ' + poolEvidence(pool) + activity;
}

/** Local-only; data displayed here belongs to the provider. This view never issues an order. */
export default function StocksOnchainEmbedPreview() {
  const [filter, setFilter] = useState('');
  // Historical screen only: this is not a live liquidity or trading eligibility claim.
  const [catalogueFilter, setCatalogueFilter] = useState<CatalogueFilter>('active');
  // Route state makes a specific asset/pool shareable, survives reload and supports Back/Forward.
  // Unknown ticker and unallowlisted pool parameters are ignored, never interpolated into iframe URLs.
  const [params, setParams] = useSearchParams();
  const [reloadCounter, setReloadCounter] = useState(0);
  const [frameState, setFrameState] = useState<FrameState>('loading');

  const markets = STOCKS_ONCHAIN_CATALOGUE;
  const selectedTicker = params.get('asset') ?? 'SPYx';
  const instrument = markets.find(m => m.ticker === selectedTicker) ?? markets.find(m => m.ticker === 'SPYx') ?? markets[0];
  const pool = instrument.pools.find(p => p.address === params.get('pool')) ?? instrument.pools[0];
  const iframeKey = instrument.ticker + ':' + pool.address + ':' + reloadCounter;
  useEffect(() => {
    setFrameState('loading');
    // Cross-origin frames may never signal a useful chart even if their document loads.
    // This is a delay warning, NOT a claim the chart is unavailable or an automatic pool switch.
    const handle = window.setTimeout(() => setFrameState(s => s === 'loading' ? 'slow' : s), 20000);
    return () => window.clearTimeout(handle);
  }, [iframeKey]);
  const shown = useMemo(() => markets.filter(m => {
    if (catalogueFilter === 'active' && !m.activeAtDiscovery) return false;
    if (catalogueFilter === 'checked' && !m.independentlyVerifiedPool && !m.geckoIndexedPool) return false;
    return (m.ticker + ' ' + m.name).toLowerCase().includes(filter.trim().toLowerCase());
  }), [catalogueFilter, filter, markets]);

  const poolUrl = onchainChartUrl(instrument, pool);
  const historicalLiquidity = pool.liquidityUSD === null ? 'Нет данных' :
    'USD ' + pool.liquidityUSD.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  const historicalTrades = pool.tx24hReported === null ? 'Нет данных' :
    pool.tx24hReported.toLocaleString('ru-RU');
  const sourceUrl = 'https://www.geckoterminal.com/solana/pools/' + pool.address;

  function selectTicker(ticker: string) {
    if (!markets.some(m => m.ticker === ticker)) return;
    const next = new URLSearchParams(params);
    next.set('asset', ticker);
    next.delete('pool');
    setFrameState('loading');
    setParams(next);
  }
  function changePool(address: string) {
    if (!instrument.pools.some(p => p.address === address)) return;
    const next = new URLSearchParams(params);
    next.set('asset', instrument.ticker);
    next.set('pool', address);
    setFrameState('loading');
    setParams(next);
  }
  function refreshChart() {
    setFrameState('loading');
    setReloadCounter(n => n + 1);
  }

  return <div className="vxson-root">
    <Nav active="/stocks" hideTicker readProfile={false} />
    <main className="vxson-layout">
      <header className="vxson-head">
        <div><span className="vxson-eyebrow">VOLTEX / STOCKS / ON-CHAIN</span>
          <h1>Токенизированные акции</h1>
          <p>Реальные DEX-пулы Solana · исследовательский просмотр на 127.0.0.1</p>
        </div>
        <span className="vxson-mode">LOCAL PREVIEW · TRADING OFF</span>
      </header>
      <div className="vxson-grid">
        <aside className="vxson-sidebar" aria-label="Активы">
          <div className="vxson-sidebar-top">
            <h2>Активы <small>{STOCKS_QUALITY_COUNTS.candidates}</small></h2>
            <label className="vxson-search"><Search size={16} /><input value={filter}
              onChange={e => setFilter(e.target.value)} placeholder="Поиск xStocks" aria-label="Найти актив" /></label>
            <select className="vxson-filter-mode" value={catalogueFilter} onChange={e => setCatalogueFilter(e.target.value as CatalogueFilter)}
              aria-label="Уровень проверки активов">
              <option value="active">Предварительный отбор ({STOCKS_QUALITY_COUNTS.activitySnapshot})</option>
              <option value="all">Все кандидаты, включая малоликвидные ({STOCKS_QUALITY_COUNTS.candidates})</option>
              <option value="checked">Дополнительная проверка пула ({STOCKS_QUALITY_COUNTS.withEitherPoolProof})</option>
            </select>
          </div>
          <p className="vxson-catalogue-warning" role="note">Активность и ликвидность — исторический снимок 25.10.2026, не текущие значения. Отбор не подтверждает пригодность к торговле. Показано {shown.length} из {STOCKS_QUALITY_COUNTS.candidates}.</p>
          <div className="vxson-markets">{shown.map(m =>
            <button type="button" key={m.ticker} className={'vxson-market' + (m.ticker === instrument.ticker ? ' is-active' : '')}
              aria-pressed={m.ticker === instrument.ticker} onClick={() => selectTicker(m.ticker)}>
              <span className="vxson-market-icon">{m.ticker.slice(0, 1)}</span>
              <span><strong>{m.ticker}<small>/USDC</small></strong>
                <span className="vxson-market-name">{m.name}</span>
                <span className="vxson-market-evidence">{m.independentlyVerifiedPool ? 'Есть on-chain пул' : m.geckoIndexedPool ? 'Gecko API' : 'DEX кандидат'}{!m.activeAtDiscovery && ' · ниже порога снимка'}</span>
              </span>
            </button>)}
            {!shown.length && <p className="vxson-empty">Нет активов по этому фильтру</p>}
          </div>
          <p className="vxson-source-note">Это сделки с токенами xStocks в DEX-пулах, а не котировки акций Nasdaq или NYSE. Числа активности — старый срез, не текущая ликвидность.</p>
        </aside>
        <section className="vxson-center" aria-label={instrument.ticker + ' — DEX-график'}>
          <div className="vxson-market-head">
            <span className="vxson-selected-icon">{instrument.ticker.slice(0, 1)}</span>
            <div><h2>{instrument.ticker}<span>/USDC</span></h2><p>{instrument.name} · Solana · {pool.dex.toUpperCase()}</p></div>
            <a className="vxson-external" href={sourceUrl} target="_blank" rel="noopener noreferrer">
              Открыть источник <ExternalLink size={14} />
            </a>
          </div>
          <div className="vxson-chart-controls">
            <label htmlFor="vxson-pool">Пул графика</label>
            <select id="vxson-pool" aria-label="Выбрать пул графика" value={pool.address}
              onChange={e => changePool(e.target.value)}>
              {instrument.pools.map(p => <option key={p.address} value={p.address}>{poolName(p)}</option>)}
            </select>
            <span className="vxson-pool-count">{instrument.pools.length} {instrument.pools.length === 1 ? 'источник' : 'источника/источников'}</span>
          </div>
          <div className="vxson-candidate-metrics" aria-label="Исторические показатели выбранного DEX-пула">
            <span>Ликвидность*: {historicalLiquidity}</span>
            <span>Сделки / 24ч*: {historicalTrades}</span>
            <span>*Снимок 25.10.2026, не live</span>
          </div>
          <p className="vxson-evidence-note" role="status">
            {pool.verifiedOnChain ? 'Адрес этого пула и SwapEvent проверены через Solana RPC. ' : ''}
            {pool.geckoIndexed ? 'Адрес этого пула обнаружен в GeckoTerminal API. ' : ''}
            {!pool.verifiedOnChain && !pool.geckoIndexed ? 'Этот пул пока известен только по данным DEX Screener. ' : ''}
            Проверка адреса не подтверждает загрузку самого графика и право коммерческого показа.
          </p>
          <div className="vxson-frame">
            <iframe key={iframeKey} title={instrument.ticker + '/USDC — GeckoTerminal on-chain chart'}
              src={poolUrl} loading="eager" referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setFrameState('document')} onError={() => setFrameState('error')}
              allow="fullscreen" allowFullScreen />
          </div>
          <div className="vxson-frame-status" role="status">
            <span>{frameState === 'loading' ? 'Загрузка внешнего iframe…' :
              frameState === 'slow' ? 'Нет подтверждения загрузки за 20 секунд. Источник может быть медленным или недоступным.' :
              frameState === 'error' ? 'Браузер сообщил об ошибке iframe. Проверьте источник.' :
              'Документ iframe загружен; отображение свечей и точность котировок не подтверждены автоматически.'}</span>
            <div className="vxson-frame-actions">
              <button type="button" className="vxson-chart-retry" onClick={refreshChart} aria-label="Перезагрузить график">
                <RefreshCw size={12} /> Обновить график
              </button>
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Проверить GeckoTerminal <ExternalLink size={12}/></a>
            </div>
          </div>
          <div className="vxson-attribution"><span>Внешний график: GeckoTerminal. Изменение таймфрейма — внутри виджета.</span>
            <a href="https://about.geckoterminal.com/embed-charts" target="_blank" rel="noopener noreferrer">
              Документация GeckoTerminal <ExternalLink size={12}/></a></div>
          <div className="vxson-risk">Только локальная техническая проверка. Коммерческие права для токенизированных ценных бумаг не подтверждены.
            Провайдер может ограничить или заблокировать iframe. Показываются DEX-цены токенов, не цены обычных акций.
            Торговля, ордера, позиции и изменение балансов отключены.</div>
        </section>
        <aside className="vxson-trade-off">
          <div className="vxson-trade-title">SPOT · xStocks</div>
          <div className="vxson-trade-symbol">{instrument.ticker} / USDC</div>
          <div className="vxson-price-label">Рыночная цена</div><div className="vxson-price-placeholder">—</div>
          <p className="vxson-price-explain">Цена не копируется из iframe. Непроверенных котировок здесь нет.</p>
          <div className="vxson-tabs"><span>Купить</span><span>Продать</span></div>
          <button className="vxson-disabled-buy" type="button" disabled>Торговля отключена</button>
          <p className="vxson-trade-info">Эта вкладка не создаёт заявок, не изменяет баланс и не открывает позиции.</p>
        </aside>
      </div>
    </main>
  </div>;
}
