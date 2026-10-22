import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeftRight, BarChart3, BookOpen, BookOpenText, ChartCandlestick, ChevronDown, CircleHelp, GraduationCap, Handshake, Route, SlidersHorizontal, TrendingUp, type LucideIcon } from 'lucide-react';
import { Key, useLanguage } from '../lib/i18n';
import './HeaderDropdown.css';

export interface HeaderDropdownItem {
  to: string;
  label: Key;
  icon: LucideIcon;
  description: Key;
}

declare const __VOLTEX_STOCKS_ENABLED__: boolean;
const stocksEnabled = typeof __VOLTEX_STOCKS_ENABLED__ !== 'undefined' && __VOLTEX_STOCKS_ENABLED__;

export const TRADING_LINKS: readonly HeaderDropdownItem[] = [
  { to: '/trade', label: 'trade.spotTab', icon: ArrowLeftRight, description: 'nav.tradeSpotDesc' },
  { to: '/futures', label: 'nav.futures', icon: TrendingUp, description: 'dashboard.quickLinkFuturesDesc' },
  { to: '/trade?market=cfd', label: 'trade.cfdTab', icon: ChartCandlestick, description: 'nav.tradeCfdDesc' },
  ...(stocksEnabled ? [{ to: '/stocks', label: 'stocks.title' as Key, icon: BarChart3, description: 'stocks.closed' as Key }] : []),
];
export const MARKET_LINKS: readonly HeaderDropdownItem[] = [
  { to: '/tools', label: 'nav.tools', icon: SlidersHorizontal, description: 'nav.menuToolsDesc' },
];
export const OTC_LINKS: readonly HeaderDropdownItem[] = [
  { to: '/otc', label: 'nav.otc', icon: Handshake, description: 'nav.menuOtcDesc' },
  { to: '/arbitrage', label: 'nav.arbitrage', icon: Route, description: 'nav.menuArbitrageDesc' },
];
export const KNOWLEDGE_LINKS: readonly HeaderDropdownItem[] = [
  { to: '/academy/learn', label: 'academy.hub.learn', icon: GraduationCap, description: 'nav.menuLearnDesc' },
  { to: '/academy/knowledge', label: 'academy.hub.knowledge', icon: BookOpen, description: 'nav.menuKnowledgeDesc' },
  { to: '/academy/faq', label: 'help.tab.faq', icon: CircleHelp, description: 'nav.menuFaqDesc' },
  { to: '/academy/glossary', label: 'academy.glossary', icon: BookOpenText, description: 'nav.menuGlossaryDesc' },
];

/** A direct section link and a separate, keyboard/touch accessible disclosure. */
export function HeaderDropdown({ to, label, links, className, mobile = false, onNavigate }: {
  to: string; label: string; links: readonly HeaderDropdownItem[];
  className: string; mobile?: boolean; onNavigate?: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  const navigate = () => { setOpen(false); onNavigate?.(); };
  return <div className={`header-disclosure${mobile ? ' header-disclosure-mobile' : ''}`}
    onMouseEnter={() => !mobile && setOpen(true)} onMouseLeave={() => !mobile && setOpen(false)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); toggle.current?.focus(); } }}>
    <div className="header-disclosure-heading">
      <Link to={to} className={className} onClick={navigate}>{label}</Link>
      <button ref={toggle} type="button" className="header-disclosure-toggle" aria-label={label}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        <ChevronDown size={12} className={open ? 'nav-chevron-open' : undefined}/>
      </button>
    </div>
    {open && <div id={id} className="header-disclosure-panel" aria-label={label}>
      {links.map(({ icon: Icon, ...link }) => <Link key={link.to} to={link.to} onClick={navigate} className="header-menu-card">
        <span className="header-menu-icon" aria-hidden="true"><Icon size={19} strokeWidth={1.7}/></span>
        <span className="header-menu-copy"><span className="header-menu-title">{t(link.label)}</span>
          <span className="header-menu-description">{t(link.description)}</span></span>
      </Link>)}
    </div>}
  </div>;
}
