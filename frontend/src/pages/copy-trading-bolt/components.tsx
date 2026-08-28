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
// components, same markup, same CSS classes. Only change throughout: every
// read of the archive's hardcoded USER_DEPOSIT/COPY_ELIGIBLE constants is
// now a useCopyEligibility() call against the real account deposit (see
// CopyEligibilityContext.tsx). The archive's own <Logo>/<header
// className="topbar">/<footer className="footer"> aren't ported here — the
// real site's Nav/Footer render around this instead (CopyTradingPage.tsx),
// per "don't touch the VOLTEX branding" and "don't break navigation."

const chartTabs = ['7D', '30D', '90D', '1Y', 'ALL'];
const sortOptions = ['Top Performance', 'Highest ROI', 'Best Win Rate', 'Lowest Drawdown', 'Most Copied', 'Highest Trading Volume', 'Newest Traders'];
const performanceFilters = [
  { label: 'All', value: 'all' },
  { label: 'Positive', value: 'positive' },
  { label: 'Negative', value: 'negative' },
];
const riskFilters = [
  { label: 'All', value: 'all' },
  { label: 'Low', value: 'Low' },
  { label: 'Moderate', value: 'Moderate' },
  { label: 'High', value: 'High' },
  { label: 'Very High', value: 'Very High' },
];
const strategyFilters = [
  { label: 'All', value: 'all' },
  { label: 'Trend', value: 'trend' },
  { label: 'Swing', value: 'swing' },
  { label: 'Quant', value: 'quant' },
  { label: 'Arbitrage', value: 'arbitrage' },
  { label: 'Futures', value: 'futures' },
  { label: 'Long-Term', value: 'long-term' },
  { label: 'Multi-Asset', value: 'multi-asset' },
];
const accountFilters = [
  { label: 'All', value: 'all' },
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
        <strong>{compact ? 'Deposit $20,000+ to copy' : 'Unlock Copy Trading'}</strong>
        {!compact && <p>Copy trading is available only to clients with a deposit of $20,000 or more.</p>}
      </div>
      {!compact && <button className="button button-outline">Increase Deposit <ChevronRight size={15} /></button>}
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
    return <button className={`button button-copy ${compact ? 'button-small' : ''}`}>Copy Trader</button>;
  }
  return <button className={`button button-copy ${compact ? 'button-small' : ''}`} disabled>Deposit $20,000+ to copy</button>;
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
        <span>90D ROI</span>
        <strong className={roiClass(trader.roi90)}>{formatPercent(trader.roi90)}</strong>
        <div className="mini-chart"><i /><i /><i /><i /><i /></div>
      </div>
      <div className="card-stats">
        <div><span>7D ROI</span><strong className={roiClass(trader.roi7)}>{formatPercent(trader.roi7)}</strong></div>
        <div><span>30D ROI</span><strong className={roiClass(trader.roi30)}>{formatPercent(trader.roi30)}</strong></div>
        <div><span>Win Rate</span><strong>{trader.winRate}%</strong></div>
      </div>
      <div className="card-meta">
        <div><span>Drawdown</span><b>{trader.drawdown}%</b></div>
        <div><span>Copiers</span><b>{trader.copiers}</b></div>
        <div><span>Account</span><b>{formatAccountSize(trader.accountSize)}</b></div>
      </div>
      <div className="card-footer-row">
        <span className={`risk risk-${trader.risk.toLowerCase().replace(' ', '-')}`}>{trader.risk} Risk</span>
        <span className="card-id">{trader.id}</span>
      </div>
      <div className="card-cta-area">
        <PremiumEligibilityBlock compact />
        <button className="card-view-button" onClick={(event) => { event.stopPropagation(); onOpen(trader); }}>View Trader</button>
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
        <span className="eyebrow">Performance overview <span className="live-dot" /> Live</span>
        <h2>{trader.strategy}.<br /><em>Controlled risk.</em></h2>
        <p>{getStrategyDescription(trader)}</p>
      </div>
      <div className="metric-card"><span>7D ROI</span><strong className={roiClass(roi7)}>{formatPercent(roi7)}</strong><small>vs. market +18.4%</small></div>
      <div className="metric-card"><span>30D ROI</span><strong className={roiClass(roi30)}>{formatPercent(roi30)}</strong><small>vs. market +42.7%</small></div>
      <div className="metric-card"><span>90D ROI</span><strong className={roiClass(roi90)}>{formatPercent(roi90)}</strong><small>vs. market +89.2%</small></div>
      <div className="metric-card metric-alltime"><span>All Time</span><strong className={roiClass(allTime)}>{formatPercent(allTime)}</strong><small>since inception</small></div>
    </section>
  );
}

function PerformanceChart() {
  const [activeTab, setActiveTab] = useState('90D');
  const [comparison, setComparison] = useState('Trader');
  return (
    <section className="panel chart-panel">
      <div className="panel-header">
        <div><span className="eyebrow">Performance</span><h2>Growth of $10,000</h2></div>
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
        <span><span className="live-dot" /> Data refreshes every 30 seconds</span>
        <span>Past performance does not guarantee future results.</span>
      </div>
    </section>
  );
}

function RiskMetrics({ trader }: { trader: Trader }) {
  const data = generateProfileData(trader);
  const metrics: [string, string, string?][] = [
    ['Maximum Drawdown', `${trader.drawdown.toFixed(1)}%`],
    ['Win Rate', `${trader.winRate}%`],
    ['Profit Factor', data.profitFactor],
    ['Risk Level', trader.risk, trader.risk.toLowerCase().replace(' ', '-')],
    ['Average Trade Duration', data.holdingTime],
    ['Largest Drawdown', `${trader.drawdown.toFixed(1)}%`],
  ];
  return (
    <section className="panel">
      <div className="panel-header">
        <div><span className="eyebrow">Risk framework</span><h2>Risk Metrics</h2></div>
        <span className="controlled-badge"><ShieldCheck size={14} /> Controlled risk</span>
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
    ['Total Trades', String(data.totalTrades)],
    ['Winning Trades', String(data.winningTrades)],
    ['Losing Trades', String(data.losingTrades)],
    ['Average Profit', data.avgProfit],
    ['Average Loss', data.avgLoss],
    ['Profit Factor', data.profitFactor],
    ['Average Holding Time', data.holdingTime],
    ['Trading Volume', data.volume],
  ];
  return (
    <section className="panel">
      <div className="panel-header">
        <div><span className="eyebrow">Execution quality</span><h2>Trading Statistics</h2></div>
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
        <div><span className="eyebrow">Live execution log</span><h2>Recent Trades</h2></div>
        <button className="text-button">View all <ChevronRight size={15} /></button>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>{['Asset', 'Direction', 'Entry', 'Exit', 'PnL', 'ROI', 'Duration', 'Date'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {trades.map((trade, i) => (
              <tr key={`${trade.asset}-${trade.date}-${i}`}>
                <td><strong>{trade.asset}</strong></td>
                <td><span className={`direction ${trade.side === 'Long' ? 'direction-long' : 'direction-short'}`}>{trade.side === 'Long' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{trade.side}</span></td>
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
        <div><span className="eyebrow">Fee structure</span><h2>Performance & Earnings</h2></div>
        <WalletCards size={20} className="panel-icon" />
      </div>
      <div className="earnings-grid">
        <div className="earnings-lead">
          <span>Profit generated for copiers</span>
          <strong className="positive">${trader.copierProfit.toLocaleString()} USDT</strong>
          <small>Total profit distributed across all active copier accounts</small>
        </div>
        <div className="earnings-row">
          <div><span>Performance fee</span><strong>{feePct}%</strong></div>
          <div className="earnings-arrow"><ChevronRight size={18} /></div>
          <div><span>Nazar's earnings</span><strong className="positive">${earnings.toLocaleString()} USDT</strong></div>
        </div>
      </div>
      <div className="earnings-calc">
        <span>Calculation</span>
        <code>${trader.copierProfit.toLocaleString()} × {feePct}% = ${earnings.toLocaleString()} USDT</code>
      </div>
      <p className="earnings-note">{feePct}% performance fee on profits generated for copiers.</p>
    </section>
  );
}

function Copiers({ trader }: { trader: Trader }) {
  const data = generateProfileData(trader);
  return (
    <section className="panel copiers-panel">
      <div className="panel-header">
        <div><span className="eyebrow">Aligned incentives</span><h2>Copiers</h2></div>
        <Users size={20} className="panel-icon" />
      </div>
      <div className="copier-grid">
        <div className="copier-lead"><strong>{trader.copiers}</strong><span>Active copiers</span><div className="copier-avatars"><span>J</span><span>K</span><span>R</span><span>+</span></div></div>
        <div><span>Total Copiers</span><strong>{trader.copiers}</strong></div>
        <div><span>New This Week</span><strong className="positive">+{data.newThisWeek}</strong></div>
        <div><span>Average Copier Deposit</span><strong>${data.avgCopierDeposit.toLocaleString()}</strong></div>
        <div><span>Total Copied Volume</span><strong>${data.totalCopiedVolume}M</strong></div>
      </div>
      <div className="info-note"><CircleHelp size={14} /> Copier activity is updated in real time as positions open and close.</div>
    </section>
  );
}

export function Profile({ trader, onBack, tick }: { trader: Trader; onBack: () => void; tick: number }) {
  return (
    <main className="page-shell profile-page">
      <button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Back to Copy Trading</button>
      <section className="profile-hero">
        <div className="profile-identity">
          <div className="profile-avatar-wrap"><Avatar trader={trader} large /><span className="profile-verified"><Check size={11} /></span></div>
          <div>
            <div className="profile-title-row"><h1>{trader.name}</h1>{trader.vip && <VipBadge />}</div>
            <p>{trader.strategy} <span className="dot-separator" /> <ShieldCheck size={13} /> Verified track record <span className="dot-separator" /> {trader.id}</p>
            <div className="profile-meta">
              <span><Users size={15} /> {trader.copiers} Copiers</span>
              <span><Clock3 size={15} /> Active for {trader.activeMonths} months</span>
              <span><Zap size={15} /> {trader.risk} risk</span>
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
          <span className="eyebrow">Marketplace <span className="live-dot" /> Live</span>
          <h1>Copy Trading</h1>
          <p>Follow experienced traders and copy their strategies with institutional-grade risk controls.</p>
        </div>
        <div className="deposit-status">
          <WalletCards size={17} />
          <div><span>Your deposit</span><strong>${depositUsd.toLocaleString()}.00</strong></div>
          <span className="status-pill">{eligible ? 'Eligible' : 'Not eligible'}</span>
        </div>
      </section>

      <div className="market-nav">
        <div className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search professional traders..." /><kbd>/</kbd></div>
        <div className="sort-wrapper">
          <div className={`sort-button ${sortOpen ? 'sort-open' : ''}`} onClick={() => setSortOpen(!sortOpen)} onBlur={() => setTimeout(() => setSortOpen(false), 150)} tabIndex={0}>
            <span>Sort: <b>{sortBy}</b></span><ChevronDown size={14} className={sortOpen ? 'chevron-up' : ''} />
            {sortOpen && (
              <div className="filter-dropdown sort-dropdown" onClick={(e) => e.stopPropagation()}>
                {sortOptions.map((opt) => <button key={opt} className={sortBy === opt ? 'active' : ''} onClick={() => { setSortBy(opt); setSortOpen(false); }}>{opt}{sortBy === opt && <Check size={13} />}</button>)}
              </div>
            )}
          </div>
          <div className="period-group">{['7D', '30D', '90D', '1Y'].map((p) => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{p}</button>)}</div>
        </div>
      </div>

      <div className="filter-row">
        <div className="filter-label"><SlidersHorizontal size={15} /> Filters</div>
        <FilterDropdown label="Performance" options={performanceFilters} value={filters.performance} onChange={(v) => setFilters({ ...filters, performance: v })} />
        <FilterDropdown label="Risk" options={riskFilters} value={filters.risk} onChange={(v) => setFilters({ ...filters, risk: v })} />
        <FilterDropdown label="Strategy" options={strategyFilters} value={filters.strategy} onChange={(v) => setFilters({ ...filters, strategy: v })} />
        <FilterDropdown label="Account Size" options={accountFilters} value={filters.account} onChange={(v) => setFilters({ ...filters, account: v })} />
        {(filters.performance !== 'all' || filters.risk !== 'all' || filters.strategy !== 'all' || filters.account !== 'all') && (
          <button className="filter-clear" onClick={() => setFilters({ performance: 'all', risk: 'all', strategy: 'all', account: 'all' })}>Clear all</button>
        )}
      </div>

      <EligibilityGate />

      <section className="featured-section">
        <div className="section-title">
          <div><span className="eyebrow">Featured strategy</span><h2>{nazarTrader.name} <VipBadge /></h2></div>
          <button className="text-button" onClick={() => onOpen(nazarTrader)}>View profile <ChevronRight size={15} /></button>
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
              <span><Users size={15} /> {nazarTrader.copiers} Copiers</span>
              <span><ShieldCheck size={15} /> {nazarTrader.risk} Risk</span>
              <span><LineChart size={15} /> {nazarTrader.activeMonths} month track record</span>
              <span><WalletCards size={15} /> {formatAccountSize(nazarTrader.accountSize)}</span>
            </div>
          </div>
          <div className="featured-performance">
            <div><span>7D</span><strong className="positive">{formatPercent(nazarTrader.roi7)}</strong></div>
            <div><span>30D</span><strong className="positive">{formatPercent(nazarTrader.roi30)}</strong></div>
            <div><span>90D</span><strong className="positive">{formatPercent(nazarTrader.roi90)}</strong></div>
            <div><span>Win Rate</span><strong>{nazarTrader.winRate}%</strong></div>
            <div><span>Max Drawdown</span><strong>{nazarTrader.drawdown}%</strong></div>
          </div>
          <div className="featured-copier-profit">
            <span>Copiers' Profit</span>
            <strong>{formatUsd(nazarTrader.copierProfit!)} USDT</strong>
          </div>
          <div className="featured-action"><PremiumEligibilityBlock compact /><CopyButton /><small>Requires $20,000 minimum deposit</small></div>
        </div>
      </section>

      <section className="marketplace-section">
        <div className="section-title">
          <div><span className="eyebrow">Curated strategies</span><h2>Professional Traders</h2></div>
          <span className="results-count">{visibleTraders.length} traders</span>
        </div>
        <div className="trader-grid">
          {pageTraders.map((trader) => <TraderCard key={trader.id} trader={trader} onOpen={onOpen} />)}
        </div>
        {visibleTraders.length === 0 && (
          <div className="empty-state"><Search size={22} /><strong>No traders found</strong><span>Try adjusting your search or filters.</span></div>
        )}
        {visibleTraders.length > 0 && (
          <div className="pagination">
            <span className="pagination-info">Showing {startIdx}-{endIdx} of {visibleTraders.length} traders</span>
            <div className="pagination-controls">
              <button className="page-button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /> Prev</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => <button key={p} className={`page-number ${p === currentPage ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>)}
              <button className="page-button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Next <ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
