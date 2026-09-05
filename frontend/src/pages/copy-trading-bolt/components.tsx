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
  Crown,
  LineChart,
  Lock,
  Search,
  ShieldCheck,
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
  formatPercent,
  roiClass,
  formatAccountSize,
  generateProfileData,
  generateTrades,
  getChartData,
  getCopierProfit,
  getLifetimeCopierProfit,
  getRoiForPeriod,
  getTraderEarnings,
  formatUsd,
  compositeScore,
  sortTraders,
  searchTraders,
} from './traders';
import { useCopyEligibility } from './CopyEligibilityContext';
import { useFavorites, useFollowing } from './useCopyLists';
import { useFeaturedAvatar } from './FeaturedAvatarContext';
import type { SyntheticCopyTradingResponse, SyntheticPeriodAnalytics } from '../../lib/syntheticCopyTrading';
import { formatSyntheticHistoryDate, selectSyntheticPeriod, syntheticAumMilestones, syntheticChartData, syntheticMainMarkets } from '../../lib/syntheticCopyTrading';
import { dailyPnlChart } from '../../lib/dailyPnlChart';

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
  'Top Performance': 'Популярное',
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
const PAGE_SIZE = 16;

const RANKING_FILTERS = [
  { label: 'Лучший баланс', sort: 'Top Performance' },
  { label: 'Максимальный ROI', sort: 'Highest ROI' },
  { label: 'Лучшие внутридневные трейдеры', sort: 'Best Win Rate' },
  { label: 'Лучшие новые трейдеры', sort: 'Newest Traders' },
  { label: 'Наибольшая прибыль подписчиков', sort: 'Most Copied' },
  { label: 'Самая низкая просадка', sort: 'Lowest Drawdown' },
] as const;

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
  return data.analytics.allTime.followersPnl;
}

function MiniPerformanceChart({ trader, period, synthetic }: { trader: Trader; period: Period; synthetic?: SyntheticCopyTradingResponse | null }) {
  const chart = useMemo(
    () => synthetic && trader.id === nazarTrader.id ? syntheticChartData(synthetic, period) : getChartData(trader, period),
    [trader, period, synthetic]
  );
  const roi = getRoiForPeriod(trader, period);
  const lineColor = roi < 0 ? '#f6465d' : '#19b979';
  const gradientId = `mini-area-${trader.id.replace(/[^a-z0-9]/gi, '')}-${period}`;
  return (
    <svg className={`mini-performance-chart ${roi < 0 ? 'negative' : 'positive'}`} viewBox="0 0 900 280" preserveAspectRatio="none" role="img" aria-label={`${trader.name} ${period} ROI chart`}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity=".3" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="mini-chart-guide" d="M0 238H900" />
      <path className="mini-chart-area" d={chart.areaPath} fill={`url(#${gradientId})`} />
      <path className="mini-chart-line" d={chart.linePath} />
    </svg>
  );
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
  const liveSharpe = trader.id === nazarTrader.id ? synthetic?.analytics.sharpe : null;
  const sharpe = liveSharpe ?? Math.max(0.1, Math.min(9.99, trader.roi90 / Math.max(1, trader.drawdown) / 10));
  return (
    <article className={`trader-card ${trader.vip ? 'trader-card-vip' : ''}`} onClick={() => onOpen(trader)}>
      <div className="card-topline">
        <div className="card-identity">
          <div className="avatar-wrap"><Avatar trader={trader} />{trader.verified && <span className="verified-dot"><Check size={9} /></span>}</div>
          <div className="trader-name-row">
            <div><h3>{trader.name}</h3><p><Users size={11} /> {trader.copiers.toLocaleString('ru-RU')} подписчиков</p></div>
            {trader.vip && <VipBadge />}
          </div>
        </div>
        <div className="card-topline-right">
          {following.has(trader.id) && <span className="following-pill"><Check size={10} /> Копируется</span>}
          <FavoriteButton trader={trader} />
        </div>
      </div>
      <div className="card-return">
        <div className="card-roi-copy">
          <span>ROI <small>{period}</small></span>
          <strong className={roiClass(periodRoi)}>{formatPercent(periodRoi)}</strong>
        </div>
        <MiniPerformanceChart trader={trader} period={period} synthetic={synthetic} />
      </div>
      <div className="card-stats">
        <div><span>Просадка</span><strong>{trader.drawdown}%</strong></div>
        <div><span>Коэффициент Шарпа</span><strong className={roiClass(sharpe)}>{sharpe >= 0 ? '+' : ''}{sharpe.toFixed(2)}</strong></div>
      </div>
      <div className="card-meta">
        <div><span>Прибыль подписчиков · {PERIOD_LABEL_RU[period]}</span><b className={roiClass(copierProfit)}>{formatAccountSize(copierProfit)}</b></div>
        <div><span>AUM</span><b>{formatAccountSize(trader.aum)}</b></div>
      </div>
      <div className="card-cta-area">
        <button className="card-view-button" onClick={(event) => { event.stopPropagation(); onOpen(trader); }}>Профиль трейдера <ChevronRight size={13} /></button>
        <CopyButton trader={trader} compact />
      </div>
    </article>
  );
}

type ProfileTab = 'statistics' | 'trades';
type ProfileChartMode = 'ROI' | 'PnL';

type ProfileMetrics = Pick<SyntheticPeriodAnalytics,
  'roi' | 'pnl' | 'winRate' | 'maximumDrawdown' | 'averagePnl' | 'profitFactor' |
  'averageTradesPerWeek' | 'averageHoldingTimeMinutes' | 'annualizedVolatility' |
  'sharpe' | 'sortino' | 'totalTrades' | 'winningTrades' | 'losingTrades' |
  'tradingDays' | 'followerPnl'>;

function durationLabel(minutes: number): string {
  if (minutes >= 1_440) return `${Math.floor(minutes / 1_440)}д ${Math.round(minutes % 1_440 / 60)}ч`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}ч ${Math.round(minutes % 60)}м`;
  return `${Math.round(minutes)}м`;
}

function numberLabel(value: number, maximumFractionDigits = 2): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: maximumFractionDigits, maximumFractionDigits });
}

function signedUsd(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} USDT`;
}

function fallbackMetrics(trader: Trader, period: Period): ProfileMetrics {
  const profile = generateProfileData(trader);
  const factor = period === 'ALL' ? 1 : period === '90D' ? Math.min(1, 3 / trader.activeMonths) : period === '30D' ? Math.min(1, 1 / trader.activeMonths) : Math.min(1, 7 / (trader.activeMonths * 30));
  const totalTrades = Math.max(1, Math.round(profile.totalTrades * factor));
  const winningTrades = Math.round(totalTrades * trader.winRate / 100);
  const losingTrades = totalTrades - winningTrades;
  const roi = getRoiForPeriod(trader, period);
  return {
    roi,
    pnl: trader.aum * roi / 100,
    winRate: totalTrades ? winningTrades / totalTrades * 100 : 0,
    maximumDrawdown: trader.drawdown,
    averagePnl: trader.aum * roi / 100 / totalTrades,
    profitFactor: Number(profile.profitFactor),
    averageTradesPerWeek: profile.totalTrades / Math.max(1, trader.activeMonths * 4.345),
    averageHoldingTimeMinutes: 450,
    annualizedVolatility: trader.drawdown * 2.4,
    sharpe: compositeScore(trader) / 20,
    sortino: compositeScore(trader) / 14,
    totalTrades,
    winningTrades,
    losingTrades,
    tradingDays: period === 'ALL' ? trader.activeMonths * 30 : Number(period.slice(0, -1)),
    followerPnl: getCopierProfit(trader, period),
  };
}

function profileChart(values: number[], labels: string[], mode: ProfileChartMode, includeYear = false) {
  const width = 900;
  const top = 22;
  const bottom = 244;
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 0);
  const padding = Math.max(1, (rawMax - rawMin) * .12);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const range = max - min;
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : index / (values.length - 1) * width;
    const y = bottom - (value - min) / range * (bottom - top);
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const axis = Array.from({ length: 4 }, (_, index) => {
    const value = max - range * index / 3;
    return mode === 'ROI' ? `${value.toFixed(1)}%` : `${value < 0 ? '−' : ''}${formatAccountSize(Math.abs(value))}`;
  });
  return {
    line,
    area: `${line} L${points[points.length - 1]?.[0] ?? 0} ${bottom} L0 ${bottom} Z`,
    endY: points[points.length - 1]?.[1] ?? bottom,
    axis,
    labels: Array.from({ length: 5 }, (_, index) => {
      const date = labels[Math.round(index * (labels.length - 1) / 4)];
      return date ? formatSyntheticHistoryDate(date, includeYear) : '';
    }),
  };
}

function ProfilePerformanceChart({ trader, period, mode, onMode, periodData }: {
  trader: Trader;
  period: Period;
  mode: ProfileChartMode;
  onMode: (mode: ProfileChartMode) => void;
  periodData?: SyntheticPeriodAnalytics;
}) {
  const displayMode = periodData ? mode : 'ROI';
  const displayedRoi = periodData?.roi ?? getRoiForPeriod(trader, period);
  const chart = useMemo(() => {
    if (periodData?.equity.length) {
      const base = periodData.equity[0].equity;
      const values = periodData.equity.map((point) => mode === 'ROI' ? (point.equity / base - 1) * 100 : point.equity - base);
      return profileChart(values, periodData.equity.map((point) => point.date), mode, period === 'ALL');
    }
    const fallback = getChartData(trader, period);
    return { line: fallback.linePath, area: fallback.areaPath, endY: fallback.endY, axis: fallback.yLabels, labels: fallback.xLabels };
  }, [mode, period, periodData, trader]);

  return (
    <section className="profile-panel profile-performance-chart">
      <div className="profile-panel-heading">
        <div><span>Динамика стратегии</span><h2>{displayMode === 'ROI' ? 'ROI' : 'Реализованный PnL'}</h2></div>
        <div className="profile-segmented" aria-label="Тип графика">
          {(['ROI', 'PnL'] as const).map((item) => <button key={item} className={displayMode === item ? 'active' : ''} disabled={item === 'PnL' && !periodData} title={item === 'PnL' && !periodData ? 'PnL недоступен без истории сделок' : undefined} onClick={() => onMode(item)}>{item}</button>)}
        </div>
      </div>
      {periodData && periodData.equity.length > 0 && <p className="profile-period-range">
        {period === 'ALL' ? 'ALL · С момента запуска' : `${period} · Скользящий период`} · {formatSyntheticHistoryDate(periodData.equity[0].date)} — {formatSyntheticHistoryDate(periodData.equity[periodData.equity.length - 1].date)} · {periodData.tradingDays} дней
      </p>}
      <div className="chart-readouts" aria-label="Результат за выбранный период">
        <div><span>ROI · {period}</span><strong className={roiClass(displayedRoi)}>{formatPercent(displayedRoi)}</strong></div>
        <div><span>{periodData ? 'Накопленный PnL · USDT' : 'PnL · история недоступна'}</span><strong className={periodData ? roiClass(periodData.pnl) : undefined}>{periodData ? signedUsd(periodData.pnl) : '—'}</strong></div>
      </div>
      {period === 'ALL' && periodData && periodData.equity.length > 0 && <div className="profile-equity-readouts" aria-label="Капитал стратегии с момента запуска">
        <span>Начальный капитал <strong>{numberLabel(periodData.equity[0].equity)} USDT</strong></span>
        <span>Текущий капитал <strong>{numberLabel(periodData.equity[periodData.equity.length - 1].equity)} USDT</strong></span>
      </div>}
      <div className="profile-chart-wrap">
        <div className="profile-chart-y">{chart.axis.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
        <svg viewBox="0 0 900 270" preserveAspectRatio="none" role="img" aria-label={`${displayMode}, ${period}`}>
          <defs><linearGradient id="profile-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#f7a600" stopOpacity=".2" /><stop offset="100%" stopColor="#f7a600" stopOpacity="0" /></linearGradient></defs>
          <path className="profile-chart-grid" d="M0 22H900M0 96H900M0 170H900M0 244H900" />
          <path className="profile-chart-area" d={chart.area} />
          <path className="profile-chart-line" d={chart.line} />
          <circle className="profile-chart-point" cx="900" cy={chart.endY} r="4" />
        </svg>
        <div className={`profile-chart-x${period === 'ALL' ? ' profile-chart-x-inception' : ''}`}>{chart.labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
      </div>
      <p className="profile-trust"><ShieldCheck size={14} /> Performance and risk metrics are calculated from the strategy&apos;s trading history.</p>
    </section>
  );
}

function DailyPnlChart({ data }: { data?: SyntheticPeriodAnalytics }) {
  const days = data?.daily ?? [];
  const plot = dailyPnlChart(days);
  return (
    <section className="profile-panel daily-pnl-panel">
      <div className="profile-panel-heading"><div><span>Дневной результат · USDT</span><h2>Daily PnL</h2></div><span>{data?.period}</span></div>
      {days.length > 0 && <div className="chart-readouts">
        <div><span>PnL за период</span><strong className={roiClass(plot.total)}>{signedUsd(plot.total)}</strong></div>
        <div><span>Средний PnL / день</span><strong className={roiClass(plot.average)}>{signedUsd(plot.average)}</strong></div>
      </div>}
      {days.length ? (
        <div className="daily-plot" tabIndex={0} role="region" aria-label="Daily PnL: дневная история, прокрутка по горизонтали">
          <svg viewBox={`-65 0 ${plot.width + 75} 236`} style={{ minWidth: Math.max(540, days.length * 9) }} role="img" aria-label={`Daily PnL: ${days.length} дней, ${signedUsd(plot.total)}`}>
            {plot.ticks.map((tick, index) => <g key={index}><line className="daily-grid" x1="0" x2={plot.width} y1={tick.y} y2={tick.y} /><text x="-8" y={tick.y + 4} textAnchor="end">{formatAccountSize(tick.value)}</text></g>)}
            <line className="daily-baseline" x1="0" x2={plot.width} y1={plot.zero} y2={plot.zero} />
            {plot.bars.map(bar => <rect key={bar.date} x={bar.x} y={bar.y} width={bar.width} height={bar.height} className={bar.realizedPnl >= 0 ? 'daily-gain' : 'daily-loss'}><title>{bar.date}: {signedUsd(bar.realizedPnl)}</title></rect>)}
            {[0, Math.floor((days.length - 1) / 2), days.length - 1].map((index, labelIndex) => <text key={labelIndex} x={index / Math.max(1, days.length - 1) * plot.width} y="229" textAnchor={labelIndex === 0 ? 'start' : labelIndex === 2 ? 'end' : 'middle'}>{days[index].date}</text>)}
          </svg>
        </div>
      ) : <div className="profile-empty">Дневная история недоступна для этого трейдера.</div>}
      <div className="daily-legend"><span><i className="gain" /> Прибыльный день</span><span><i className="loss" /> Убыточный день</span></div>
      {days.length > 0 && <p className="daily-note">Синтетическая история · один столбец = один день · линейная шкала. Все дни сохранены; на узком экране график прокручивается.</p>}
    </section>
  );
}

function MetricsPanel({ metrics, period }: { metrics: ProfileMetrics; period: Period }) {
  const all = period === 'ALL';
  const rows: [string, string, string?][] = [
    [all ? 'All-Time ROI' : 'ROI', formatPercent(metrics.roi), roiClass(metrics.roi)],
    [all ? 'All-Time PnL' : 'Trader PnL', signedUsd(metrics.pnl), roiClass(metrics.pnl)],
    ['Win Rate', `${numberLabel(metrics.winRate)}%`],
    ['Max Drawdown', `${numberLabel(metrics.maximumDrawdown)}%`],
    ['Average P/L', signedUsd(metrics.averagePnl), roiClass(metrics.averagePnl)],
    ['Profit Factor', numberLabel(metrics.profitFactor)],
    ['Weekly Trades', numberLabel(metrics.averageTradesPerWeek, 1)],
    ['Average Holding', durationLabel(metrics.averageHoldingTimeMinutes)],
    ['Volatility', `${numberLabel(metrics.annualizedVolatility)}%`],
    ['Sharpe Ratio', numberLabel(metrics.sharpe)],
    ['Sortino Ratio', numberLabel(metrics.sortino)],
    ['Total Trades', metrics.totalTrades.toLocaleString('ru-RU')],
    ['Winning Trades', metrics.winningTrades.toLocaleString('ru-RU'), 'positive'],
    ['Losing Trades', metrics.losingTrades.toLocaleString('ru-RU'), 'negative'],
    [all ? 'Total Trading Days' : 'Trading Days', metrics.tradingDays.toLocaleString('ru-RU')],
  ];
  return (
    <section className="profile-panel profile-metrics-panel">
      <div className="profile-panel-heading"><div><span>{period === 'ALL' ? 'ALL · SINCE INCEPTION' : `${period} · ROLLING WINDOW`}</span><h2>Performance</h2></div><BarChart3 size={20} /></div>
      <div className="profile-metrics-grid">{rows.map(([label, value, className]) => <div key={label}><span>{label}</span><strong className={className}>{value}</strong></div>)}</div>
    </section>
  );
}

function TradesPanel({ trader, periodData }: { trader: Trader; periodData?: SyntheticPeriodAnalytics }) {
  const fallback = useMemo(() => generateTrades(trader), [trader]);
  const visibleTrades = periodData?.trades.slice(0, 100);
  return (
    <section className="profile-panel profile-trades-panel">
      <div className="profile-panel-heading"><div><span>Исполнено стратегией</span><h2>История сделок</h2></div><strong>{periodData ? `Показано ${visibleTrades?.length ?? 0} из ${periodData.trades.length}` : `${fallback.length} закрытых`}</strong></div>
      <div className="table-scroll">
        <table>
          <thead><tr>{['Pair', 'Side', 'Entry', 'Exit', 'Size', 'PnL', 'ROI', 'Open Time', 'Close Time', 'Holding', 'Status'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
          <tbody>{periodData ? visibleTrades?.map((trade) => (
            <tr key={trade.id}>
              <td><strong>{trade.symbol}</strong></td>
              <td><span className={`direction ${trade.side === 'LONG' ? 'direction-long' : 'direction-short'}`}>{trade.side === 'LONG' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{trade.side}</span></td>
              <td>{numberLabel(trade.entryPrice, 2)}</td><td>{numberLabel(trade.exitPrice, 2)}</td>
              <td>{formatAccountSize(trade.entryPrice * trade.quantity)}</td>
              <td className={roiClass(trade.netPnl)}>{signedUsd(trade.netPnl)}</td>
              <td className={roiClass(trade.returnPct)}>{formatPercent(trade.returnPct)}</td>
              <td>{new Date(trade.openedAt).toLocaleString('ru-RU')}</td><td>{new Date(trade.closedAt).toLocaleString('ru-RU')}</td>
              <td>{durationLabel(trade.holdingTimeMinutes)}</td><td><span className="closed-status">Закрыта</span></td>
            </tr>
          )) : fallback.map((trade, index) => (
            <tr key={`${trade.asset}-${trade.date}-${index}`}><td><strong>{trade.asset}</strong></td><td>{trade.side}</td><td>{trade.entry}</td><td>{trade.exit}</td><td>—</td><td className={roiClass(trade.positive ? 1 : -1)}>{trade.pnl}</td><td className={roiClass(trade.positive ? 1 : -1)}>{trade.roi}</td><td>{trade.date}</td><td>{trade.date}</td><td>{trade.duration}</td><td><span className="closed-status">Закрыта</span></td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function TradingProfilePanel({ trader, metrics, periodData, strategyTrades }: { trader: Trader; metrics: ProfileMetrics; periodData?: SyntheticPeriodAnalytics; strategyTrades?: SyntheticCopyTradingResponse['trades'] }) {
  const markets = periodData?.trades.reduce<Record<string, number>>((map, trade) => ({ ...map, [trade.symbol]: (map[trade.symbol] ?? 0) + 1 }), {}) ?? {};
  const mainMarkets = strategyTrades
    ? syntheticMainMarkets(strategyTrades).join(' · ') || '—'
    : Object.entries(markets).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([symbol]) => symbol.replace('/USDT', '').replace(/USDT$/, '')).join(' · ') || 'BTC · ETH · SOL';
  const style: Record<Trader['category'], string> = { trend: 'Trend', swing: 'Swing', quant: 'Quant', arbitrage: 'Market Neutral', futures: 'Futures', 'long-term': 'Long Term', 'multi-asset': 'Intraday / Swing' };
  const rows = [
    ['Trading Style', style[trader.category]],
    ['Average Holding', durationLabel(metrics.averageHoldingTimeMinutes)],
    ['Risk Level', RISK_LABEL_RU[trader.risk]],
    ['Main Markets', mainMarkets],
    ['Trades / Week', numberLabel(metrics.averageTradesPerWeek, 1)],
  ];
  return <section className="profile-panel trading-profile-panel"><div className="profile-panel-heading"><div><span>Структура стратегии</span><h2>Trading Profile</h2></div><LineChart size={20} /></div><div>{rows.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}</div></section>;
}

function FollowerHistoryChart({ history, field, label }: {
  history: SyntheticCopyTradingResponse['aumHistory']; field: 'aum' | 'followerCount'; label: string;
}) {
  const values = history.map(point => point[field]);
  if (!values.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) {
    return <p className="daily-note">История числа подписчиков недоступна для этого сценария.</p>;
  }
  const start = Date.parse(history[0].date);
  const end = Date.parse(history[history.length - 1].date);
  const maximum = Math.max(1, ...values);
  const x = (date: string) => 52 + (Date.parse(date) - start) / Math.max(1, end - start) * 530;
  const y = (value: number) => 114 - value / maximum * 96;
  // Step geometry keeps joins/allocation changes on their actual recorded date.
  const line = history.map((point, index) => `${index ? 'H' : 'M'}${x(point.date).toFixed(2)}${index ? 'V' : ' '}${y(values[index]).toFixed(2)}`).join(' ');
  return <div className="follower-history-chart" tabIndex={0} role="region" aria-label={`${label}: история, прокрутка по горизонтали`}>
    <h4>{label}</h4>
    <svg viewBox="0 0 600 142" role="img" aria-label={`${label}: ${formatSyntheticHistoryDate(history[0].date)} — ${formatSyntheticHistoryDate(history[history.length - 1].date)}`}>
      {[0, maximum / 2, maximum].map((value, index) => <g key={index}>
        <line className="daily-grid" x1="52" x2="582" y1={y(value)} y2={y(value)} />
        <text x="44" y={y(value) + 4} textAnchor="end">{field === 'aum' ? formatAccountSize(value) : Math.round(value)}</text>
      </g>)}
      <path className={`follower-history-line ${field === 'aum' ? 'aum' : 'followers'}`} d={line} />
      {history.map((point, index) => <circle key={point.date} className="follower-history-point" cx={x(point.date)} cy={y(values[index])} r="3"><title>{formatSyntheticHistoryDate(point.date)}: {numberLabel(values[index], field === 'aum' ? 2 : 0)}{field === 'aum' ? ' USDT' : ' подписчиков'}</title></circle>)}
      <text x="52" y="136">{formatSyntheticHistoryDate(history[0].date)}</text>
      <text x="582" y="136" textAnchor="end">{formatSyntheticHistoryDate(history[history.length - 1].date)}</text>
    </svg>
  </div>;
}

function FollowerHistory({ history }: { history: SyntheticCopyTradingResponse['aumHistory'] }) {
  if (!history.length) return null;
  const milestones = syntheticAumMilestones(history);
  return <section className="follower-history" aria-label="AUM и подписчики с момента запуска">
    <div className="follower-history-heading"><h3>ALL · AUM и подписчики с момента запуска</h3><p>{formatSyntheticHistoryDate(history[0].date)} — {formatSyntheticHistoryDate(history[history.length - 1].date)}</p></div>
    <div className="follower-history-charts">
      <FollowerHistoryChart history={history} field="aum" label="AUM · выделенный капитал, USDT" />
      <FollowerHistoryChart history={history} field="followerCount" label="Активные подписчики" />
    </div>
    <div className="follower-history-milestones">{milestones.map(point => <div key={point.date}>
      <span>{point.label}</span><time dateTime={point.date}>{formatSyntheticHistoryDate(point.date)}</time>
      <strong>{point.followerCount === undefined ? '—' : point.followerCount.toLocaleString('ru-RU')} <small>чел.</small></strong>
      <span>{numberLabel(point.aum)} USDT</span>
    </div>)}</div>
    <p className="daily-note">Синтетическая история · ежедневные снимки. AUM — выделенный подписчиками капитал, без накопленного PnL. Старые даты сохраняются при продвижении времени.</p>
  </section>;
}

function FollowersPanel({ trader, metrics, synthetic, period }: { trader: Trader; metrics: ProfileMetrics; synthetic?: SyntheticCopyTradingResponse | null; period: Period }) {
  const followers = trader.id === nazarTrader.id ? synthetic?.followers.filter((follower) => follower.active) ?? [] : [];
  const profitable = followers.filter((follower) => follower.realizedPnl + follower.unrealizedPnl > 0).length;
  return (
    <section className="profile-panel followers-performance-panel">
      <div className="profile-panel-heading"><div><span>Результаты копирования</span><h2>Follower Performance</h2></div><Users size={20} /></div>
      <div className="followers-summary">
        <div><span>Followers PnL · {period === 'ALL' ? 'с момента запуска' : period}</span><strong className={roiClass(metrics.followerPnl)}>{signedUsd(metrics.followerPnl)}</strong></div>
        <div><span>Прибыльные · с начала копирования</span><strong>{followers.length ? `${profitable} / ${followers.length}` : '—'}</strong></div>
        <div><span>Активные подписчики сейчас</span><strong>{(synthetic ? followers.length : trader.copiers).toLocaleString('ru-RU')}</strong></div>
      </div>
      {period === 'ALL' && synthetic && <FollowerHistory history={synthetic.aumHistory} />}
      {followers.length > 0 && <p className="follower-list-note">Активные подписчики · индивидуальный PnL и ROI с даты начала копирования</p>}
      {followers.length > 0 && <div className="follower-list">{followers.slice(0, 8).map((follower) => {
        const pnl = follower.realizedPnl + follower.unrealizedPnl;
        return <div key={follower.id}><span className="follower-initial">{follower.displayName.slice(0, 1)}</span><p><strong>{follower.displayName}</strong><small>С {formatSyntheticHistoryDate(follower.copyStartDate)} · {follower.copiedTrades} сделок</small></p><p><strong>{formatAccountSize(follower.allocatedCapital)}</strong><small>Выделенный капитал</small></p><p><strong className={roiClass(pnl)}>{signedUsd(pnl)}</strong><small>{formatPercent(follower.roi)} · с начала копирования</small></p></div>;
      })}</div>}
    </section>
  );
}

export function Profile({ trader, onBack, synthetic }: { trader: Trader; onBack: () => void; synthetic?: SyntheticCopyTradingResponse | null }) {
  const [activeTab, setActiveTab] = useState<ProfileTab>('statistics');
  const [period, setPeriod] = useState<Period>('90D');
  const [chartMode, setChartMode] = useState<ProfileChartMode>('ROI');
  const liveSynthetic = trader.id === nazarTrader.id ? synthetic : null;
  const periodData = useMemo(() => liveSynthetic ? selectSyntheticPeriod(liveSynthetic, period) : undefined, [liveSynthetic, period]);
  const metrics = useMemo<ProfileMetrics>(() => periodData ?? fallbackMetrics(trader, period), [periodData, period, trader]);
  const allTradingDays = liveSynthetic?.analytics.allTime.tradingDays ?? trader.activeMonths * 30;
  const heroDrawdown = liveSynthetic?.analytics.allTime.maximumDrawdown ?? trader.drawdown;
  const heroAum = liveSynthetic?.analytics.aum ?? trader.aum;
  const heroFollowers = liveSynthetic?.analytics.activeFollowers ?? trader.copiers;

  return (
    <main className="page-shell profile-page trader-profile-page">
      <button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Назад к копитрейдингу</button>
      <section className="trader-profile-hero">
        <div className="trader-profile-identity">
          <div className="profile-avatar-wrap"><Avatar trader={trader} large />{trader.verified && <span className="profile-verified"><Check size={11} /></span>}</div>
          <div><div className="profile-title-row"><h1>{trader.name}</h1>{trader.vip && <VipBadge />}</div><p>{trader.strategy} · {trader.id}</p></div>
        </div>
        <div className="trader-hero-metrics">
          <div><span>Followers</span><strong>{heroFollowers.toLocaleString('ru-RU')}</strong></div>
          <div><span>Trading Days</span><strong>{allTradingDays.toLocaleString('ru-RU')}</strong></div>
          <div><span>AUM</span><strong>{formatAccountSize(heroAum)} USDT</strong></div>
          <div><span>Max Drawdown</span><strong>{numberLabel(heroDrawdown)}%</strong></div>
        </div>
        <div className="trader-copy-cta"><FavoriteButton trader={trader} large /><div><CopyButton trader={trader} /><small>Минимальный депозит: <b>20 000 USDT</b></small></div></div>
      </section>

      <nav className="profile-primary-tabs" aria-label="Разделы профиля">
        <div>{([{ id: 'statistics', label: 'Статистика' }, { id: 'trades', label: 'Сделки' }] as const).map((tab) => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</div>
        <div className="profile-periods" aria-label="Период">{PERIODS.map((item) => <button key={item} className={period === item ? 'active' : ''} onClick={() => setPeriod(item)}>{item}</button>)}</div>
      </nav>

      {activeTab === 'statistics' ? <>
        <div className="profile-analytics-workspace">
          <aside><MetricsPanel metrics={metrics} period={period} /><TradingProfilePanel trader={trader} metrics={metrics} periodData={periodData} strategyTrades={liveSynthetic?.trades} /></aside>
          <div className="profile-chart-column"><ProfilePerformanceChart trader={trader} period={period} mode={chartMode} onMode={setChartMode} periodData={periodData} /><DailyPnlChart data={periodData} /></div>
        </div>
        <FollowersPanel trader={trader} metrics={metrics} synthetic={liveSynthetic} period={period} />
      </> : <TradesPanel trader={trader} periodData={periodData} />}
    </main>
  );
}

function MarketplaceHero({ trader, synthetic, onOpen }: { trader: Trader; synthetic?: SyntheticCopyTradingResponse | null; onOpen: (trader: Trader) => void }) {
  const all = synthetic?.analytics.allTime;
  const totalFollowers = marketplaceTraders.reduce((sum, item) => sum + item.copiers, trader.copiers);
  const stats = [
    ['Successful Trades', `${(all?.winningTrades ?? generateProfileData(trader).winningTrades).toLocaleString('en-US')}+`],
    ['Total Followers', `${totalFollowers.toLocaleString('en-US')}+`],
    ['Realized P&L', `${formatAccountSize(all?.pnl ?? getLifetimeCopierProfit(trader))}+`],
  ];
  return (
    <section className="copy-hero">
      <div className="copy-hero-main">
        <span className="hero-kicker">VOLTEX · COPY TRADING</span>
        <h1>Copy Trading VIP</h1>
        <p>Профессиональные стратегии, прозрачная статистика и единая система контроля рисков.</p>
        <div className="hero-stats">
          {stats.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
      </div>
      <button className="hero-guide" onClick={() => onOpen(trader)}>
        <div className="hero-guide-copy">
          <span>БЫСТРЫЙ СТАРТ</span>
          <strong>Как начать Copy Trading</strong>
          <p>Выберите трейдера, изучите риск-метрики и подключите копирование.</p>
          <em>Открыть руководство <ChevronRight size={15} /></em>
        </div>
        <div className="hero-guide-art" aria-hidden="true">
          <span className="hero-orbit hero-orbit-one" />
          <span className="hero-orbit hero-orbit-two" />
          <Users size={36} />
          <ShieldCheck size={50} />
        </div>
      </button>
      <div className="hero-actions">
        <article><span className="action-icon"><Zap size={22} /></span><div><strong>VOLTEX Copy Trading</strong><p>Следуйте профессиональным стратегиям</p></div><ChevronRight size={18} /></article>
        <article><span className="action-icon"><Crown size={22} /></span><div><strong>Стать Master Trader</strong><p>Развивайте аудиторию и получайте доход</p></div><ChevronRight size={18} /></article>
        <article><span className="action-icon"><CircleHelp size={22} /></span><div><strong>Руководство подписчика</strong><p>Начните уверенно, без лишней сложности</p></div><ChevronRight size={18} /></article>
      </div>
    </section>
  );
}

function MarketplaceBottom() {
  const faqs = [
    ['Что такое копитрейдинг?', 'Копитрейдинг автоматически повторяет сделки выбранного трейдера в пределах заданных вами условий риска.'],
    ['Какие комиссии взимаются за копитрейдинг?', 'Размер комиссии за результат указан в каждой карточке и профиле трейдера до подключения.'],
    ['Можно ли подписаться более чем на одного Master Trader?', 'Да, если ваш аккаунт соответствует действующим требованиям доступа VOLTEX.'],
  ];
  return (
    <>
      <div className="leaderboard-banners">
        <article><BarChart3 size={38} /><div><span>Лидерборд Copy Trading</span><strong>Подписчики</strong></div><button>Узнать <ChevronRight size={13} /></button></article>
        <article><Crown size={38} /><div><span>Лидерборд Copy Trading</span><strong>Master Traders</strong></div><button>Узнать <ChevronRight size={13} /></button></article>
      </div>
      <section className="master-cta">
        <span className="hero-kicker">VOLTEX MASTER PROGRAM</span>
        <h2>Стать Master Trader</h2>
        <p>Получайте дополнительный доход, когда подписчики копируют ваши сделки.</p>
        <button className="button button-outline">Подать заявку <ChevronRight size={15} /></button>
      </section>
      <section className="copy-faq">
        <div className="copy-faq-heading"><span className="hero-kicker">ПОДДЕРЖКА</span><h2>FAQ</h2></div>
        <div>
          {faqs.map(([question, answer]) => (
            <details key={question}><summary>{question}<ChevronDown size={17} /></summary><p>{answer}</p></details>
          ))}
        </div>
      </section>
    </>
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
      default: return dynamicRoster;
    }
  }, [tab, favorites, following, dynamicRoster]);

  const visibleTraders = useMemo(() => {
    let result = searchTraders(tabRoster, query);
    result = sortTraders(result, sortBy, period);
    if (tab === 'leaderboard') {
      const featured = result.find((item) => item.id === nazara.id);
      if (featured) result = [featured, ...result.filter((item) => item.id !== nazara.id)];
    }
    return result;
  }, [tabRoster, query, sortBy, period, tab, nazara.id]);

  const totalPages = Math.max(1, Math.ceil(visibleTraders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageTraders = visibleTraders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const startIdx = visibleTraders.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(currentPage * PAGE_SIZE, visibleTraders.length);

  useEffect(() => { setPage(1); }, [tab, query, sortBy, period]);

  return (
    <main className="page-shell copy-marketplace">
      <MarketplaceHero trader={nazara} synthetic={synthetic} onOpen={onOpen} />

      <section className="market-controls">
        <div className="market-toolbar">
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
          <div className="market-search-sort">
            <div className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск трейдеров" /></div>
            <div className={`sort-button ${sortOpen ? 'sort-open' : ''}`} onClick={() => setSortOpen(!sortOpen)} onBlur={() => setTimeout(() => setSortOpen(false), 150)} tabIndex={0}>
              <span><b>{SORT_LABEL_RU[sortBy] ?? sortBy}</b></span><ChevronDown size={14} className={sortOpen ? 'chevron-up' : ''} />
              {sortOpen && (
                <div className="filter-dropdown sort-dropdown" onClick={(e) => e.stopPropagation()}>
                  {sortOptions.map((opt) => <button key={opt} className={sortBy === opt ? 'active' : ''} onClick={() => { setSortBy(opt); setSortOpen(false); }}>{SORT_LABEL_RU[opt] ?? opt}{sortBy === opt && <Check size={13} />}</button>)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="ranking-controls">
          <div className="ranking-filters">
            {RANKING_FILTERS.map((filter) => (
              <button key={filter.label} className={sortBy === filter.sort ? 'active' : ''} onClick={() => setSortBy(filter.sort)}>{filter.label}</button>
            ))}
          </div>
          <div className="period-group">{PERIODS.map((p) => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{PERIOD_LABEL_RU[p]}</button>)}</div>
        </div>
        <p className="ranking-copy">Трейдеры с оптимальным соотношением прибыли и риска.</p>
      </section>

      <div className="access-strip"><EligibilityGate /><div className="deposit-status"><WalletCards size={17} /><div><span>Ваш депозит</span><strong>${depositUsd.toLocaleString()}.00</strong></div><span className="status-pill">{eligible ? 'Есть доступ' : 'Нет доступа'}</span></div></div>

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
            {tab === 'favorites' && favorites.size === 0 && !query ? (
              <><Star size={22} /><strong>Избранное пусто</strong><span>Нажмите на звёздочку в карточке трейдера, чтобы сохранить его здесь.</span></>
            ) : tab === 'following' && following.size === 0 && !query ? (
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
      <MarketplaceBottom />
    </main>
  );
}
