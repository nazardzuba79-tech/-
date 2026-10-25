import { useMemo, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { Nav } from '../../components/Nav';
import { STOCKS_ONCHAIN_CATALOGUE, STOCKS_QUALITY_COUNTS, onchainChartUrl, type OnchainPoolChoice } from './onchainPoolCatalogue';
import './stocksOnchainEmbedPreview.css';

type CatalogueFilter = 'all' | 'active' | 'checked';
type FrameState = 'loading' | 'document' | 'error';

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
  const [catalogueFilter, setCatalogueFilter] = useState<CatalogueFilter>('all');
  const [selectedTicker, setSelectedTicker] = useState('SPYx');
  const [selectedPool, setSelectedPool] = useState<string | null>(null);
  const [frameState, setFrameState] = useState<FrameState>('loading');

  const markets = STOCKS_ONCHAIN_CATALOGUE;
  const instrument = markets.find(m => m.ticker === selectedTicker) ?? markets[0];
  const pool = instrument.pools.find(p => p.address === selectedPool) ?? instrument.pools[0];
  const shown = useMemo(() => markets.filter(m => {
    if (catalogueFilter === 'active' && !m.activeAtDiscovery) return false;
    if (catalogueFilter === 'checked' && !m.independentlyVerifiedPool && !m.geckoIndexedPool) return false;
    return (m.ticker + ' ' + m.name).toLowerCase().includes(filter.trim().toLowerCase());
  }), [catalogueFilter, filter, markets]);

  const poolUrl = onchainChartUrl(instrument, pool);
  const sourceUrl = 'https://www.geckoterminal.com/solana/pools/' + pool.address;

  function selectTicker(ticker: string) {
    setSelectedTicker(ticker);
    setSelectedPool(null);
    setFrameState('loading');
  }
  function changePool(address: string) {
    if (!instrument.pools.some(p => p.address === address)) return;
    setSelectedPool(address);
    setFrameState('loading');
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
              <option value="all">Все кандидаты ({STOCKS_QUALITY_COUNTS.candidates})</option>
              <option value="active">Активность в момент проверки ({STOCKS_QUALITY_COUNTS.activitySnapshot})</option>
              <option value="checked">Дополнительная проверка пула ({STOCKS_QUALITY_COUNTS.withEitherPoolProof})</option>
            </select>
          </div>
          <div className="vxson-markets">{shown.map(m =>
            <button type="button" key={m.ticker} className={'vxson-market' + (m.ticker === instrument.ticker ? ' is-active' : '')}
              aria-pressed={m.ticker === instrument.ticker} onClick={() => selectTicker(m.ticker)}>
              <span className="vxson-market-icon">{m.ticker.slice(0, 1)}</span>
              <span><strong>{m.ticker}<small>/USDC</small></strong>
                <span className="vxson-market-name">{m.name}</span>
                <span className="vxson-market-evidence">{m.independentlyVerifiedPool ? 'Есть on-chain пул' : m.geckoIndexedPool ? 'Gecko API' : 'DEX кандидат'}</span>
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
          <p className="vxson-evidence-note" role="status">
            {pool.verifiedOnChain ? 'Адрес этого пула и SwapEvent проверены через Solana RPC. ' : ''}
            {pool.geckoIndexed ? 'Адрес этого пула обнаружен в GeckoTerminal API. ' : ''}
            {!pool.verifiedOnChain && !pool.geckoIndexed ? 'Этот пул пока известен только по данным DEX Screener. ' : ''}
            Проверка адреса не подтверждает загрузку самого графика и право коммерческого показа.
          </p>
          <div className="vxson-frame">
            <iframe key={pool.address} title={instrument.ticker + '/USDC — GeckoTerminal on-chain chart'}
              src={poolUrl} loading="eager" referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setFrameState('document')} onError={() => setFrameState('error')}
              allow="clipboard-write; fullscreen" allowFullScreen />
          </div>
          <div className="vxson-frame-status" role="status">
            {frameState === 'loading' ? 'Загрузка внешнего iframe…' :
              frameState === 'error' ? 'Ошибка iframe. Откройте источник для проверки.' :
              'Событие загрузки iframe получено; наличие свечей и корректных котировок не подтверждено автоматически.'}
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Проверить непосредственно на GeckoTerminal <ExternalLink size={12}/></a>
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
