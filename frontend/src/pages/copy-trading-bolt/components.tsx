import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Crown,
  LineChart,
  Lock,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Users,
  WalletCards,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  type Trader,
  type RiskLevel,
  type Period,
  PERIODS,
  PERIOD_LABEL_RU,
  nazarTrader,
  marketplaceTraders,
  nazarEconomics,
  formatPercent,
  roiClass,
  formatAccountSize,
  generateProfileData,
  generateTrades,
  getChartData,
  getCopierProfit,
  getLifetimeCopierProfit,
  getLifetimeTraderEarnings,
  getRoiForPeriod,
  MARKET_BENCHMARK,
  getStrategyDescription,
  getTraderEarnings,
  formatUsd,
  compositeScore,
  sortTraders,
  filterTraders,
  searchTraders,
} from './traders';
import { useCopyEligibility } from './CopyEligibilityContext';
import { useFavorites, useFollowing } from './useCopyLists';
import { useFeaturedAvatar } from './FeaturedAvatarContext';
import type { SyntheticCopyTradingResponse } from '../../lib/syntheticCopyTrading';
import { syntheticChartData, syntheticRecentTrades } from '../../lib/syntheticCopyTrading';

// Ported 1:1 from the approved Bolt.new archive's src/App.tsx — same
// components, same markup, same CSS classes. Two kinds of change
// throughout: (1) every read of the archive's hardcoded USER_DEPOSIT/
// COPY_ELIGIBLE constants is now a useCopyEligibility() call against the
// real account deposit (see CopyEligibilityContext.tsx); (2) UI copy is
// translated to Russian per a follow-up request — everything a user reads
// to understand or act on the page, while ROI/VIP, the 7D/30D/90D/1Y/ALL
// period codes, the chart's Trader/BTC/Market legend, and each trader's
// data-driven strategy name stay in English (short trading jargon that's
// standard even on Russian-language exchanges, or literal data). Filter/
// sort values used for matching/sorting logic (English strings compared in
// traders.ts) are untouched — only their displayed labels are translated,
// via the RU maps below. The archive's own <Logo>/<header
// className="topbar">/<footer className="footer"> aren't ported here — the
// real site's Nav/Footer render around this instead (CopyTradingPage.tsx),
// per "don't touch the VOLTEX branding" and "don't break navigation."

const RISK_LABEL_RU: Record<RiskLevel, string> = {
  Low: 'Низкий',
  Moderate: 'Умеренный',
  High: 'Высокий',
  'Very High': 'Очень высокий',
};

const SORT_LABEL_RU: Record<string, string> = {
  'Top Performance': 'Лучшая доходность',
  'Highest ROI': 'Максимальный ROI',
  'Best Win Rate': 'Лучший винрейт',
  'Lowest Drawdown': 'Минимальная просадка',
  'Most Copied': 'Больше всего подписчиков',
  'Largest AUM': 'Крупнейший объём средств',
  'Newest Traders': 'Новые трейдеры',
};

// The four marketplace views. Leaderboard is the curated ranking (top
// strategies by composite score); All Traders is the unranked roster;
// Favorites and Following read the user's own two lists.
type MarketTab = 'leaderboard' | 'all' | 'favorites' | 'following';
const MARKET_TABS: { id: MarketTab; label: string }[] = [
  { id: 'leaderboard', label: 'Лидерборд' },
  { id: 'all', label: 'Все трейдеры' },
  { id: 'favorites', label: 'Избранное' },
  { id: 'following', label: 'Копирую' },
];

const sortOptions = ['Top Performance', 'Highest ROI', 'Best Win Rate', 'Lowest Drawdown', 'Most Copied', 'Largest AUM', 'Newest Traders'];
const performanceFilters = [
  { label: 'Все', value: 'all' },
  { label: 'Положительная', value: 'positive' },
  { label: 'Отрицательная', value: 'negative' },
];
const riskFilters = [
  { label: 'Все', value: 'all' },
  { label: 'Низкий', value: 'Low' },
  { label: 'Умеренный', value: 'Moderate' },
  { label: 'Высокий', value: 'High' },
  { label: 'Очень высокий', value: 'Very High' },
];
const strategyFilters = [
  { label: 'Все', value: 'all' },
  { label: 'Трендовая', value: 'trend' },
  { label: 'Свинг', value: 'swing' },
  { label: 'Квант', value: 'quant' },
  { label: 'Арбитраж', value: 'arbitrage' },
  { label: 'Фьючерсы', value: 'futures' },
  { label: 'Долгосрочная', value: 'long-term' },
  { label: 'Мультиактивная', value: 'multi-asset' },
];
const accountFilters = [
  { label: 'Все', value: 'all' },
  { label: '<$100K', value: '<100k' },
  { label: '$100K-$500K', value: '100k-500k' },
  { label: '$500K-$2M', value: '500k-2m' },
  { label: '$2M+', value: '2m+' },
];
const PAGE_SIZE = 12;

function VipBadge() {
  return <span className="vip-badge"><Crown size={12} /> VIP</span>;
}

/** The featured leader shows the operator's real uploaded profile photo
 * (Settings -> Profile); everyone else, and the featured leader before a
 * photo exists, shows the initials circle. */
function Avatar({ trader, large = false }: { trader: Trader; large?: boolean }) {
  const featuredAvatar = useFeaturedAvatar();
  const photo = trader.id === nazarTrader.id ? featuredAvatar : null;
  const className = `avatar avatar-${trader.tone} ${large ? 'avatar-large' : ''}`;
  if (photo) {
    return <img className={`${className} avatar-photo`} src={photo} alt="" />;
  }
  return <div className={className}>{trader.initials}</div>;
}

function EligibilityGate({ compact = false }: { compact?: boolean }) {
  const { eligible } = useCopyEligibility();
  if (eligible) return null;
  return (
    <div className={`eligibility ${compact ? 'eligibility-compact' : ''}`}>
      <div className="eligibility-icon"><ShieldCheck size={17} /></div>
      <div>
        <strong>{compact ? 'Депозит от $20 000 для копирования' : 'Разблокируйте копитрейдинг'}</strong>
        {!compact && <p>Копитрейдинг доступен только клиентам с депозитом от $20 000.</p>}
      </div>
      {!compact && <button className="button button-outline">Увеличить депозит <ChevronRight size={15} /></button>}
    </div>
  );
}

function PremiumEligibilityBlock({ compact = false }: { compact?: boolean }) {
  const { eligible } = useCopyEligibility();
  if (eligible) return null;
  return (
    <div className={`premium-eligibility ${compact ? 'premium-eligibility-compact' : ''}`}>
      <Lock size={13} className="premium-eligibility-lock" />
      <div>
        <strong>Эксклюзивный доступ</strong>
        <p>Копитрейдинг доступен клиентам с депозитом от $20 000</p>
      </div>
    </div>
  );
}

/** Always rendered, never hidden. Below the $20,000 deposit it is present
 * but disabled and says why; at or above it, it actually starts and stops
 * copying — the Following tab reads the same list. */
function CopyButton({ trader, compact = false }: { trader: Trader; compact?: boolean }) {
  const { eligible } = useCopyEligibility();
  const { following, toggleFollowing } = useFollowing();
  const isFollowing = following.has(trader.id);

  if (!eligible) {
    return (
      <button
        className={`button button-copy ${compact ? 'button-small' : ''}`}
        disabled
        title="Копитрейдинг доступен клиентам с депозитом от $20 000"
      >
        <Lock size={14} /> Депозит от $20 000
      </button>
    );
  }

  return (
    <button
      className={`button button-copy ${isFollowing ? 'button-copy-active' : ''} ${compact ? 'button-small' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        toggleFollowing(trader.id);
        toast.success(
          isFollowing ? `Копирование ${trader.name} остановлено` : `Вы копируете ${trader.name}`,
          { description: isFollowing ? undefined : `Комиссия за результат ${Math.round(trader.performanceFee * 100)}%. Средства остаются на вашем счёте VOLTEX.` }
        );
      }}
    >
      {isFollowing ? <><Check size={14} /> Копируется</> : 'Копировать трейдера'}
    </button>
  );
}

/** The star, wired to the user's favourites list. Stops propagation so it
 * never doubles as a click on the card underneath it. */
function FavoriteButton({ trader, large = false }: { trader: Trader; large?: boolean }) {
  const { favorites, toggleFavorite } = useFavorites();
  const isFavorite = favorites.has(trader.id);
  return (
    <button
      className={`icon-button ${large ? 'large-icon' : ''} ${isFavorite ? 'icon-button-active' : ''}`}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? `Убрать ${trader.name} из избранного` : `Добавить ${trader.name} в избранное`}
      title={isFavorite ? 'В избранном' : 'В избранное'}
      onClick={(event) => {
        event.stopPropagation();
        toggleFavorite(trader.id);
      }}
    >
      <Star size={large ? 18 : 16} fill={isFavorite ? 'currentColor' : 'none'} />
    </button>
  );
}

function followerProfitForPeriod(data: SyntheticCopyTradingResponse | null | undefined, period: Period): number | null {
  if (!data) return null;
  if (period === '7D') return data.analytics.followerPnl7;
  if (period === '30D') return data.analytics.followerPnl30;
  if (period === '90D') return data.analytics.followerPnl90;
  return data.analytics.followerPnl;
}

function TraderCard({ trader, period, onOpen, synthetic }: { trader: Trader; period: Period; onOpen: (trader: Trader) => void; synthetic?: SyntheticCopyTradingResponse | null }) {
  const { following } = useFollowing();
  const periodRoi = getRoiForPeriod(trader, period);
  // Copiers' profit is shown for the SAME period as the ROI above it, and
  // labelled with it — an unlabelled figure can't be checked against
  // anything, and a lifetime figure next to a 30-day ROI reads as if the
  // two belong together when they don't.
  const liveProfit = trader.id === nazarTrader.id ? followerProfitForPeriod(synthetic, period) : null;
  const copierProfit = liveProfit ?? getCopierProfit(trader, period);
  return (
    <article className={`trader-card ${trader.vip ? 'trader-card-vip' : ''}`} onClick={() => onOpen(trader)}>
      <div className="card-topline">
        <div className="avatar-wrap"><Avatar trader={trader} />{trader.verified && <span className="verified-dot"><Check size={9} /></span>}</div>
        <div className="card-topline-right">
          {following.has(trader.id) && <span className="following-pill"><Check size={10} /> Копируется</span>}
          <FavoriteButton trader={trader} />
        </div>
      </div>
      <div className="trader-name-row">
        <div><h3>{trader.name}</h3><p>{trader.strategy} <span className="dot-separator" /> {trader.region}</p></div>
        {trader.vip && <VipBadge />}
      </div>
      <div className="card-return">
        <span>{PERIOD_LABEL_RU[period]} ROI</span>
        <strong className={roiClass(periodRoi)}>{formatPercent(periodRoi)}</strong>
        <div className="mini-chart"><i /><i /><i /><i /><i /></div>
      </div>
      <div className="card-stats">
        <div><span>Винрейт</span><strong>{trader.winRate}%</strong></div>
        <div><span>Просадка</span><strong>{trader.drawdown}%</strong></div>
        <div><span>Подписчиков</span><strong>{trader.copiers.toLocaleString('ru-RU')}</strong></div>
      </div>
      <div className="card-meta">
        <div><span>Прибыль подписчиков · {PERIOD_LABEL_RU[period]}</span><b className={roiClass(copierProfit)}>{formatAccountSize(copierProfit)}</b></div>
        <div><span>Средства в копировании</span><b>{formatAccountSize(trader.aum)}</b></div>
      </div>
      <div className="card-footer-row">
        <span className={`risk risk-${trader.risk.toLowerCase().replace(' ', '-')}`}>{RISK_LABEL_RU[trader.risk]} риск</span>
        <span className="card-id">{Math.round(trader.performanceFee * 100)}% комиссия</span>
      </div>
      <div className="card-cta-area">
        <button className="card-view-button" onClick={(event) => { event.stopPropagation(); onOpen(trader); }}>Профиль трейдера</button>
        <CopyButton trader={trader} compact />
      </div>
    </article>
  );
}

function PerformanceOverview({ trader }: { trader: Trader }) {
  return (
    <section className="overview-grid">
      <div className="overview-intro">
        <span className="eyebrow">Обзор доходности <span className="live-dot" /> Live</span>
        <h2>{trader.strategy}.<br /><em>Контролируемый риск.</em></h2>
        <p>{getStrategyDescription(trader)}</p>
      </div>
      {/* Straight from the trader record, including the all-time figure —
          it used to be a literal 1240 for any VIP, which disagreed with the
          same trader's own roiAll everywhere else on the page. The "vs
          market" line is now a real subtraction rather than a fixed string
          repeated on every card. */}
      {PERIODS.map((period) => {
        const roi = getRoiForPeriod(trader, period);
        const vsMarket = roi - MARKET_BENCHMARK[period];
        return (
          <div key={period} className={`metric-card ${period === 'ALL' ? 'metric-alltime' : ''}`}>
            <span>{PERIOD_LABEL_RU[period]} ROI</span>
            <strong className={roiClass(roi)}>{formatPercent(roi)}</strong>
            <small>против рынка {formatPercent(vsMarket)}</small>
          </div>
        );
      })}
    </section>
  );
}

function PerformanceChart({ trader, synthetic }: { trader: Trader; synthetic?: SyntheticCopyTradingResponse | null }) {
  const [activeTab, setActiveTab] = useState<Period>('90D');
  const [comparison, setComparison] = useState('Trader');
  const chart = useMemo(
    () => synthetic && trader.id === nazarTrader.id ? syntheticChartData(synthetic, activeTab) : getChartData(trader, activeTab),
    [trader, activeTab, synthetic]
  );
  const showMarket = comparison === 'Market' || comparison === 'Trader';
  const showBtc = comparison === 'BTC' || comparison === 'Trader';
  return (
    <section className="panel chart-panel">
      <div className="panel-header">
        <div><span className="eyebrow">Доходность</span><h2>Рост $10,000</h2></div>
        <div className="chart-tools">
          <div className="tab-group">{PERIODS.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab === 'ALL' ? 'ALL' : PERIOD_LABEL_RU[tab]}</button>)}</div>
          <div className="comparison-group">{['Trader', 'BTC', 'Market'].map((item) => <button key={item} className={comparison === item ? 'active' : ''} onClick={() => setComparison(item)}><i className={`legend-${item.toLowerCase()}`} />{item}</button>)}</div>
        </div>
      </div>
      <div className="chart-wrap">
        <div className="chart-y">{chart.yLabels.map((label) => <span key={label}>{label}</span>)}</div>
        <svg viewBox="0 0 900 280" preserveAspectRatio="none" className="performance-svg" role="img" aria-label="Upward performance chart">
          <defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#d99b4a" stopOpacity=".18" /><stop offset="100%" stopColor="#d99b4a" stopOpacity="0" /></linearGradient></defs>
          <path className="chart-grid" d="M0 30H900M0 100H900M0 170H900M0 240H900" />
          <path className="chart-area" d={chart.areaPath} />
          {showMarket && <path className="chart-line chart-market" d={chart.marketPath} />}
          {showBtc && <path className="chart-line chart-btc" d={chart.btcPath} />}
          <path className="chart-line" d={chart.linePath} />
          <circle cx="900" cy={chart.endY.toFixed(1)} r="5" className="chart-point" />
        </svg>
        <div className="chart-x">{chart.xLabels.map((label, i) => <span key={`${label}-${i}`}>{label}</span>)}</div>
      </div>
      <div className="chart-note">
        <span><span className="live-dot" /> Данные обновляются раз в 24 часа</span>
        <span>Прошлые результаты не гарантируют будущую доходность.</span>
      </div>
    </section>
  );
}

function RiskMetrics({ trader, synthetic }: { trader: Trader; synthetic?: SyntheticCopyTradingResponse | null }) {
  const data = generateProfileData(trader);
  const live = trader.id === nazarTrader.id ? synthetic?.analytics : null;
  const returnToRisk = trader.drawdown > 0 ? trader.roi90 / trader.drawdown : trader.roi90;
  const metrics: [string, string, string?][] = [
    ['Максимальная просадка', `${trader.drawdown.toFixed(1)}%`],
    ['Винрейт', `${trader.winRate}%`],
    ['Профит-фактор', live ? live.profitFactor.toFixed(2) : data.profitFactor],
    ['Уровень риска', RISK_LABEL_RU[trader.risk], trader.risk.toLowerCase().replace(' ', '-')],
    ['Среднее время сделки', live ? `${Math.round(live.averageHoldingTimeMinutes)} мин` : data.holdingTime],
    ['Доходность/риск', `${returnToRisk.toFixed(1)}x`],
    ['Рейтинг стратегии', compositeScore(trader).toFixed(1)],
    ['Средства под управлением', formatAccountSize(trader.aum)],
    ['Стаж на платформе', `${trader.activeMonths} мес.`],
  ];
  return (
    <section className="panel risk-panel">
      <div className="panel-header">
        <div><span className="eyebrow">Управление риском</span><h2>Риск-метрики</h2></div>
        <span className="controlled-badge"><ShieldCheck size={14} /> Контролируемый риск</span>
      </div>
      <div className="risk-grid">
        {metrics.map(([label, value, riskKey], index) => (
          <div className="risk-metric" key={label}>
            <span>{label}</span>
            <strong className={riskKey ? `risk-${riskKey}` : ''}>{value}</strong>
            {index === 0 && <div className="risk-track"><i style={{ width: `${Math.min(100, trader.drawdown * 3)}%` }} /></div>}
          </div>
        ))}
      </div>
    </section>
  );
}

function TradingStatistics({ trader, synthetic }: { trader: Trader; synthetic?: SyntheticCopyTradingResponse | null }) {
  const data = generateProfileData(trader);
  const live = trader.id === nazarTrader.id ? synthetic?.analytics : null;
  const rows: [string, string][] = [
    ['Всего сделок', String(live?.totalTrades ?? data.totalTrades)],
    ['Прибыльных сделок · 90Д', String(live?.winningTrades ?? data.winningTrades)],
    ['Убыточных сделок · 90Д', String(live?.losingTrades ?? data.losingTrades)],
    ['Ожидание на сделку', live ? `${live.expectancy.toLocaleString('ru-RU')} USDT` : data.avgProfit],
    ['Профит-фактор', live ? live.profitFactor.toFixed(2) : data.profitFactor],
    ['P/L в R', live ? `${live.plRatio.toFixed(2)} : 1` : '—'],
    ['Sharpe / Sortino', live ? `${live.sharpe.toFixed(2)} / ${live.sortino.toFixed(2)}` : '—'],
    ['Волатильность · годовая', live ? `${live.annualizedVolatility.toFixed(1)}%` : '—'],
    ['Сделок за 7Д / 30Д', live ? `${live.tradesLast7D} / ${live.tradesLast30D}` : '—'],
    ['Среднее время удержания', live ? `${Math.round(live.averageHoldingTimeMinutes)} мин` : data.holdingTime],
    ['Объём торгов · 90Д', live ? formatAccountSize(live.tradingVolume) : data.volume],
  ];
  return (
    <section className="panel">
      <div className="panel-header">
        <div><h2>Торговая статистика</h2></div>
        <BarChart3 size={20} className="panel-icon" />
      </div>
      <div className="stat-rows">
        {rows.map(([label, value]) => (
          <div key={label}><span>{label}</span><strong className={value.startsWith('+') ? 'positive' : value.startsWith('-') ? 'negative' : ''}>{value}</strong></div>
        ))}
      </div>
    </section>
  );
}

function RecentTrades({ trader, synthetic }: { trader: Trader; synthetic?: SyntheticCopyTradingResponse | null }) {
  const trades = useMemo(
    () => synthetic && trader.id === nazarTrader.id ? syntheticRecentTrades(synthetic) : generateTrades(trader),
    [trader, synthetic]
  );
  return (
    <section className="panel trades-panel">
      <div className="panel-header">
        <div><span className="eyebrow">Журнал сделок</span><h2>Последние сделки</h2></div>
        <button className="text-button">Все сделки <ChevronRight size={15} /></button>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>{['Актив', 'Направление', 'Вход', 'Выход', 'PnL', 'ROI', 'Открыта', 'Закрыта'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {trades.map((trade, i) => (
              <tr key={`${trade.asset}-${trade.date}-${i}`}>
                <td><strong>{trade.asset}</strong></td>
                <td><span className={`direction ${trade.side === 'Long' ? 'direction-long' : 'direction-short'}`}>{trade.side === 'Long' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{trade.side === 'Long' ? 'Лонг' : 'Шорт'}</span></td>
                <td>{trade.entry}</td><td>{trade.exit}</td>
                <td className={trade.positive ? 'positive' : 'negative'}>{trade.pnl}</td>
                <td className={trade.positive ? 'positive' : 'negative'}>{trade.roi}</td>
                <td>{(trade as typeof trade & { openedAt?: string }).openedAt ?? trade.duration}</td><td>{(trade as typeof trade & { closedAt?: string }).closedAt ?? trade.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PerformanceEarnings({ trader, synthetic }: { trader: Trader; synthetic?: SyntheticCopyTradingResponse | null }) {
  const data = generateProfileData(trader);
  const feePct = Math.round(trader.performanceFee * 100);
  const live = trader.id === nazarTrader.id ? synthetic?.analytics : null;
  const lifetimeProfit = live?.followerPnl ?? getLifetimeCopierProfit(trader);
  const lifetimeEarnings = live ? Math.max(0, lifetimeProfit) * trader.performanceFee : getLifetimeTraderEarnings(trader);
  const isNazar = trader.id === nazarTrader.id;

  return (
    <section className="panel earnings-panel">
      <div className="panel-header">
        <div><span className="eyebrow">Результаты и вознаграждение</span><h2>Доходность и заработок</h2></div>
        <WalletCards size={20} className="panel-icon" />
      </div>

      {/* The ROI ladder: every period in one row, so they can be compared
          rather than paged through. Percentages only — the per-period
          copier-profit line that used to sit under each one put the 90-day
          and all-time totals next to each other, which reads as an error
          (see the featured card's comment for why they are that close). */}
      <div className="earnings-periods">
        {PERIODS.map((period) => {
          const roi = getRoiForPeriod(trader, period);
          return (
            <div key={period}>
              <span>ROI · {PERIOD_LABEL_RU[period]}</span>
              <strong className={roiClass(roi)}>{formatPercent(roi)}</strong>
            </div>
          );
        })}
      </div>

      <div className="earnings-grid">
        <div className="earnings-lead">
          <span>Средства под управлением</span>
          <strong>{formatUsd(trader.aum)} USDT</strong>
          <small>Средства клиентов, копирующих стратегию прямо сейчас</small>
        </div>
        <div className="earnings-lead">
          <span>Прибыль подписчиков за всё время</span>
          <strong className={roiClass(lifetimeProfit)}>{formatUsd(lifetimeProfit)} USDT</strong>
          <small>За {trader.activeMonths} мес. работы стратегии</small>
        </div>
      </div>

      <div className="earnings-row">
        <div><span>Комиссия за результат</span><strong>{feePct}%</strong></div>
        <div className="earnings-arrow"><ChevronRight size={18} /></div>
        <div><span>Заработок {trader.name} за всё время</span><strong className={roiClass(lifetimeEarnings)}>{formatUsd(lifetimeEarnings)} USDT</strong></div>
      </div>
      <div className="earnings-calc">
        <span>Расчёт</span>
        <code>
          {lifetimeProfit > 0
            ? `${formatUsd(lifetimeProfit)} × ${feePct}% = ${formatUsd(lifetimeEarnings)} USDT`
            : 'Комиссия за результат не начисляется при отрицательном результате'}
        </code>
      </div>

      <div className="earnings-detail-grid">
        <div><span>Подписчиков</span><strong>{trader.copiers.toLocaleString('ru-RU')}</strong></div>
        <div><span>Винрейт</span><strong>{trader.winRate}%</strong></div>
        <div><span>Макс. просадка</span><strong>{trader.drawdown}%</strong></div>
        <div><span>Сделок</span><strong>{(live?.totalTrades ?? data.totalTrades).toLocaleString('ru-RU')}</strong></div>
        <div><span>Прибыльных · 90Д</span><strong className="positive">{(live?.winningTrades ?? data.winningTrades).toLocaleString('ru-RU')}</strong></div>
        <div><span>Убыточных · 90Д</span><strong className="negative">{(live?.losingTrades ?? data.losingTrades).toLocaleString('ru-RU')}</strong></div>
        <div><span>Ожидание</span><strong className="positive">{live ? `${live.expectancy.toLocaleString('ru-RU')} USDT` : data.avgProfit}</strong></div>
        <div><span>Профит-фактор</span><strong>{live ? live.profitFactor.toFixed(2) : data.profitFactor}</strong></div>
        <div><span>Уровень риска</span><strong>{RISK_LABEL_RU[trader.risk]}</strong></div>
        <div><span>Среднее время сделки</span><strong>{live ? `${Math.round(live.averageHoldingTimeMinutes)} мин` : data.holdingTime}</strong></div>
        <div><span>История</span><strong>{trader.activeMonths} мес.</strong></div>
      </div>

      {isNazar && (
        // The one place the model is spelled out. AUM is lower than the
        // profit generated because copiers have taken part of it off the
        // table — stating that is what keeps the two figures from looking
        // like they contradict each other.
        <div className="earnings-reconcile">
          <div><span>Активно распределено</span><strong>{formatAccountSize(live?.aum ?? nazarEconomics.principal)}</strong></div>
          <div><span>Результат подписчиков</span><strong className="positive">{formatAccountSize(live?.followerPnl ?? nazarEconomics.lifetimeProfit)}</strong></div>
          <div><span>Активных подписчиков</span><strong>{live?.activeFollowers ?? trader.copiers}</strong></div>
          <div><span>Под управлением сейчас</span><strong>{formatAccountSize(live?.aum ?? nazarEconomics.aum)}</strong></div>
        </div>
      )}

      <p className="earnings-note">{feePct}% от прибыли, полученной подписчиками. Средства остаются на счетах подписчиков в VOLTEX.</p>
    </section>
  );
}

function Copiers({ trader, synthetic }: { trader: Trader; synthetic?: SyntheticCopyTradingResponse | null }) {
  const data = generateProfileData(trader);
  const live = trader.id === nazarTrader.id ? synthetic : null;
  const newThisWeek = live?.followers.filter((follower) => Date.parse(follower.copyStartDate) >= Date.parse(live.simulation.simulatedAt) - 7 * 86_400_000).length;
  const averageDeposit = live ? live.analytics.aum / Math.max(1, live.analytics.activeFollowers) : data.avgCopierDeposit;
  return (
    <section className="panel copiers-panel">
      <div className="panel-header">
        <div><span className="eyebrow">Общие интересы</span><h2>Подписчики</h2></div>
        <Users size={20} className="panel-icon" />
      </div>
      <div className="copier-grid">
        <div className="copier-lead"><strong>{trader.copiers}</strong><span>Активных подписчиков</span><div className="copier-avatars"><span>J</span><span>K</span><span>R</span><span>+</span></div></div>
        <div><span>Всего подписчиков</span><strong>{trader.copiers}</strong></div>
        <div><span>Новых за неделю</span><strong className="positive">+{newThisWeek ?? data.newThisWeek}</strong></div>
        <div><span>Средний депозит подписчика</span><strong>${Math.round(averageDeposit).toLocaleString()}</strong></div>
        <div><span>Результат подписчиков</span><strong>{live ? formatUsd(live.analytics.followerPnl) : `$${data.totalCopiedVolume}M`}</strong></div>
      </div>
      <div className="info-note"><CircleHelp size={14} /> Активность подписчиков обновляется в реальном времени при открытии и закрытии позиций.</div>
    </section>
  );
}

function allTimeAumPath(history: SyntheticCopyTradingResponse['aumHistory']): string {
  if (!history.length) return '';
  const values = history.map((point) => point.aum);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  return history.map((point, index) => {
    const x = history.length === 1 ? 900 : index / (history.length - 1) * 900;
    const y = 125 - (point.aum - min) / range * 105;
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

function SinceInception({ trader, synthetic }: { trader: Trader; synthetic?: SyntheticCopyTradingResponse | null }) {
  if (trader.id !== nazarTrader.id || !synthetic) return null;
  const all = synthetic.analytics.allTime;
  const rows: [string, string][] = [
    ['All-Time ROI', formatPercent(all.roi)],
    ['All-Time PnL', `${formatUsd(all.pnl)} USDT`],
    ['Всего сделок', all.totalTrades.toLocaleString('ru-RU')],
    ['Прибыльных сделок', all.winningTrades.toLocaleString('ru-RU')],
    ['Убыточных сделок', all.losingTrades.toLocaleString('ru-RU')],
    ['All-Time Win Rate', `${all.winRate.toFixed(3)}%`],
    ['All-Time Max Drawdown', `${all.maximumDrawdown.toFixed(3)}%`],
    ['All-Time Profit Factor', all.profitFactor.toFixed(4)],
    ['All-Time Sharpe', all.sharpe.toFixed(4)],
    ['All-Time Sortino', all.sortino.toFixed(4)],
    ['Торговых дней', all.tradingDays.toLocaleString('ru-RU')],
    ['Средняя сделка', `${formatUsd(all.averageTrade)} USDT`],
    ['PnL подписчиков', `${formatUsd(all.followersPnl)} USDT`],
    ['AUM', `${formatUsd(all.aum)} USDT`],
  ];
  const first = synthetic.aumHistory[0];
  const last = synthetic.aumHistory[synthetic.aumHistory.length - 1];
  return (
    <section className="panel all-time-panel">
      <div className="panel-header">
        <div><span className="eyebrow">ALL · SINCE INCEPTION</span><h2>Результат за всё время</h2></div>
        <LineChart size={20} className="panel-icon" />
      </div>
      <div className="stat-rows all-time-grid">
        {rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <div className="all-time-aum">
        <div><span>All-Time AUM history</span><strong>{formatAccountSize(last?.aum ?? 0)}</strong></div>
        <svg viewBox="0 0 900 145" preserveAspectRatio="none" role="img" aria-label="AUM since inception">
          <path d="M0 125H900" className="chart-grid" />
          <path d={allTimeAumPath(synthetic.aumHistory)} className="chart-line" />
        </svg>
        <div className="all-time-aum-dates"><span>{first?.date}</span><span>{last?.date}</span></div>
      </div>
    </section>
  );
}

export function Profile({ trader, onBack, synthetic }: { trader: Trader; onBack: () => void; synthetic?: SyntheticCopyTradingResponse | null }) {
  return (
    <main className="page-shell profile-page">
      <button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Назад к копитрейдингу</button>
      <section className="profile-hero">
        <div className="profile-identity">
          <div className="profile-avatar-wrap"><Avatar trader={trader} large /><span className="profile-verified"><Check size={11} /></span></div>
          <div>
            <div className="profile-title-row"><h1>{trader.name}</h1>{trader.vip && <VipBadge />}</div>
            <p>{trader.strategy} <span className="dot-separator" /> <ShieldCheck size={13} /> Подтверждённая история <span className="dot-separator" /> {trader.id}</p>
            <div className="profile-meta">
              <span><Users size={15} /> {trader.copiers} подписчиков</span>
              <span><Clock3 size={15} /> Активен {trader.activeMonths} мес.</span>
              <span><Zap size={15} /> {RISK_LABEL_RU[trader.risk]} риск</span>
              <span><WalletCards size={15} /> {formatAccountSize(trader.aum)} под управлением</span>
            </div>
          </div>
        </div>
        <div className="profile-actions">
          <FavoriteButton trader={trader} large />
          <div className="profile-cta-area">
            <PremiumEligibilityBlock />
            <CopyButton trader={trader} />
          </div>
        </div>
      </section>
      <PerformanceOverview trader={trader} />
      <PerformanceChart trader={trader} synthetic={synthetic} />
      <SinceInception trader={trader} synthetic={synthetic} />
      <PerformanceEarnings trader={trader} synthetic={synthetic} />
      <div className="two-column"><RiskMetrics trader={trader} synthetic={synthetic} /><TradingStatistics trader={trader} synthetic={synthetic} /></div>
      <RecentTrades trader={trader} synthetic={synthetic} />
      <Copiers trader={trader} synthetic={synthetic} />
      <EligibilityGate />
    </main>
  );
}

function FilterDropdown({ label, options, value, onChange }: { label: string; options: { label: string; value: string }[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value)?.label ?? label;
  return (
    <div className={`filter-button ${open ? 'filter-button-open' : ''}`} onClick={() => setOpen(!open)} onBlur={() => setTimeout(() => setOpen(false), 150)} tabIndex={0}>
      <span className="filter-button-label">{label}: <b>{selected}</b></span>
      <ChevronDown size={13} className={open ? 'chevron-up' : ''} />
      {open && (
        <div className="filter-dropdown" onClick={(e) => e.stopPropagation()}>
          {options.map((opt) => <button key={opt.value} className={value === opt.value ? 'active' : ''} onClick={() => { onChange(opt.value); setOpen(false); }}>{opt.label}{value === opt.value && <Check size={13} />}</button>)}
        </div>
      )}
    </div>
  );
}

export function Marketplace({ onOpen, nazara = nazarTrader, synthetic }: { onOpen: (trader: Trader) => void; nazara?: Trader; synthetic?: SyntheticCopyTradingResponse | null }) {
  const { depositUsd, eligible } = useCopyEligibility();
  const { favorites } = useFavorites();
  const { following } = useFollowing();
  const [tab, setTab] = useState<MarketTab>('leaderboard');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('Top Performance');
  const [sortOpen, setSortOpen] = useState(false);
  const [period, setPeriod] = useState<Period>('90D');
  const [filters, setFilters] = useState({ performance: 'all', risk: 'all', strategy: 'all', account: 'all' });
  const [page, setPage] = useState(1);

  // Which roster each tab draws from. Leaderboard is the curated ranking
  // and so excludes Nazar (he has his own featured slot directly above the
  // grid — listing him twice on the same screen would be a duplicate);
  // every other tab searches the full roster including him, which is what
  // makes searching for "Nazar" or starring him actually work.
  const dynamicRoster = useMemo(() => [nazara, ...marketplaceTraders], [nazara]);
  const tabRoster = useMemo(() => {
    switch (tab) {
      case 'favorites': return dynamicRoster.filter((t) => favorites.has(t.id));
      case 'following': return dynamicRoster.filter((t) => following.has(t.id));
      case 'all': return dynamicRoster;
      default: return marketplaceTraders;
    }
  }, [tab, favorites, following, dynamicRoster]);

  const visibleTraders = useMemo(() => {
    let result = searchTraders(tabRoster, query);
    result = filterTraders(result, filters);
    result = sortTraders(result, sortBy, period);
    return result;
  }, [tabRoster, query, filters, sortBy, period]);

  const totalPages = Math.max(1, Math.ceil(visibleTraders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageTraders = visibleTraders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const startIdx = visibleTraders.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(currentPage * PAGE_SIZE, visibleTraders.length);

  useEffect(() => { setPage(1); }, [tab, query, filters, sortBy, period]);

  // The featured slot always shows Nazar first, so explain why rather than
  // just placing him there: verify against the actual roster instead of
  // asserting it, so the claim stays true if the data ever changes.
  const isTopPerformer = marketplaceTraders.every((t) => nazara.roi90 >= t.roi90);
  const hasActiveFilters = filters.performance !== 'all' || filters.risk !== 'all' || filters.strategy !== 'all' || filters.account !== 'all';

  return (
    <main className="page-shell">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Маркетплейс <span className="live-dot" /> Live</span>
          <h1>Копитрейдинг</h1>
          <p>Следите за опытными трейдерами и копируйте их стратегии с институциональным контролем рисков.</p>
        </div>
        <div className="deposit-status">
          <WalletCards size={17} />
          <div><span>Ваш депозит</span><strong>${depositUsd.toLocaleString()}.00</strong></div>
          <span className="status-pill">{eligible ? 'Есть доступ' : 'Нет доступа'}</span>
        </div>
      </section>

      <div className="market-tabs" role="tablist">
        {MARKET_TABS.map((t) => {
          const count = t.id === 'favorites' ? favorites.size : t.id === 'following' ? following.size : null;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {count !== null && <span className="market-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="market-nav">
        <div className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск трейдеров..." /><kbd>/</kbd></div>
        <div className="sort-wrapper">
          <div className={`sort-button ${sortOpen ? 'sort-open' : ''}`} onClick={() => setSortOpen(!sortOpen)} onBlur={() => setTimeout(() => setSortOpen(false), 150)} tabIndex={0}>
            <span>Сортировка: <b>{SORT_LABEL_RU[sortBy] ?? sortBy}</b></span><ChevronDown size={14} className={sortOpen ? 'chevron-up' : ''} />
            {sortOpen && (
              <div className="filter-dropdown sort-dropdown" onClick={(e) => e.stopPropagation()}>
                {sortOptions.map((opt) => <button key={opt} className={sortBy === opt ? 'active' : ''} onClick={() => { setSortBy(opt); setSortOpen(false); }}>{SORT_LABEL_RU[opt] ?? opt}{sortBy === opt && <Check size={13} />}</button>)}
              </div>
            )}
          </div>
          <div className="period-group">{PERIODS.map((p) => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{PERIOD_LABEL_RU[p]}</button>)}</div>
        </div>
      </div>

      <div className="filter-row">
        <div className="filter-label"><SlidersHorizontal size={15} /> Фильтры</div>
        <FilterDropdown label="Доходность" options={performanceFilters} value={filters.performance} onChange={(v) => setFilters({ ...filters, performance: v })} />
        <FilterDropdown label="Риск" options={riskFilters} value={filters.risk} onChange={(v) => setFilters({ ...filters, risk: v })} />
        <FilterDropdown label="Стратегия" options={strategyFilters} value={filters.strategy} onChange={(v) => setFilters({ ...filters, strategy: v })} />
        <FilterDropdown label="Размер счёта" options={accountFilters} value={filters.account} onChange={(v) => setFilters({ ...filters, account: v })} />
        {hasActiveFilters && (
          <button className="filter-clear" onClick={() => setFilters({ performance: 'all', risk: 'all', strategy: 'all', account: 'all' })}>Сбросить</button>
        )}
      </div>

      <EligibilityGate />

      {tab === 'leaderboard' && (
      <section className="featured-section">
        <div className="section-title">
          <div><span className="eyebrow">{isTopPerformer ? 'Топ-1 по прибыли подписчиков' : 'Рекомендуемая стратегия'}</span><h2>{nazara.name} <VipBadge /></h2></div>
          <button className="text-button" onClick={() => onOpen(nazara)}>Профиль трейдера <ChevronRight size={15} /></button>
        </div>
        <div className="featured-card" onClick={() => onOpen(nazara)}>
          <div className="featured-copy">
            <div className="featured-person">
              <div className="profile-avatar-wrap"><Avatar trader={nazara} large /><span className="profile-verified"><Check size={11} /></span></div>
              <div>
                <div className="profile-title-row"><h3>{nazara.name}</h3><VipBadge /></div>
                <p>{nazara.strategy} <span className="dot-separator" /> {nazara.id}</p>
              </div>
            </div>
            <p className="featured-description">{getStrategyDescription(nazara)}</p>
            <div className="featured-footer">
              <span><Users size={15} /> {nazara.copiers} подписчиков</span>
              <span><ShieldCheck size={15} /> {RISK_LABEL_RU[nazara.risk]} риск</span>
              <span><LineChart size={15} /> {nazara.activeMonths} мес. истории</span>
              <span><WalletCards size={15} /> {formatAccountSize(nazara.aum)} под управлением</span>
            </div>
          </div>
          <div className="featured-performance">
            <div><span>7Д</span><strong className="positive">{formatPercent(nazara.roi7)}</strong></div>
            <div><span>30Д</span><strong className="positive">{formatPercent(nazara.roi30)}</strong></div>
            <div><span>90Д</span><strong className="positive">{formatPercent(nazara.roi90)}</strong></div>
            <div><span>Всё время</span><strong className="positive">{formatPercent(nazara.roiAll)}</strong></div>
            <div><span>Винрейт</span><strong>{nazara.winRate}%</strong></div>
            <div><span>Макс. просадка</span><strong>{nazara.drawdown}%</strong></div>
          </div>
          {/* One period's figure, not two. A 90-day and an all-time total
              side by side ($7.4M and $7.7M) read as a mistake, even though
              they are correct: +841% in 90 days out of +3741% in a year
              means the last quarter multiplied capital ~9.4x, so almost
              every copier earned most of their profit inside it. The
              lifetime total still has its own place in the profile, where
              nothing invites the comparison. */}
          <div className="featured-copier-profit">
            <span>Прибыль подписчиков · {PERIOD_LABEL_RU[period]}</span>
            <strong>{formatUsd(followerProfitForPeriod(synthetic, period) ?? getCopierProfit(nazara, period))} USDT</strong>
          </div>
          <div className="featured-action"><PremiumEligibilityBlock compact /><CopyButton trader={nazara} /></div>
        </div>
      </section>
      )}

      <section className="marketplace-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">{MARKET_TABS.find((t) => t.id === tab)?.label}</span>
            <h2>{tab === 'favorites' ? 'Избранные трейдеры' : tab === 'following' ? 'Вы копируете' : 'Профессиональные трейдеры'}</h2>
          </div>
          <span className="results-count">Трейдеров: {visibleTraders.length}</span>
        </div>
        <div className="trader-grid">
          {pageTraders.map((trader) => <TraderCard key={trader.id} trader={trader} period={period} onOpen={onOpen} synthetic={synthetic} />)}
        </div>
        {visibleTraders.length === 0 && (
          <div className="empty-state">
            {tab === 'favorites' && favorites.size === 0 && !query && !hasActiveFilters ? (
              <><Star size={22} /><strong>Избранное пусто</strong><span>Нажмите на звёздочку в карточке трейдера, чтобы сохранить его здесь.</span></>
            ) : tab === 'following' && following.size === 0 && !query && !hasActiveFilters ? (
              <><Users size={22} /><strong>Вы пока никого не копируете</strong><span>{eligible ? 'Откройте профиль трейдера и нажмите «Копировать трейдера».' : 'Копирование доступно клиентам с депозитом от $20 000.'}</span></>
            ) : (
              <><Search size={22} /><strong>Трейдеры не найдены</strong><span>Измените параметры поиска или фильтры.</span></>
            )}
          </div>
        )}
        {visibleTraders.length > 0 && (
          <div className="pagination">
            <span className="pagination-info">Показано {startIdx}–{endIdx} из {visibleTraders.length} трейдеров</span>
            <div className="pagination-controls">
              <button className="page-button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /> Назад</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => <button key={p} className={`page-number ${p === currentPage ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>)}
              <button className="page-button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Далее <ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
