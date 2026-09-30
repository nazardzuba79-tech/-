import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { CryptoIcon } from '../../../components/CryptoIcon';
import { HomeMarket, HomeTicker, byVolume, formatCompactUsd, formatPriceValue } from '../useHomeMarket';
import { IxAreaChart, IxSpark } from './IxCharts';
import { ixCopy } from './ixCopy';

const BOARD_PAIRS = ['ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT'];
const BOARD_CFD = ['XAUUSD', 'WTIUSD'];

export const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
export const dir = (v: number) => (v >= 0 ? 'up' : 'down');

/**
 * The hero: the brand's own promise on the left, and on the right a real
 * market board fed by the same homepage market hook — the hero pair's
 * recent closes, the main pairs and two CFD references. No artwork carries
 * a price; every figure on it is data.
 */
export function IxHero({ market }: { market: HomeMarket }) {
  const { t, lang } = useLanguage();
  const c = ixCopy[lang];
  const heroPair = market.hero.pair ?? 'BTC/USDT';
  const byPair = useMemo(() => new Map(market.tickers.map(tk => [tk.pair, tk])), [market.tickers]);
  const lead = byPair.get(heroPair) ?? null;
  const rows = useMemo(() => {
    const wanted = BOARD_PAIRS.map(p => byPair.get(p)).filter((x): x is HomeTicker => !!x);
    const fill = byVolume(market.tickers, 12).filter(tk => tk.pair !== heroPair && !wanted.includes(tk));
    return [...wanted, ...fill].slice(0, 4);
  }, [byPair, market.tickers, heroPair]);
  const cfd = market.cfd?.configured ? BOARD_CFD.map(s => market.cfd!.tickers.find(x => x.symbol === s)).filter(Boolean) : [];
  const spark = (base: string) => market.rankings.find(r => r.symbol.toUpperCase() === base.toUpperCase())?.sparkline;

  return <section className="ix-hero" aria-labelledby="ix-hero-title">
    <div className="ix-wrap ix-hero-grid">
      <div className="ix-hero-copy">
        <p className="ix-eyebrow"><i aria-hidden="true" />{t('home.hero.badge')}</p>
        <h1 id="ix-hero-title">{t('home.hero.subtitle')}</h1>
        <p className="ix-lead">{t('home.hero.description')}</p>
        <div className="ix-actions">
          <Link className="ix-btn ix-btn-primary" to="/trade">{t('home.cta.openTerminal')}<ArrowRight size={16} aria-hidden="true" /></Link>
          <Link className="ix-btn ix-btn-ghost" to="/markets">{t('home.cta.viewMarkets')}</Link>
        </div>
        <nav className="ix-quick" aria-label="VOLTEX">
          <Link to="/trade">{t('trade.spotTab')}</Link>
          <Link to="/futures">{t('nav.futures')}</Link>
          <Link to="/copy-trading">{t('nav.copyTrading')}</Link>
          <Link to="/card">{t('nav.card')}</Link>
          <Link to="/otc">{t('nav.otc')}</Link>
        </nav>
      </div>

      <div className="ix-board" aria-label={c.boardTitle}>
        <div className="ix-board-head">
          <span className="ix-board-title">{c.boardTitle}</span>
          {market.tickerUpdatedAt && <span className="ix-board-time"><i aria-hidden="true" />{t('home.overview.updated')} {new Date(market.tickerUpdatedAt).toLocaleTimeString(lang === 'en' ? 'en-GB' : lang, { hour: '2-digit', minute: '2-digit' })}</span>}
        </div>
        <Link className="ix-board-lead" to={`/trade?pair=${encodeURIComponent(heroPair)}`}>
          <div className="ix-board-pair">
            <CryptoIcon symbol={heroPair.split('/')[0]} size={28} imageUrl={market.logoOf(heroPair.split('/')[0])} />
            <span><b>{heroPair}</b><small>{c.openPair}</small></span>
          </div>
          <div className="ix-board-price">
            <b>{lead ? formatPriceValue(lead.price) : '—'}</b>
            {lead && <span className="ix-chg" data-dir={dir(lead.change)}>{signed(lead.change)}</span>}
          </div>
          <dl className="ix-board-facts">
            <div><dt>{c.high}</dt><dd>{lead ? formatPriceValue(lead.high) : '—'}</dd></div>
            <div><dt>{c.low}</dt><dd>{lead ? formatPriceValue(lead.low) : '—'}</dd></div>
            <div><dt>{c.volume}</dt><dd>{lead ? formatCompactUsd(lead.quoteVolume) : '—'}</dd></div>
          </dl>
        </Link>
        <IxAreaChart candles={market.hero.candles} label={c.chartUnavailable} />
        <div className="ix-board-group">{c.boardCrypto}</div>
        <ul className="ix-board-rows">
          {rows.map(tk => <li key={tk.pair}><Link to={`/trade?pair=${encodeURIComponent(tk.pair)}`}>
            <span className="ix-row-name"><CryptoIcon symbol={tk.base} size={20} imageUrl={market.logoOf(tk.base)} />{tk.base}<small>/{tk.quote}</small></span>
            <IxSpark points={spark(tk.base)} width={72} height={22} />
            <span className="ix-num">{formatPriceValue(tk.price)}</span>
            <span className="ix-chg" data-dir={dir(tk.change)}>{signed(tk.change)}</span>
          </Link></li>)}
        </ul>
        {cfd.length > 0 && <>
          <div className="ix-board-group">{c.boardCfd}</div>
          <ul className="ix-board-rows">
            {cfd.map(row => { const ch = Number(row!.changePercent24h); return <li key={row!.symbol}><Link to={`/trade?market=cfd&symbol=${encodeURIComponent(row!.symbol)}`}>
              <span className="ix-row-name"><span className="ix-cfd-mark" aria-hidden="true">{row!.symbol.slice(0, 3)}</span>{row!.name}</span>
              <IxSpark points={market.cfdPriceHistory?.[row!.symbol]} width={72} height={22} />
              <span className="ix-num">{row!.price ?? '—'}</span>
              <span className="ix-chg" data-dir={dir(Number.isFinite(ch) ? ch : 0)}>{Number.isFinite(ch) ? signed(ch) : '—'}</span>
            </Link></li>; })}
          </ul>
        </>}
      </div>
    </div>
  </section>;
}
