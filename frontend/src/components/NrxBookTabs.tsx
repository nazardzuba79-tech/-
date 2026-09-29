import { browserSetInterval, browserClearInterval, isBrowserInactive } from '../lib/browserActivity';
import { cloneElement, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { fetchNrxPublic } from '../lib/nrxMarket';
import { formatSpotBookNumber } from '../lib/spotOrderBook';
import { localeOf, useLanguage } from '../lib/i18n';
import './NrxBookTabs.css';

type Trade = { id: string; price: string; quantity: string; side: 'BUY' | 'SELL'; timestamp: number };

/** Public tape only (NRX and published managed listings). Never calls account APIs or inserts an execution. */
export function NrxBookTabs({ enabled, live, children, pair = 'NRX/USDT' }: { enabled: boolean; live: boolean; children: ReactElement<{ headerTitle?: ReactNode }>; pair?: string }) {
  const base = pair.split('/')[0];
  const { t, lang } = useLanguage();
  const [tab, setTab] = useState<'book' | 'trades'>('book');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    setTrades([]); setError(false);
    if (!enabled || !live || tab !== 'trades') return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || isBrowserInactive()) return;
      pending = true;
      try {
        const body = await fetchNrxPublic<{ pair: string; trades: Trade[] }>(`/market/external/trades/${pair.replace('/', '-')}`, controller.signal);
        if (body.pair !== pair || !Array.isArray(body.trades)) throw new Error('invalid_tape');
        if (!controller.signal.aborted) { setTrades(body.trades); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { pending = false; }
    };
    void refresh();
    const timer = browserSetInterval(() => void refresh(), 10_000);
    return () => { controller.abort(); browserClearInterval(timer); };
  }, [enabled, live, tab, pair]);
  if (!enabled) return <>{children}</>;
  const tabs = <div className="nrx-book-tabs-bar" role="tablist" aria-label={t('trade.marketTrades')}>
      <button type="button" role="tab" aria-selected={tab === 'book'} onClick={() => setTab('book')}>{t('trade.orderBook')}</button>
      <button type="button" role="tab" aria-selected={tab === 'trades'} onClick={() => setTab('trades')}>{t('trade.trades')}</button>
    </div>;
  return <div className="nrx-book-tabs">
    {tab === 'book' ? cloneElement(children, { headerTitle: tabs }) : <>
    <div className="orderbook-header">{tabs}</div>
    <div className="nrx-tape" role="tabpanel" aria-label={`${t('trade.trades')} ${base}`}>
      <div className="nrx-tape-row nrx-tape-labels"><span>{t('trade.price')} (USDT)</span><span>{t('trade.quantity')} ({base})</span><span>{t('trade.time')}</span></div>
      {error && <div role="status">Данные временно недоступны</div>}
      {!trades.length && <div className="nrx-tape-empty">—</div>}
      {trades.map(trade => <div className="nrx-tape-row" key={trade.id}>
        <span className={trade.side === 'BUY' ? 'positive' : 'negative'}>{formatSpotBookNumber(Number(trade.price))}</span>
        <span>{formatSpotBookNumber(Number(trade.quantity))}</span>
        <time dateTime={new Date(trade.timestamp).toISOString()}>{new Date(trade.timestamp).toLocaleTimeString(localeOf(lang))}</time>
      </div>)}
    </div></>}
  </div>;
}
