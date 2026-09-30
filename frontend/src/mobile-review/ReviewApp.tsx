import { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CandlestickChart, ChevronLeft, ChevronRight, Copy, Download, Globe2, LayoutGrid, LockKeyhole, Wallet } from 'lucide-react';
import { TerminalChart } from '../components/TerminalChart';
import { Logo } from '../components/Logo';
import { FuturesMarginLeverage } from '../components/FuturesMarginLeverage';
import { OrderFamilyTabs, OrderFamilyFields, type OrderFamily } from '../components/OrderFamilyPresentation';
import { PercentSlider } from '../components/PercentSlider';
import { formatPrice } from '../lib/formatNumber';
import { useLanguage } from '../lib/i18n';
import { fixtureCandles, fixtureMetrics, markets } from './fixtures';
import { useReviewActivity } from './lifecycle';
import { connectTelegram, createMockTelegram, mockTelegramLaunch, type TelegramWebApp } from './telegram';
import { usePwa } from './pwa';
import { tradingAllowed } from './policy';
import { reviewMessages } from './messages';

type Screen = 'Markets' | 'Futures' | 'Spot' | 'Positions' | 'Orders' | 'Wallet' | 'Copy Trading';
const mock = location.pathname.startsWith('/telegram') && new URLSearchParams(location.search).get('mock') === '1';
const telegram = location.pathname.startsWith('/telegram');
const host = window as Window & { Telegram?: { WebApp: TelegramWebApp }; __mobileReview?: unknown };
const sdk = telegram ? (mock ? createMockTelegram() : host.Telegram?.WebApp) : undefined;

function ReviewTicket({ futures, pair, disabled }: { futures: boolean; pair: string; disabled: boolean }) {
  const [family, setFamily] = useState<OrderFamily>('LIMIT');
  const [side, setSide] = useState('Buy / Long');
  const [percent, setPercent] = useState(0);
  const [margin, setMargin] = useState<'CROSS' | 'ISOLATED'>('CROSS');
  const [leverage, setLeverage] = useState(1);
  return <section className="review-ticket" aria-label="Order panel">
    <div className="review-section-heading"><h2>Order panel</h2><span>{pair}</span></div>
    {futures && <FuturesMarginLeverage marginType={margin} onMarginTypeChange={setMargin} leverage={leverage} onLeverageChange={setLeverage} min={1} max={null} warningThreshold={25} />}
    <div className="review-side">{['Buy / Long', 'Sell / Short'].map(value => <button key={value} aria-pressed={side === value} onClick={() => setSide(value)}>{value}</button>)}</div>
    <OrderFamilyTabs value={family} onChange={setFamily} />
    <div className="review-entry-fields"><OrderFamilyFields family={family} quote="USDT" includeLimit />
    <label className="review-size">Quantity <span>{pair.split('/')[0]}</span><input inputMode="decimal" placeholder="Enter amount" aria-label="Order quantity" /></label></div>
    <PercentSlider value={percent} onChange={setPercent} continuous />
    <div className="review-facts"><span>Available balance</span><strong>— USDT</strong><span>Estimated margin</span><strong>—</strong></div>
    <button className="review-submit" disabled={disabled}><LockKeyhole size={16} /> Trading locked</button>
    <p className="review-note">No verified account or authoritative balance. This draft is never submitted or stored.</p>
  </section>;
}

export function ReviewApp() {
  const [screen, setScreen] = useState<Screen>('Markets');
  const [pair, setPair] = useState('BTC/USDT');
  const [workspace, setWorkspace] = useState<'Chart' | 'Trade' | 'Account'>('Chart');
  const [query, setQuery] = useState('');
  const [launch, setLaunch] = useState<'loading' | 'review' | 'error'>(telegram ? 'loading' : 'review');
  const [launchError, setLaunchError] = useState('');
  const { active, online } = useReviewActivity(sdk);
  const pwa = usePwa(!telegram);
  const { setLang } = useLanguage();
  const back = useRef(() => { setScreen('Markets'); setWorkspace('Chart'); });
  useEffect(() => { setLang('en'); }, []);
  useEffect(() => {
    if (!telegram) return;
    let disposed = false;
    if (!sdk) { setLaunchError(reviewMessages.sdkUnavailable); setLaunch('error'); return; }
    const disconnect = connectTelegram(sdk, () => back.current());
    // Real initData is NEVER parsed as identity and is not sent anywhere in this branch.
    if (!mock) {
      setLaunchError(reviewMessages.realAuthUnavailable); setLaunch('error');
      return disconnect;
    }
    const result = mockTelegramLaunch(new URLSearchParams(location.search).has('invalid') ? 'invalid' : sdk.initData);
    result.then(() => { if (!disposed) setLaunch('review'); }).catch(() => {
      if (!disposed) { setLaunchError(reviewMessages.invalidMock); setLaunch('error'); }
    });
    return () => { disposed = true; disconnect(); };
  }, []);
  useEffect(() => { if (sdk) screen === 'Markets' ? sdk.BackButton.hide() : sdk.BackButton.show(); }, [screen]);
  useEffect(() => { host.__mobileReview = { sdk, fixtureMetrics, active, online, trustedIdentity: null }; }, [active, online]);
  const selected = markets.find(market => market.pair === pair)!;
  const canTrade = tradingAllowed({ online, active, authoritative: false, review: true });
  const terminal = screen === 'Futures' || screen === 'Spot';
  back.current = () => {
    if (terminal && workspace !== 'Chart') setWorkspace('Chart');
    else { setScreen('Markets'); setWorkspace('Chart'); }
  };
  const select = (next: Screen) => { setScreen(next); setWorkspace('Chart'); };
  const account = (title: string) => <section className="review-account"><LockKeyhole size={28} /><h2>{title}</h2><p>Account not connected</p><div className="review-facts"><span>{title === 'Positions' ? 'Unrealized P&L' : title === 'Wallet' ? 'Total balance' : 'Account state'}</span><strong>—</strong></div><p className="review-note">Account linking and financial actions are unavailable in this review. No account data is loaded or cached.</p></section>;

  return <div className="mobile-review" data-client={telegram ? 'telegram' : 'pwa'} data-active={active} data-standalone={pwa.installed}>
    <header className="review-header"><div className="review-brand"><Logo /><span className="review-client-name">{telegram ? 'MINI APP' : 'MOBILE'}</span></div><span className="review-local"><i />Local review</span></header>
    <div className="review-safety"><LockKeyhole size={13} /><span>Synthetic market data · Trading disabled</span></div>
    {pwa.update && <div className="review-alert" role="status">Update ready. Close all VOLTEX review windows and reopen when your draft is no longer needed. No automatic reload.</div>}
    {pwa.error && <div className="review-alert" role="status">{pwa.error}</div>}
    {!online && <div className="review-alert" role="alert">Offline · Account data unavailable. Trading locked.</div>}
    {!active && <section className="review-account" role="status"><h1>Paused</h1><p>Return to the app to resume. Your draft stays in this window.</p></section>}
    {launch === 'loading' ? <main role="status" className="review-account">Checking local launch…</main>
      : launch === 'error' ? <main className="review-account" role="alert"><LockKeyhole /><h1>Launch unavailable</h1><p>{launchError}</p><a href="/telegram?mock=1">Open local mock launch</a></main>
      : <main hidden={!active}>
        {screen === 'Markets' && <>
          <section className="review-intro"><span className="review-eyebrow">YOUR MARKETS, ANYWHERE</span><h1>Make your next move.</h1><p>One VOLTEX. A lighter mobile workspace.</p></section>
          <div className="review-shortcuts"><button onClick={() => select('Futures')}><CandlestickChart /><span>Futures</span><ChevronRight /></button><button onClick={() => select('Spot')}><ArrowDownLeft /><span>Spot</span><ChevronRight /></button></div>
          <section className="review-market-list"><div className="review-section-heading"><h2>Markets</h2><span>FIXTURES</span></div><input type="search" placeholder="Search assets" aria-label="Search assets" value={query} onChange={event => setQuery(event.target.value)} /><div className="review-market-labels"><span>Asset / Volume</span><span>Price / 24h</span></div>
            {markets.filter(market => market.pair.toLowerCase().includes(query.toLowerCase())).map((market, index) => <button className="review-market" key={market.pair} onClick={() => { setPair(market.pair); select('Futures'); }}>
              <span className={`review-coin coin-${index}`}>{market.pair.slice(0, 1)}</span><span><strong>{market.pair.split('/')[0]} <small>USDT</small></strong><small>Synthetic fixture</small></span><span><strong>{formatPrice(Number(market.lastPrice))}</strong><small className={Number(market.changePercent24h) > 0 ? 'review-up' : 'review-down'}>{Number(market.changePercent24h) > 0 ? '+' : ''}{market.changePercent24h}%</small></span><ChevronRight size={15} />
            </button>)}
          </section>
          <section className="review-install"><div><Download size={21} /><h2>{telegram ? 'Inside Telegram' : 'VOLTEX, one tap away'}</h2></div><p>{telegram ? 'Mock launch connected. Telegram identity is unverified; no VOLTEX account is linked.' : pwa.installed ? 'Running in standalone mode.' : 'Install from your browser menu. On iPhone: Share → Add to Home Screen.'}</p>{!telegram && pwa.canInstall && <button onClick={() => void pwa.prompt()}>Install VOLTEX</button>}</section>
        </>}
        {terminal && <>
          <section className="review-terminal-heading"><button aria-label="Back to Markets" onClick={() => select('Markets')}><ChevronLeft /></button><div><h1>{pair}</h1><span>{screen === 'Futures' ? 'Perpetual' : 'Spot'} · Synthetic fixture</span></div><div><strong>{online ? formatPrice(Number(selected.lastPrice)) : '—'}</strong><span className={Number(selected.changePercent24h) > 0 ? 'review-up' : 'review-down'}>{online ? `${selected.changePercent24h}%` : 'Offline'}</span></div></section>
          <div className="review-workspace" role="tablist" aria-label="Trading workspace">{(['Chart', 'Trade', 'Account'] as const).map(tab => <button role="tab" key={tab} aria-selected={workspace === tab} onClick={() => setWorkspace(tab)}>{tab}</button>)}</div>
          {workspace === 'Chart' && <><div className="review-chart trade-terminal">{online && active ? <TerminalChart pair={pair} market="futures" tradingView={false} compactTools candleLoader={fixtureCandles} /> : <div className="review-account">{online ? 'Chart paused' : 'Chart unavailable offline'}</div>}</div><button className="review-open-ticket" onClick={() => setWorkspace('Trade')}>Open order panel <ArrowUpRight size={18} /></button><div className="review-account-tabs"><button onClick={() => select('Positions')}>Positions</button><button onClick={() => select('Orders')}>Orders</button></div><p className="review-note review-padding">Unrealized P&L <strong>—</strong> · Account not connected</p></>}
          {workspace === 'Trade' && <ReviewTicket key={`${screen}:${pair}`} futures={screen === 'Futures'} pair={pair} disabled={!canTrade} />}
          {workspace === 'Account' && <><div className="review-account-tabs"><button onClick={() => select('Positions')}>Positions</button><button onClick={() => select('Orders')}>Orders</button></div>{account('Positions')}</>}
        </>}
        {(screen === 'Positions' || screen === 'Orders' || screen === 'Wallet') && account(screen)}
        {screen === 'Wallet' && <div className="review-wallet-actions"><button disabled>Deposit</button><button disabled>Withdraw</button><button disabled>Transfer</button></div>}
        {screen === 'Copy Trading' && <section className="review-account"><Copy size={30} /><h1>Copy Trading</h1><p>Discover strategies in your VOLTEX account.</p><div className="review-facts"><span>Account performance</span><strong>—</strong><span>Allocated balance</span><strong>—</strong></div><p className="review-note">No traders, returns or account state are fabricated. Connect to a verified environment after launch approval.</p><button disabled className="review-submit">Account linking unavailable</button></section>}
      </main>}
    <nav className="review-nav" aria-label="Mobile navigation">{([['Markets', Globe2], ['Futures', CandlestickChart], ['Spot', LayoutGrid], ['Wallet', Wallet], ['Copy Trading', Copy]] as const).map(([name, Icon]) => <button key={name} onClick={() => select(name)} aria-current={screen === name ? 'page' : undefined}><Icon size={20} /><span>{name === 'Copy Trading' ? 'Copy' : name}</span></button>)}</nav>
  </div>;
}
