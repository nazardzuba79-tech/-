import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Key, useLanguage } from '../lib/i18n';
import './HeaderDropdown.css';

export const TRADING_LINKS: ReadonlyArray<{ to: string; label: Key }> = [
  { to: '/trade', label: 'trade.spotTab' },
  { to: '/trade?market=cfd', label: 'trade.cfdTab' },
];
export const MARKET_LINKS: ReadonlyArray<{ to: string; label: Key }> = [
  { to: '/tools', label: 'nav.tools' },
];
export const KNOWLEDGE_LINKS: ReadonlyArray<{ to: string; label: Key }> = [
  { to: '/academy/learn', label: 'academy.hub.learn' },
  { to: '/academy/knowledge', label: 'academy.hub.knowledge' },
  { to: '/academy/faq', label: 'help.tab.faq' },
  { to: '/academy/glossary', label: 'academy.glossary' },
];

/** A direct section link and a separate, keyboard/touch accessible disclosure. */
export function HeaderDropdown({ to, label, links, className, mobile = false, onNavigate }: {
  to: string; label: string; links: ReadonlyArray<{ to: string; label: Key }>;
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
      {links.map(link => <Link key={link.to} to={link.to} onClick={navigate}>{t(link.label)}</Link>)}
    </div>}
  </div>;
}
