import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import type { StockInstrument } from '../../lib/stocks';
import { useLanguage } from '../../lib/i18n';
import { changeTone, formatStockChange } from './stockFormat';
import { readOverviewQuery } from './stockModel';

/** Approved local assets only; anything else, or a failed image, falls back to letters. */
export function StockLogo({ instrument, size = 28 }: { instrument: StockInstrument; size?: number }) {
  const [failed, setFailed] = useState(false);
  const local = !failed && instrument.logoPath?.startsWith('/assets/stocks/');
  const letters = /^\d/.test(instrument.symbol)
    ? instrument.name.split(/\s+/).slice(0, 2).map(word => word[0] ?? '').join('').toUpperCase()
    : instrument.symbol.slice(0, 2).toUpperCase();
  return (
    <span className={`vxs-logo${instrument.type === 'index' ? ' is-index' : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {local ? <img src={instrument.logoPath!} width={size} height={size} loading="lazy" alt="" onError={() => setFailed(true)} />
        : instrument.type === 'index'
          ? <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 17l4-4 4 4 4-7 6 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          : letters}
    </span>
  );
}

export function FavoriteStar({ instrument, active, onToggle, size = 16 }: { instrument: StockInstrument; active: boolean; onToggle: (id: string) => void; size?: number }) {
  const { t } = useLanguage();
  const click = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); onToggle(instrument.instrumentId); };
  return (
    <button type="button" className="vxs-star" aria-pressed={active} onClick={click}
      aria-label={`${t(active ? 'stocks.removeFavorite' : 'stocks.addFavorite')}: ${instrument.symbol}`}>
      <Star size={size} strokeWidth={1.75} aria-hidden="true" fill={active ? 'currentColor' : 'none'} />
    </button>
  );
}

export function StockChange({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  return <span className={`vxs-change is-${changeTone(value)} ${className}`.trim()}>{formatStockChange(value)}</span>;
}

/** «Панель / Обзор» inside Stocks; never a new top-level navigation item. */
export function ViewSwitch({ view, panelTo }: { view: 'panel' | 'overview'; panelTo: string }) {
  const { t } = useLanguage();
  return (
    <nav className="vxs-view-switch" aria-label={t('stocks.view')}>
      <Link to={panelTo} aria-current={view === 'panel' ? 'page' : undefined}>{t('stocks.viewPanel')}</Link>
      <Link to={`/stocks?${readOverviewQuery()}`} aria-current={view === 'overview' ? 'page' : undefined}>{t('stocks.viewOverview')}</Link>
    </nav>
  );
}
