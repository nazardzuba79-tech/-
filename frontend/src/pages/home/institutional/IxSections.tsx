import { Link } from 'react-router-dom';
import { ArrowLeftRight, ArrowRight, ChartCandlestick, Copy, CreditCard, Handshake, TrendingUp } from 'lucide-react';
import { type Key, useLanguage } from '../../../lib/i18n';
import { CardBenefitIcon, type CardBenefit } from '../CardBenefitIcon';
import { HomeMarket, formatCompactUsd } from '../useHomeMarket';
import { ixCopy } from './ixCopy';

/** Five facts in one ruled row: the market, then VOLTEX's own reach. */
export function IxStats({ market }: { market: HomeMarket }) {
  const { lang } = useLanguage();
  const c = ixCopy[lang], g = market.global, fg = market.fearGreed;
  const pairs = market.tickers.filter(tk => tk.quote === 'USDT').length;
  const cap = g?.marketCapChangePercent24h;
  const cells: { label: string; value: string; note?: string; dir?: 'up' | 'down' }[] = [
    { label: c.statCap, value: formatCompactUsd(g?.totalMarketCapUsd), note: typeof cap === 'number' ? `${cap >= 0 ? '+' : ''}${cap.toFixed(2)}%` : undefined, dir: typeof cap === 'number' ? (cap >= 0 ? 'up' : 'down') : undefined },
    { label: c.statVolume, value: formatCompactUsd(g?.totalVolume24hUsd) },
    { label: c.statDominance, value: typeof g?.btcDominancePercent === 'number' ? `${g.btcDominancePercent.toFixed(1)}%` : '—' },
    { label: c.statFearGreed, value: fg ? String(fg.value) : '—', note: fg ? c.fearGreed[fg.classification] ?? fg.classification : undefined },
    { label: c.statPairs, value: pairs ? String(pairs) : '—' },
  ];
  return <section className="ix-wrap" aria-label={c.statCap}>
    <dl className="ix-stats">
      {cells.map(cell => <div key={cell.label}><dt>{cell.label}</dt><dd><b>{cell.value}</b>{cell.note && <span className="ix-stat-note" data-dir={cell.dir}>{cell.note}</span>}</dd></div>)}
    </dl>
  </section>;
}

const PRODUCTS: { key: keyof typeof ixCopy.en.products; to: string; label: Key; Icon: typeof ChartCandlestick }[] = [
  { key: 'spot', to: '/trade', label: 'trade.spotTab', Icon: ChartCandlestick },
  { key: 'futures', to: '/futures', label: 'nav.futures', Icon: TrendingUp },
  { key: 'copy', to: '/copy-trading', label: 'nav.copyTrading', Icon: Copy },
  { key: 'card', to: '/card', label: 'nav.card', Icon: CreditCard },
  { key: 'otc', to: '/otc', label: 'nav.otc', Icon: Handshake },
  { key: 'arbitrage', to: '/arbitrage', label: 'nav.arbitrage', Icon: ArrowLeftRight },
];

export function IxProducts() {
  const { t, lang } = useLanguage();
  const c = ixCopy[lang];
  return <section className="ix-wrap ix-section" aria-labelledby="ix-products-title">
    <header className="ix-section-head">
      <p className="ix-label">{c.productsLabel}</p>
      <h2 id="ix-products-title">{c.productsTitle}</h2>
    </header>
    <ul className="ix-products">
      {PRODUCTS.map(({ key, to, label, Icon }) => <li key={key}><Link to={to}>
        <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
        <b>{t(label)}</b>
        <span>{c.products[key]}</span>
        <ArrowRight className="ix-products-go" size={16} aria-hidden="true" />
      </Link></li>)}
    </ul>
  </section>;
}

const BENEFITS: { kind: CardBenefit; title: Key; text: Key }[] = [
  { kind: 'world', title: 'home.card.benefit.world.title', text: 'home.card.benefit.world.text' },
  { kind: 'apple', title: 'home.card.benefit.apple.title', text: 'home.card.benefit.apple.text' },
  { kind: 'ai', title: 'home.card.benefit.ai.title', text: 'home.card.benefit.ai.text' },
  { kind: 'atm', title: 'home.card.benefit.atm.title', text: 'home.card.benefit.atm.text' },
];

/** The card as a product: the card itself, four facts, two actions. */
export function IxCard() {
  const { t } = useLanguage();
  return <section id="card" className="ix-wrap ix-section" aria-labelledby="ix-card-title">
    <div className="ix-card">
      <div className="ix-card-copy">
        <p className="ix-label">{t('home.card.name')}</p>
        <h2 id="ix-card-title">{t('home.card.titleTop')} {t('home.card.titleBottom')}</h2>
        <p className="ix-lead">{t('home.card.text')}</p>
        <ul className="ix-card-benefits">
          {BENEFITS.map(b => <li key={b.kind}><CardBenefitIcon kind={b.kind} /><span><b>{t(b.title)}</b>{t(b.text)}</span></li>)}
        </ul>
        <div className="ix-actions">
          <Link className="ix-btn ix-btn-primary" to="/card">{t('home.cta.getCard')}<ArrowRight size={16} aria-hidden="true" /></Link>
          <Link className="ix-btn ix-btn-ghost" to="/card">{t('home.card.learnMore')}</Link>
        </div>
      </div>
      <div className="ix-card-visual">
        <img src="/cards/crypto-card-final/voltex-black-signature-final.webp" width={1600} height={1000} loading="lazy" decoding="async" alt="VOLTEX Crypto Card" />
      </div>
    </div>
  </section>;
}

/**
 * Replaces the third-party exchange and bank logos with VOLTEX's own
 * coverage, counted from the same data the page already loads.
 */
export function IxReach({ market }: { market: HomeMarket }) {
  const { t, lang } = useLanguage();
  const c = ixCopy[lang];
  const spot = market.tickers.filter(tk => tk.quote === 'USDT').length;
  const cfd = market.cfd?.configured ? market.cfd.tickers.length : 0;
  const tiles = [
    { value: spot || '—', label: c.reachCrypto, to: '/markets' },
    { value: market.futuresSymbols.length || '—', label: c.reachFutures, to: '/futures' },
    { value: cfd || '—', label: c.reachCfd, note: c.reachCfdWhat, to: '/trade?market=cfd' },
    { value: c.reachHoursValue, label: c.reachHours, to: '/trade' },
  ];
  return <section className="ix-wrap ix-section" aria-labelledby="ix-reach-title">
    <header className="ix-section-head ix-section-head-split">
      <div><p className="ix-label">{c.reachLabel}</p><h2 id="ix-reach-title">{t('home.ecosystem.title')}</h2></div>
      <p className="ix-lead">{t('home.ecosystem.subtitle')}</p>
    </header>
    <ul className="ix-reach">
      {tiles.map(tile => <li key={tile.label}><Link to={tile.to}><b>{tile.value}</b><span>{tile.label}</span>{tile.note && <small>{tile.note}</small>}</Link></li>)}
    </ul>
  </section>;
}
