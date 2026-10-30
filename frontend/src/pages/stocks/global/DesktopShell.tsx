import { LanguageSwitcher } from '../../../components/LanguageSwitcher';
import { useStocksText } from './useStocksText';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import BigNumber from 'bignumber.js';
import { quoteAge } from './tradeMarkers';
import type { Asset, Candle, Currency, Fill, Quote } from './types';

// One Intl.NumberFormat per locale and precision: toLocaleString with options builds a new one on every call, and
// these numbers re-render with the terminal's 1 s clock. Same output (toLocaleString is this formatter).
const numberFormats = new Map<string, Intl.NumberFormat>();
const formatNumber = (locale: string, value: string | number | null | undefined, digits = 2) => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const key = locale + '|' + digits;
  let format = numberFormats.get(key);
  if (!format) numberFormats.set(key, format = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }));
  return format.format(Number(value));
};

export function allocationQuantity(available: string, price: string, side: 'BUY' | 'SELL', percent: number) {
  const balance = new BigNumber(available), unit = new BigNumber(price);
  if (!balance.isFinite() || balance.lt(0) || !Number.isFinite(percent) || percent < 0 || percent > 100 ||
      (side === 'BUY' && (!unit.isFinite() || unit.lte(0)))) return null;
  return (side === 'BUY' ? balance.div(unit) : balance).times(percent).div(100).toFixed(8, BigNumber.ROUND_DOWN);
}

export function DesktopAllocation({ available, price, side, quantity, onChange }: {
  available: string; price: string; side: 'BUY' | 'SELL'; quantity: string; onChange: (value: string) => void;
}) {
  const {s}=useStocksText();
  const maximum = allocationQuantity(available, price, side, 100);
  const capacity = new BigNumber(maximum || 0), amount = new BigNumber(quantity || 0);
  const percent = capacity.gt(0) && amount.isFinite() ? Math.max(0, Math.min(100, amount.div(capacity).times(100).toNumber())) : 0;
  const choose = (value: number) => { const next = allocationQuantity(available, price, side, value); if (next != null) onChange(next); };
  return <div className="vxg-desktop-only vxg-pro-allocation">
    <input type="range" min="0" max="100" step="1" value={percent} disabled={!capacity.gt(0)}
      aria-label={side === 'BUY' ? s("Доля доступного баланса") : s("Доля доступной позиции")}
      onChange={event => choose(Number(event.target.value))}/>
    <div>{[0, 25, 50, 75, 100].map(value => <button type="button" key={value} disabled={!capacity.gt(0)}
      onClick={() => choose(value)}>{value}%</button>)}</div>
  </div>;
}

export function DesktopHeader({ currency, onMarkets, onPortfolio, onHistory, onWallet }: {
  currency: Currency; onMarkets: () => void; onPortfolio: () => void;
  onHistory: () => void; onWallet: () => void;
}) {
  const {s}=useStocksText();
  return <header className="vxg-desktop-only vxg-pro-nav">
    <Link to="/" className="vxg-pro-brand" aria-label={s("VOLTEX — главная")}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M13 2 24 13 13 24 2 13Z M13 7 19 13 13 19 7 13Z" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
      <span>VOLTEX</span>
    </Link>
    <nav aria-label={s("Навигация Stocks")}>
      <button onClick={onMarkets}>{s("Рынки")}</button>
      <span>{s("Торговля")}</span>
      <button className="selected" onClick={onMarkets}>{s("Акции")}</button>
      <button onClick={onPortfolio}>{s("Портфель")}</button>
      <button onClick={onHistory}>{s("История")}</button>
    </nav>
    <span className="vxg-pro-label">VOLTEX Professional</span>
    <span className="vxg-pro-settlement">{currency}</span>
    <button className="vxg-pro-wallet" onClick={onWallet}>{s("Параметры счёта")}</button>
    <span className="vxg-language" style={{flex:'0 0 32px',position:'relative',zIndex:70}}><LanguageSwitcher /></span>
  </header>;
}

export function DesktopMarketStats({ asset, quote, candles, ready, now }: {
  asset?: Asset; quote?: Quote; candles: Candle[]; ready: boolean; now: number;
}) {
  const {s,lang,locale}=useStocksText();
  const number=(value:string|number|null|undefined,digits=2)=>formatNumber(locale,value,digits);
  const highs = candles.map(c => c.high).filter(Number.isFinite);
  const lows = candles.map(c => c.low).filter(Number.isFinite);
  return <>
    <div className="vxg-desktop-only vxg-pro-extreme"><small>{s("Макс. на графике")}</small><span>{highs.length ? number(Math.max(...highs)) : '—'}</span></div>
    <div className="vxg-desktop-only vxg-pro-extreme"><small>{s("Мин. на графике")}</small><span>{lows.length ? number(Math.min(...lows)) : '—'}</span></div>
    <div className="vxg-desktop-only vxg-pro-feed">
      <span className={ready ? 'up' : 'vxg-pro-muted'}>● {ready ? s("Котировка актуальна") : s("Исполнение ожидает данных")}</span>
      <small>{quoteAge(quote?.timestamp, now, lang)}{asset?.delaySeconds ? s(" · задержка {value0} мин", {value0: asset.delaySeconds / 60}) : ''}</small>
    </div>
  </>;
}

/** A presentation of the existing top-of-book quote; never synthesize depth. */
export function DesktopQuotes({ asset, quote, fills, now, ready }: {
  asset?: Asset; quote?: Quote; fills: Fill[]; now: number; ready: boolean;
}) {
  const {s,lang,locale}=useStocksText();
  const number=(value:string|number|null|undefined,digits=2)=>formatNumber(locale,value,digits);
  const [tab, setTab] = useState<'quote' | 'fills'>('quote');
  const executions = fills.filter(fill => fill.instrumentId === asset?.id).slice(-20).reverse();
  return <aside className="vxg-desktop-only vxg-pro-quotes" aria-label={s("Котировки")}>
    <div className="vxg-pro-panel-tabs">
      <button className={tab === 'quote' ? 'selected' : ''} onClick={() => setTab('quote')}>{s("Котировки")}</button>
      <button className={tab === 'fills' ? 'selected' : ''} onClick={() => setTab('fills')}>{s("Сделки")}</button>
    </div>
    {tab === 'quote' ? <>
      <div className="vxg-pro-book-tools"><span aria-hidden="true">▥ ▤ ▥</span><span>Bid / Ask</span></div>
      <div className="vxg-pro-book-labels"><span>{s("Цена,")} {asset?.currency || '—'}</span><span>{s("Объём")}</span></div>
      <div className="vxg-pro-book-side"><small>{s("Лучшая продажа · Ask")}</small><div className="down"><strong>{number(quote?.ask, 6)}</strong><span>{number(quote?.askSize, 8)}</span></div></div>
      <div className="vxg-pro-mid"><strong className={quote?.change24h != null && quote.change24h < 0 ? 'down' : 'up'}>{number(quote?.last, 6)}</strong><small>{asset?.currency || '—'}</small></div>
      <div className="vxg-pro-book-side"><small>{s("Лучшая покупка · Bid")}</small><div className="up"><strong>{number(quote?.bid, 6)}</strong><span>{number(quote?.bidSize, 8)}</span></div></div>
      {!quote?.bidSize&&!quote?.askSize&&<p className="vxg-pro-depth-note">{s("Доступна верхняя котировка. Глубина рынка и объёмы заявок не предоставлены.")}</p>}
      <dl className="vxg-pro-provenance"><dt>{s("Источник")}</dt><dd>{asset?.provider.toUpperCase() || '—'}</dd><dt>{s("Инструмент")}</dt><dd>{asset?.sourceSymbol || '—'}</dd><dt>{s("Валюта цены")}</dt><dd>{asset?.currency || '—'}</dd></dl>
    </> : <div className="vxg-pro-executions"><small>{asset?.asset || '—'}</small>{executions.length ? executions.map(fill => <article key={fill.id}>
      <span className={fill.side === 'BUY' ? 'up' : 'down'}>{fill.side === 'BUY' ? '↑' : '↓'} {number(fill.nativePrice, 6)}<small>{asset?.currency}</small></span>
      <span>{number(fill.quantity, 8)}<small>{new Date(fill.timestamp).toLocaleTimeString(locale)}</small></span>
    </article>) : <p className="vxg-empty">{s("Сделок по инструменту пока нет")}</p>}</div>}
    <footer><span className={ready ? 'up' : 'vxg-pro-muted'}>● {ready ? s("Источник доступен") : s("Нет свежих данных")}</span><small>{quoteAge(quote?.timestamp, now, lang)}</small></footer>
  </aside>;
}

export function DesktopFooter({ asset, ready, connected }: { asset?: Asset; ready: boolean; connected: boolean }) {
  const {s}=useStocksText();
  return <footer className="vxg-desktop-only vxg-pro-footer">
    <span className={ready ? 'up' : 'vxg-pro-muted'}>● {ready ? s("Рыночные данные доступны") : connected ? s("Ожидание свежей котировки") : s("Локальный сервис недоступен")}</span>
    <span>VOLTEX Professional</span>
    <span>{asset?.provider.toUpperCase()} · {asset?.sourceSymbol} · {asset?.currency}</span>
  </footer>;
}
