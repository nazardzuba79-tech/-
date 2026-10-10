import { useState } from 'react';
import { Link } from 'react-router-dom';
import BigNumber from 'bignumber.js';
import { quoteAge } from './tradeMarkers';
import type { Asset, Candle, Currency, Fill, Quote } from './types';

const number = (value: string | number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(Number(value)) ? '—' :
    Number(value).toLocaleString('ru-RU', { maximumFractionDigits: digits });

export function allocationQuantity(available: string, price: string, side: 'BUY' | 'SELL', percent: number) {
  const balance = new BigNumber(available), unit = new BigNumber(price);
  if (!balance.isFinite() || balance.lt(0) || !Number.isFinite(percent) || percent < 0 || percent > 100 ||
      (side === 'BUY' && (!unit.isFinite() || unit.lte(0)))) return null;
  return (side === 'BUY' ? balance.div(unit) : balance).times(percent).div(100).toFixed(8, BigNumber.ROUND_DOWN);
}

export function DesktopAllocation({ available, price, side, quantity, onChange }: {
  available: string; price: string; side: 'BUY' | 'SELL'; quantity: string; onChange: (value: string) => void;
}) {
  const maximum = allocationQuantity(available, price, side, 100);
  const capacity = new BigNumber(maximum || 0), amount = new BigNumber(quantity || 0);
  const percent = capacity.gt(0) && amount.isFinite() ? Math.max(0, Math.min(100, amount.div(capacity).times(100).toNumber())) : 0;
  const choose = (value: number) => { const next = allocationQuantity(available, price, side, value); if (next != null) onChange(next); };
  return <div className="vxg-desktop-only vxg-pro-allocation">
    <input type="range" min="0" max="100" step="1" value={percent} disabled={!capacity.gt(0)}
      aria-label={side === 'BUY' ? 'Доля доступного баланса' : 'Доля доступной позиции'}
      onChange={event => choose(Number(event.target.value))}/>
    <div>{[0, 25, 50, 75, 100].map(value => <button type="button" key={value} disabled={!capacity.gt(0)}
      onClick={() => choose(value)}>{value}%</button>)}</div>
  </div>;
}

export function DesktopHeader({ currency, onMarkets, onPortfolio, onHistory, onWallet }: {
  currency: Currency; onMarkets: () => void; onPortfolio: () => void;
  onHistory: () => void; onWallet: () => void;
}) {
  return <header className="vxg-desktop-only vxg-pro-nav">
    <Link to="/" className="vxg-pro-brand" aria-label="VOLTEX — главная">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M13 2 24 13 13 24 2 13Z M13 7 19 13 13 19 7 13Z" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
      <span>VOLTEX</span>
    </Link>
    <nav aria-label="Навигация Stocks">
      <button onClick={onMarkets}>Рынки</button>
      <span>Торговля</span>
      <button className="selected" onClick={onMarkets}>Акции</button>
      <button onClick={onPortfolio}>Портфель</button>
      <button onClick={onHistory}>История</button>
    </nav>
    <span className="vxg-pro-label">VOLTEX Professional</span>
    <span className="vxg-pro-settlement">{currency}</span>
    <button className="vxg-pro-wallet" onClick={onWallet}>Тестовый кошелёк</button>
  </header>;
}

export function DesktopMarketStats({ asset, quote, candles, ready, now }: {
  asset?: Asset; quote?: Quote; candles: Candle[]; ready: boolean; now: number;
}) {
  const highs = candles.map(c => c.high).filter(Number.isFinite);
  const lows = candles.map(c => c.low).filter(Number.isFinite);
  return <>
    <div className="vxg-desktop-only vxg-pro-extreme"><small>Макс. на графике</small><span>{highs.length ? number(Math.max(...highs)) : '—'}</span></div>
    <div className="vxg-desktop-only vxg-pro-extreme"><small>Мин. на графике</small><span>{lows.length ? number(Math.min(...lows)) : '—'}</span></div>
    <div className="vxg-desktop-only vxg-pro-feed">
      <span className={ready ? 'up' : 'vxg-pro-muted'}>● {ready ? 'Котировка актуальна' : 'Исполнение ожидает данных'}</span>
      <small>{quoteAge(quote?.timestamp, now)}{asset?.delaySeconds ? ` · задержка ${asset.delaySeconds / 60} мин` : ''}</small>
    </div>
  </>;
}

/** A presentation of the existing top-of-book quote; never synthesize depth. */
export function DesktopQuotes({ asset, quote, fills, now, ready }: {
  asset?: Asset; quote?: Quote; fills: Fill[]; now: number; ready: boolean;
}) {
  const [tab, setTab] = useState<'quote' | 'fills'>('quote');
  const executions = fills.filter(fill => fill.instrumentId === asset?.id).slice(-20).reverse();
  return <aside className="vxg-desktop-only vxg-pro-quotes" aria-label="Котировки и тестовые сделки">
    <div className="vxg-pro-panel-tabs">
      <button className={tab === 'quote' ? 'selected' : ''} onClick={() => setTab('quote')}>Котировки</button>
      <button className={tab === 'fills' ? 'selected' : ''} onClick={() => setTab('fills')}>Сделки</button>
    </div>
    {tab === 'quote' ? <>
      <div className="vxg-pro-book-tools"><span aria-hidden="true">▥ ▤ ▥</span><span>Bid / Ask</span></div>
      <div className="vxg-pro-book-labels"><span>Цена, {asset?.currency || '—'}</span><span>Объём</span></div>
      <div className="vxg-pro-book-side"><small>Лучшая продажа · Ask</small><div className="down"><strong>{number(quote?.ask, 6)}</strong><span>—</span></div></div>
      <div className="vxg-pro-mid"><strong className={quote?.change24h != null && quote.change24h < 0 ? 'down' : 'up'}>{number(quote?.last, 6)}</strong><small>{asset?.currency || '—'}</small></div>
      <div className="vxg-pro-book-side"><small>Лучшая покупка · Bid</small><div className="up"><strong>{number(quote?.bid, 6)}</strong><span>—</span></div></div>
      <p className="vxg-pro-depth-note">Доступна верхняя котировка. Глубина рынка и объёмы заявок не предоставлены.</p>
      <dl className="vxg-pro-provenance"><dt>Источник</dt><dd>{asset?.provider.toUpperCase() || '—'}</dd><dt>Инструмент</dt><dd>{asset?.sourceSymbol || '—'}</dd><dt>Валюта цены</dt><dd>{asset?.currency || '—'}</dd></dl>
    </> : <div className="vxg-pro-executions"><small>Ваши тестовые сделки · {asset?.asset || '—'}</small>{executions.length ? executions.map(fill => <article key={fill.id}>
      <span className={fill.side === 'BUY' ? 'up' : 'down'}>{fill.side === 'BUY' ? '↑' : '↓'} {number(fill.nativePrice, 6)}<small>{asset?.currency}</small></span>
      <span>{number(fill.quantity, 8)}<small>{new Date(fill.timestamp).toLocaleTimeString('ru-RU')}</small></span>
    </article>) : <p className="vxg-empty">Сделок по инструменту пока нет</p>}</div>}
    <footer><span className={ready ? 'up' : 'vxg-pro-muted'}>● {ready ? 'Источник доступен' : 'Нет свежих данных'}</span><small>{quoteAge(quote?.timestamp, now)}</small></footer>
  </aside>;
}

export function DesktopFooter({ asset, ready, connected }: { asset?: Asset; ready: boolean; connected: boolean }) {
  return <footer className="vxg-desktop-only vxg-pro-footer">
    <span className={ready ? 'up' : 'vxg-pro-muted'}>● {ready ? 'Рыночные данные доступны' : connected ? 'Ожидание свежей котировки' : 'Локальный сервис недоступен'}</span>
    <span>VOLTEX Professional</span>
    <span>{asset?.provider.toUpperCase()} · {asset?.sourceSymbol} · {asset?.currency}</span>
  </footer>;
}
