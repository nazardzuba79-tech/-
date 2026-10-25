import { useMemo, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { Nav } from '../../components/Nav';
import { ONCHAIN_EMBED_MARKETS } from './onchainEmbedPreviewData';
import { STOCKS_DISCOVERED_CANDIDATES } from './onchainDiscoveredCandidates';
import './stocksOnchainEmbedPreview.css';

const MARKETS = [
  ...ONCHAIN_EMBED_MARKETS.map(m => ({...m, poolVerification: 'onchain' as const, dex: 'raydium'})),
  ...STOCKS_DISCOVERED_CANDIDATES
    .filter(m => !ONCHAIN_EMBED_MARKETS.some(existing => existing.ticker === m.ticker))
    .map(m => ({...m, poolVerification: 'aggregator' as const})),
];
function verifiedCandidateUrl(instrument: typeof MARKETS[number]): string {
  // Never permit a ticker-supplied URL. This is a finite exact address allowlist.
  if (!MARKETS.some(m => m.pool === instrument.pool && m.mint === instrument.mint && m.ticker === instrument.ticker)) {
    throw Error('UNRECOGNIZED_STOCKS_POOL');
  }
  return 'https://www.geckoterminal.com/solana/pools/' + instrument.pool;
}
function iframeUrl(instrument: typeof MARKETS[number]): string {
  const url = new URL(verifiedCandidateUrl(instrument));
  for (const [k, v] of Object.entries({embed: '1', info: '0', swaps: '0', light_chart: '0',
    chart_type: 'price', resolution: '1h', bg_color: '101318'})) url.searchParams.set(k, v);
  return url.href;
}

/** Private localhost only. Embeds are provider-owned, not a VOLTEX market-data feed. No trading. */
export default function StocksOnchainEmbedPreview() {
  const [filter, setFilter] = useState('');
  const [selectedTicker, setSelectedTicker] = useState('SPYx');
  const instrument = MARKETS.find(m => m.ticker === selectedTicker) ?? MARKETS[0];
  const shown = useMemo(() => MARKETS.filter(m =>
    (m.ticker + ' ' + m.name).toLowerCase().includes(filter.trim().toLowerCase())), [filter]);
  return <div className="vxson-root">
    <Nav active="/stocks" hideTicker readProfile={false} />
    <main className="vxson-layout">
      <header className="vxson-head">
        <div><span className="vxson-eyebrow">VOLTEX / STOCKS / ON-CHAIN</span>
          <h1>Токенізовані акції</h1>
          <p>Реальні DEX-графіки токенів у Solana · режим локального перегляду</p>
        </div>
        <span className="vxson-mode">LOCAL PREVIEW · TRADING OFF</span>
      </header>
      <div className="vxson-grid">
        <aside className="vxson-sidebar" aria-label="Активи">
          <div className="vxson-sidebar-top"><h2>Активи <small>{MARKETS.length}</small></h2>
            <label className="vxson-search"><Search size={16}/><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Пошук xStocks" aria-label="Знайти актив"/></label>
          </div>
          <div className="vxson-markets">{shown.map(m =>
            <button type="button" key={m.ticker} className={'vxson-market'+(m.ticker===instrument.ticker?' is-active':'')}
              aria-pressed={m.ticker===instrument.ticker} onClick={()=>setSelectedTicker(m.ticker)}>
              <span className="vxson-market-icon">{m.ticker.slice(0,1)}</span>
              <span><strong>{m.ticker}<small>/USDC</small></strong><span className="vxson-market-name">{m.name}</span></span>
            </button>)}
            {!shown.length && <p className="vxson-empty">Немає такого активу</p>}
          </div>
          <p className="vxson-source-note">Solana · Raydium CLMM. Тут ціни токенів з окремих DEX-пулів, а не котирування Nasdaq чи NYSE.</p>
        </aside>
        <section className="vxson-center" aria-label={instrument.ticker+' — DEX-графік'}>
          <div className="vxson-market-head">
            <span className="vxson-selected-icon">{instrument.ticker.slice(0,1)}</span>
            <div><h2>{instrument.ticker}<span>/USDC</span></h2><p>{instrument.name} · Solana</p></div>
            <a className="vxson-external" href={verifiedCandidateUrl(instrument)} target="_blank" rel="noopener noreferrer">
              Відкрити джерело <ExternalLink size={14} />
            </a>
          </div>
          {instrument.poolVerification === 'aggregator' && <div className="vxson-candidate-metrics">
            <span>DEX: {instrument.dex}</span>
            <span>{'tx24hReported' in instrument ? instrument.tx24hReported.toLocaleString('en-US') : '—'} транзакцій / 24 год (агрегатор)</span>
            <span>{'liquidityUSD' in instrument ? '
            ? 'Пул і SwapEvent підтверджені on-chain. Графік надає зовнішній сервіс.'
            : 'Кандидат: емітент підтвердив токен, але пул знайдено лише DEX-агрегатором. On-chain перевірка пулу ще потрібна.'}</p>
          <div className="vxson-frame"><iframe key={instrument.pool} title={instrument.ticker+'/USDC — GeckoTerminal on-chain chart'}
            src={iframeUrl(instrument)} loading="eager" referrerPolicy="strict-origin-when-cross-origin"
            allow="clipboard-write; fullscreen" allowFullScreen /></div>
          <div className="vxson-attribution"><span>Живий графік безпосередньо надає GeckoTerminal.</span>
            <a href="https://about.geckoterminal.com/embed-charts" target="_blank" rel="noopener noreferrer">
              GeckoTerminal Embed <ExternalLink size={12}/></a></div>
          <div className="vxson-risk">Локальна перевірка. Комерційні права показу токенізованих цінних паперів не підтверджені.
            Дані може затримувати або блокувати провайдер; це не ціна акції на фондовій біржі. Ордери й баланси відключені.</div>
        </section>
        <aside className="vxson-trade-off">
          <div className="vxson-trade-title">SPOT · xStocks</div>
          <div className="vxson-trade-symbol">{instrument.ticker} / USDC</div>
          <div className="vxson-price-label">Ринкова ціна</div><div className="vxson-price-placeholder">—</div>
          <p className="vxson-price-explain">Ціна не дублюється з iframe. Неперевірених котирувань немає.</p>
          <div className="vxson-tabs"><span>Купити</span><span>Продати</span></div>
          <button className="vxson-disabled-buy" type="button" disabled>Торгівля вимкнена</button>
          <p className="vxson-trade-info">Цей перегляд ніколи не надсилає заявки, не змінює баланси й не відкриває позиції.</p>
        </aside>
      </div>
    </main>
  </div>;
}
 + instrument.liquidityUSD.toLocaleString('en-US') : '—'} ліквідності (знімок)</span>
          </div>}
          <p className="vxson-source-note" role="status">{instrument.poolVerification === 'onchain'
            ? 'Пул і SwapEvent підтверджені on-chain. Графік надає зовнішній сервіс.'
            : 'Кандидат: емітент підтвердив токен, але пул знайдено лише DEX-агрегатором. On-chain перевірка пулу ще потрібна.'}</p>
          <div className="vxson-frame"><iframe key={instrument.pool} title={instrument.ticker+'/USDC — GeckoTerminal on-chain chart'}
            src={iframeUrl(instrument)} loading="eager" referrerPolicy="strict-origin-when-cross-origin"
            allow="clipboard-write; fullscreen" allowFullScreen /></div>
          <div className="vxson-attribution"><span>Живий графік безпосередньо надає GeckoTerminal.</span>
            <a href="https://about.geckoterminal.com/embed-charts" target="_blank" rel="noopener noreferrer">
              GeckoTerminal Embed <ExternalLink size={12}/></a></div>
          <div className="vxson-risk">Локальна перевірка. Комерційні права показу токенізованих цінних паперів не підтверджені.
            Дані може затримувати або блокувати провайдер; це не ціна акції на фондовій біржі. Ордери й баланси відключені.</div>
        </section>
        <aside className="vxson-trade-off">
          <div className="vxson-trade-title">SPOT · xStocks</div>
          <div className="vxson-trade-symbol">{instrument.ticker} / USDC</div>
          <div className="vxson-price-label">Ринкова ціна</div><div className="vxson-price-placeholder">—</div>
          <p className="vxson-price-explain">Ціна не дублюється з iframe. Неперевірених котирувань немає.</p>
          <div className="vxson-tabs"><span>Купити</span><span>Продати</span></div>
          <button className="vxson-disabled-buy" type="button" disabled>Торгівля вимкнена</button>
          <p className="vxson-trade-info">Цей перегляд ніколи не надсилає заявки, не змінює баланси й не відкриває позиції.</p>
        </aside>
      </div>
    </main>
  </div>;
}
