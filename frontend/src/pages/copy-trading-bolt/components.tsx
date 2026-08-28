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
import {
  type Trader,
  type RiskLevel,
  nazarTrader,
  marketplaceTraders,
  formatPercent,
  roiClass,
  formatAccountSize,
  generateProfileData,
  generateTrades,
  getStrategyDescription,
  getTraderEarnings,
  formatUsd,
  sortTraders,
  filterTraders,
  searchTraders,
} from './traders';
import { useCopyEligibility } from './CopyEligibilityContext';

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
  'Highest Trading Volume': 'Максимальный объём торгов',
  'Newest Traders': 'Новые трейдеры',
};

const chartTabs = ['7D', '30D', '90D', '1Y', 'ALL'];
const sortOptions = ['Top Performance', 'Highest ROI', 'Best Win Rate', 'Lowest Drawdown', 'Most Copied', 'Highest Trading Volume', 'Newest Traders'];
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
  { label: '<$10K', value: '<10k' },
  { label: '$10K-$50K', value: '10k-50k' },
  { label: '$50K-$100K', value: '50k-100k' },
  { label: '$100K+', value: '100k+' },
];
const PAGE_SIZE = 12;

function VipBadge() {
  return <span className="vip-badge"><Crown size={12} /> VIP</span>;
}

function Avatar({ trader, large = false }: { trader: Trader; large?: boolean }) {
  return <div className={`avatar avatar-${trader.tone} ${large ? 'avatar-large' : ''}`}>{trader.initials}</div>;
}

function EligibilityGate({ compact = false }: { compact?: boolean }) {
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

function CopyButton({ compact = false }: { compact?: boolean }) {
  const { eligible } = useCopyEligibility();
  if (eligible) {
    return <button className={`button button-copy ${compact ? 'button-small' : ''}`}>Копировать трейдера</button>;
  }
  return <button className={`button button-copy ${compact ? 'button-small' : ''}`} disabled>Депозит от $20 000 для копирования</button>;
}

function TraderCard({ trader, onOpen }: { trader: Trader; onOpen: (trader: Trader) => void }) {
  return (
    <article className={`trader-card ${trader.vip ? 'trader-card-vip' : ''}`} onClick={() => onOpen(trader)}>
      <div className="card-topline">
        <div className="avatar-wrap"><Avatar trader={trader} />{trader.verified && <span className="verified-dot"><Check size={9} /></span>}</div>
        <button className="icon-button" onClick={(event) => event.stopPropagation()}><Star size={16} /></button>
      </div>
      <div className="trader-name-row">
        <div><h3>{trader.name}</h3><p>{trader.strategy}</p></div>
        {trader.vip && <VipBadge />}
      </div>
      <div className="card-return">
        <span>90Д ROI</span>
        <strong className={roiClass(trader.roi90)}>{formatPercent(trader.roi90)}</strong>
        <div className="mini-chart"><i /><i /><i /><i /><i /></div>
      </div>
      <div className="card-stats">
        <div><span>7Д ROI</span><strong className={roiClass(trader.roi7)}>{formatPercent(trader.roi7)}</strong></div>
        <div><span>30Д ROI</span><strong className={roiClass(trader.roi30)}>{formatPercent(trader.roi30)}</strong></div>
        <div><span>Винрейт</span><strong>{trader.winRate}%</strong></div>
      </div>
      <div className="card-meta">
        <div><span>Просадка</span><b>{trader.drawdown}%</b></div>
        <div><span>Подписки</span><b>{trader.copiers}</b></div>
        <div><span>Счёт</span><b>{formatAccountSize(trader.accountSize)}</b></div>
      </div>
      <div className="card-footer-row">
        <span className={`risk risk-${trader.risk.toLowerCase().replace(' ', '-')}`}>{RISK_LABEL_RU[trader.risk]} риск</span>
        <span className="card-id">{trader.id}</span>
      </div>
      <div className="card-cta-area">
        <PremiumEligibilityBlock compact />
        <button className="card-view-button" onClick={(event) => { event.stopPropagation(); onOpen(trader); }}>Профиль трейдера</button>
      </div>
    </article>
  );
}

function PerformanceOverview({ trader, tick }: { trader: Trader; tick: number }) {
  const drift = trader.vip ? tick * 0.3 : tick * 0.05;
  const roi7 = trader.roi7 + drift * 0.4;
  const roi30 = trader.roi30 + drift * 0.7;
  const roi90 = trader.roi90 + drift * 1.2;
  const allTime = trader.vip ? 1240 + tick * 2 : Math.round(roi90 * 1.5 * 10) / 10;
  return (
    <section className="overview-grid">
      <div className="overview-intro">
        <span className="eyebrow">Обзор доходности <span className="live-dot" /> Live</span>
        <h2>{trader.strategy}.<br /><em>Контролируемый риск.</em></h2>
        <p>{getStrategyDescription(trader)}</p>
      </div>
      <div className="metric-card"><span>7Д ROI</span><strong className={roiClass(roi7)}>{formatPercent(roi7)}</strong><small>против рынка +18.4%</small></div>
      <div className="metric-card"><span>30Д ROI</span><strong className={roiClass(roi30)}>{formatPercent(roi30)}</strong><small>против рынка +42.7%</small></div>
      <div className="metric-card"><span>90Д ROI</span><strong className={roiClass(roi90)}>{formatPercent(roi90)}</strong><small>против рынка +89.2%</small></div>
      <div className="metric-card metric-alltime"><span>Всё время</span><strong className={roiClass(allTime)}>{formatPercent(allTime)}</strong><small>с начала работы</small></div>
    </section>
  );
}

function PerformanceChart() {
  const [activeTab, setActiveTab] = useState('90D');
  const [comparison, setComparison] = useState('Trader');
  return (
    <section className="panel chart-panel">
      <div className="panel-header">
        <div><span className="eyebrow">Доходность</span><h2>Рост $10,000</h2></div>
        <div className="chart-tools">
          <div className="tab-group">{chartTabs.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div>
          <div className="comparison-group">{['Trader', 'BTC', 'Market'].map((item) => <button key={item} className={comparison === item ? 'active' : ''} onClick={() => setComparison(item)}><i className={`legend-${item.toLowerCase()}`} />{item}</button>)}</div>
        </div>
      </div>
      <div className="chart-wrap">
        <div className="chart-y"><span>$95k</span><span>$70k</span><span>$45k</span><span>$20k</span></div>
        <svg viewBox="0 0 900 280" preserveAspectRatio="none" className="performance-svg" role="img" aria-label="Upward performance chart">
          <defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#d99b4a" stopOpacity=".18" /><stop offset="100%" stopColor="#d99b4a" stopOpacity="0" /></linearGradient></defs>
          <path className="chart-grid" d="M0 30H900M0 100H900M0 170H900M0 240H900" />
          <path className="chart-area" d="M0 230 C65 220 82 202 138 211 S220 168 278 178 S360 126 420 145 S508 87 560 105 S650 61 712 71 S788 28 900 34 V280 H0Z" />
          <path className="chart-line chart-market" d="M0 235 C110 226 190 230 260 207 S420 220 500 194 S650 199 730 167 S820 176 900 151" />
          <path className="chart-line chart-btc" d="M0 240 C80 238 140 215 230 220 S360 185 455 187 S570 169 660 152 S790 134 900 117" />
          <path className="chart-line" d="M0 230 C65 220 82 202 138 211 S220 168 278 178 S360 126 420 145 S508 87 560 105 S650 61 712 71 S788 28 900 34" />
          <circle cx="900" cy="34" r="5" className="chart-point" />
        </svg>
        <div className="chart-x"><span>Jun 01</span><span>Jun 18</span><span>Jul 05</span><span>Jul 22</span><span>Aug 08</span><span>Aug 28</span></div>
      </div>
      <div className="chart-note">
        <span><span className="live-dot" /> Данные обновляются каждые 30 секунд</span>
        <span>Прошлые результаты не гарантируют будущую доходность.</span>
      </div>
    </section>
  );
}

function RiskMetrics({ trader }: { trader: Trader }) {
  const data = generateProfileData(trader);
  const metrics: [string, string, string?][] = [
    ['Максимальная просадка', `${trader.drawdown.toFixed(1)}%`],
    ['Винрейт', `${trader.winRate}%`],
    ['Профит-фактор', data.profitFactor],
    ['Уровень риска', RISK_LABEL_RU[trader.risk], trader.risk.toLowerCase().replace(' ', '-')],
    ['Среднее время сделки', data.holdingTime],
    ['Наибольшая просадка', `${trader.drawdown.toFixed(1)}%`],
  ];
  return (
    <section className="panel">
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

function TradingStatistics({ trader }: { trader: Trader }) {
  const data = generateProfileData(trader);
  const rows: [string, string][] = [
    ['Всего сделок', String(data.totalTrades)],
    ['Прибыльных сделок', String(data.winningTrades)],
    ['Убыточных сделок', String(data.losingTrades)],
    ['Средняя прибыль', data.avgProfit],
    ['Средний убыток', data.avgLoss],
    ['Профит-фактор', data.profitFactor],
    ['Среднее время удержания', data.holdingTime],
    ['Объём торгов', data.volume],
  ];
  return (
    <section className="panel">
      <div className="panel-header">
        <div><span className="eyebrow">Качество исполнения</span><h2>Торговая статистика</h2></div>
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

function RecentTrades({ trader }: { trader: Trader }) {
  const trades = useMemo(() => generateTrades(trader), [trader]);
  return (
    <section className="panel trades-panel">
      <div className="panel-header">
        <div><span className="eyebrow">Журнал сделок</span><h2>Последние сделки</h2></div>
        <button className="text-button">Все сделки <ChevronRight size={15} /></button>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>{['Актив', 'Направление', 'Вход', 'Выход', 'PnL', 'ROI', 'Длительность', 'Дата'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {trades.map((trade, i) => (
              <tr key={`${trade.asset}-${trade.date}-${i}`}>
                <td><strong>{trade.asset}</strong></td>
                <td><span className={`direction ${trade.side === 'Long' ? 'direction-long' : 'direction-short'}`}>{trade.side === 'Long' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{trade.side === 'Long' ? 'Лонг' : 'Шорт'}</span></td>
                <td>{trade.entry}</td><td>{trade.exit}</td>
                <td className={trade.positive ? 'positive' : 'negative'}>{trade.pnl}</td>
                <td className={trade.positive ? 'positive' : 'negative'}>{trade.roi}</td>
                <td>{trade.duration}</td><td>{trade.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PerformanceEarnings({ trader }: { trader: Trader }) {
  if (!trader.copierProfit || !trader.performanceFee) return null;
  const earnings = getTraderEarnings(trader);
  const feePct = Math.round(trader.performanceFee * 100);
  return (
    <section className="panel earnings-panel">
      <div className="panel-header">
        <div><span className="eyebrow">Структура комиссии</span><h2>Доходность и заработок</h2></div>
        <WalletCards size={20} className="panel-icon" />
      </div>
      <div className="earnings-grid">
        <div className="earnings-lead">
          <span>Прибыль, полученная подписчиками</span>
          <strong className="positive">${trader.copierProfit.toLocaleString()} USDT</strong>
          <small>Общая прибыль, распределённая между всеми активными аккаунтами подписчиков</small>
        </div>
        <div className="earnings-row">
          <div><span>Комиссия за результат</span><strong>{feePct}%</strong></div>
          <div className="earnings-arrow"><ChevronRight size={18} /></div>
          <div><span>Заработок {trader.name}</span><strong className="positive">${earnings.toLocaleString()} USDT</strong></div>
        </div>
      </div>
      <div className="earnings-calc">
        <span>Расчёт</span>
        <code>${trader.copierProfit.toLocaleString()} × {feePct}% = ${earnings.toLocaleString()} USDT</code>
      </div>
      <p className="earnings-note">{feePct}% комиссии от прибыли, полученной подписчиками.</p>
    </section>
  );
}

function Copiers({ trader }: { trader: Trader }) {
  const data = generateProfileData(trader);
  return (
    <section className="panel copiers-panel">
      <div className="panel-header">
        <div><span className="eyebrow">Общие интересы</span><h2>Подписчики</h2></div>
        <Users size={20} className="panel-icon" />
      </div>
      <div className="copier-grid">
        <div className="copier-lead"><strong>{trader.copiers}</strong><span>Активных подписчиков</span><div className="copier-avatars"><span>J</span><span>K</span><span>R</span><span>+</span></div></div>
        <div><span>Всего подписчиков</span><strong>{trader.copiers}</strong></div>
        <div><span>Новых за неделю</span><strong className="positive">+{data.newThisWeek}</strong></div>
        <div><span>Средний депозит подписчика</span><strong>${data.avgCopierDeposit.toLocaleString()}</strong></div>
        <div><span>Общий объём копирования</span><strong>${data.totalCopiedVolume}M</strong></div>
      </div>
      <div className="info-note"><CircleHelp size={14} /> Активность подписчиков обновляется в реальном времени при открытии и закрытии позиций.</div>
    </section>
  );
}

export function Profile({ trader, onBack, tick }: { trader: Trader; onBack: () => void; tick: number }) {
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
              <span><WalletCards size={15} /> {formatAccountSize(trader.accountSize)}</span>
            </div>
          </div>
        </div>
        <div className="profile-actions">
          <button className="icon-button large-icon"><Star size={18} /></button>
          <div className="profile-cta-area">
            <PremiumEligibilityBlock />
            <CopyButton />
          </div>
        </div>
      </section>
      <PerformanceOverview trader={trader} tick={tick} />
      <PerformanceChart />
      <PerformanceEarnings trader={trader} />
      <div className="two-column"><RiskMetrics trader={trader} /><TradingStatistics trader={trader} /></div>
      <RecentTrades trader={trader} />
      <Copiers trader={trader} />
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

export function Marketplace({ onOpen }: { onOpen: (trader: Trader) => void }) {
  const { depositUsd, eligible } = useCopyEligibility();
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('Top Performance');
  const [sortOpen, setSortOpen] = useState(false);
  const [period, setPeriod] = useState('90D');
  const [filters, setFilters] = useState({ performance: 'all', risk: 'all', strategy: 'all', account: 'all' });
  const [page, setPage] = useState(1);

  const visibleTraders = useMemo(() => {
    let result = searchTraders(marketplaceTraders, query);
    result = filterTraders(result, filters);
    result = sortTraders(result, sortBy, period);
    return result;
  }, [query, filters, sortBy, period]);

  const totalPages = Math.max(1, Math.ceil(visibleTraders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageTraders = visibleTraders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const startIdx = visibleTraders.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(currentPage * PAGE_SIZE, visibleTraders.length);

  useEffect(() => { setPage(1); }, [query, filters, sortBy, period]);

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
          <div className="period-group">{['7D', '30D', '90D', '1Y'].map((p) => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{p}</button>)}</div>
        </div>
      </div>

      <div className="filter-row">
        <div className="filter-label"><SlidersHorizontal size={15} /> Фильтры</div>
        <FilterDropdown label="Доходность" options={performanceFilters} value={filters.performance} onChange={(v) => setFilters({ ...filters, performance: v })} />
        <FilterDropdown label="Риск" options={riskFilters} value={filters.risk} onChange={(v) => setFilters({ ...filters, risk: v })} />
        <FilterDropdown label="Стратегия" options={strategyFilters} value={filters.strategy} onChange={(v) => setFilters({ ...filters, strategy: v })} />
        <FilterDropdown label="Размер счёта" options={accountFilters} value={filters.account} onChange={(v) => setFilters({ ...filters, account: v })} />
        {(filters.performance !== 'all' || filters.risk !== 'all' || filters.strategy !== 'all' || filters.account !== 'all') && (
          <button className="filter-clear" onClick={() => setFilters({ performance: 'all', risk: 'all', strategy: 'all', account: 'all' })}>Сбросить</button>
        )}
      </div>

      <EligibilityGate />

      <section className="featured-section">
        <div className="section-title">
          <div><span className="eyebrow">Рекомендуемая стратегия</span><h2>{nazarTrader.name} <VipBadge /></h2></div>
          <button className="text-button" onClick={() => onOpen(nazarTrader)}>Профиль трейдера <ChevronRight size={15} /></button>
        </div>
        <div className="featured-card" onClick={() => onOpen(nazarTrader)}>
          <div className="featured-copy">
            <div className="featured-person">
              <div className="profile-avatar-wrap"><Avatar trader={nazarTrader} large /><span className="profile-verified"><Check size={11} /></span></div>
              <div>
                <div className="profile-title-row"><h3>{nazarTrader.name}</h3><VipBadge /></div>
                <p>{nazarTrader.strategy} <span className="dot-separator" /> {nazarTrader.id}</p>
              </div>
            </div>
            <p className="featured-description">{getStrategyDescription(nazarTrader)}</p>
            <div className="featured-footer">
              <span><Users size={15} /> {nazarTrader.copiers} подписчиков</span>
              <span><ShieldCheck size={15} /> {RISK_LABEL_RU[nazarTrader.risk]} риск</span>
              <span><LineChart size={15} /> {nazarTrader.activeMonths} мес. истории</span>
              <span><WalletCards size={15} /> {formatAccountSize(nazarTrader.accountSize)}</span>
            </div>
          </div>
          <div className="featured-performance">
            <div><span>7Д</span><strong className="positive">{formatPercent(nazarTrader.roi7)}</strong></div>
            <div><span>30Д</span><strong className="positive">{formatPercent(nazarTrader.roi30)}</strong></div>
            <div><span>90Д</span><strong className="positive">{formatPercent(nazarTrader.roi90)}</strong></div>
            <div><span>Винрейт</span><strong>{nazarTrader.winRate}%</strong></div>
            <div><span>Макс. просадка</span><strong>{nazarTrader.drawdown}%</strong></div>
          </div>
          <div className="featured-copier-profit">
            <span>Прибыль подписчиков</span>
            <strong>{formatUsd(nazarTrader.copierProfit!)} USDT</strong>
          </div>
          <div className="featured-action"><PremiumEligibilityBlock compact /><CopyButton /><small>Требуется депозит от $20 000</small></div>
        </div>
      </section>

      <section className="marketplace-section">
        <div className="section-title">
          <div><span className="eyebrow">Подборка стратегий</span><h2>Профессиональные трейдеры</h2></div>
          <span className="results-count">Трейдеров: {visibleTraders.length}</span>
        </div>
        <div className="trader-grid">
          {pageTraders.map((trader) => <TraderCard key={trader.id} trader={trader} onOpen={onOpen} />)}
        </div>
        {visibleTraders.length === 0 && (
          <div className="empty-state"><Search size={22} /><strong>Трейдеры не найдены</strong><span>Измените параметры поиска или фильтры.</span></div>
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
