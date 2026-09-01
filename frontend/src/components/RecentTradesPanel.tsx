import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { krakenSocket } from '../lib/krakenSocket';

interface Trade {
  id: string;
  price: string;
  quantity: string;
  side: 'BUY' | 'SELL';
  time: number;
}

const MAX_TRADES = 60;
const WS_FALLBACK_TIMEOUT_MS = 4000;

/**
 * The reference's `.trades-section`: a header, three column headers, and a
 * live tape of `.trade-row`s that fade in as prints arrive.
 *
 * The data path is unchanged — Kraken's public WebSocket with a REST poll
 * as a fallback when the socket delivers nothing.
 */
export function RecentTradesPanel({ pair }: { pair: string }) {
  const { t, lang } = useLanguage();
  const [trades, setTrades] = useState<Trade[]>([]);
  // trades.length === 0 is ambiguous (still loading vs. genuinely no recent
  // trades for this pair) — a separate flag is the only honest way to tell
  // "loading" apart from "loaded, empty" and pick the right placeholder.
  const [loading, setLoading] = useState(true);
  const [, quoteAsset] = pair.split('/');
  const [baseAsset] = pair.split('/');

  useEffect(() => {
    setTrades([]);
    setLoading(true);
    let gotWsData = false;
    let restInterval: number | null = null;

    async function loadRest() {
      try {
        const res = await api.getExternalTrades(pair, MAX_TRADES);
        if (!gotWsData) setTrades(res.trades);
      } catch {
        // stays whatever it was — background poll, not worth an error state
      } finally {
        setLoading(false);
      }
    }

    const unsubscribe = krakenSocket.subscribeTrades(pair, (trade) => {
      gotWsData = true;
      setLoading(false);
      if (restInterval !== null) {
        clearInterval(restInterval);
        restInterval = null;
      }
      setTrades((prev) => [trade, ...prev].slice(0, MAX_TRADES));
    });

    loadRest();
    const fallbackTimer = window.setTimeout(() => {
      if (!gotWsData) restInterval = window.setInterval(loadRest, 2000);
    }, WS_FALLBACK_TIMEOUT_MS);

    return () => {
      unsubscribe();
      clearTimeout(fallbackTimer);
      if (restInterval !== null) clearInterval(restInterval);
    };
  }, [pair]);

  return (
    <div className="trades-section">
      <div className="trades-header">{t('trade.marketTrades')}</div>
      <div className="trades-col-headers">
        <span className="ob-col">{`${t('trade.price')}(${quoteAsset})`}</span>
        <span className="ob-col">{`${t('trade.quantity')}(${baseAsset})`}</span>
        <span className="ob-col">{t('trade.time')}</span>
      </div>
      <div className="trades-list">
        {trades.map((tr) => (
          <div key={tr.id} className="trade-row">
            <span className={`t-price ${tr.side === 'BUY' ? 'buy' : 'sell'}`}>{parseFloat(tr.price).toFixed(2)}</span>
            <span className="t-amount">{parseFloat(tr.quantity).toFixed(5)}</span>
            <span className="t-time">
              {new Date(tr.time).toLocaleTimeString(localeOf(lang), {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </div>
        ))}
        {trades.length === 0 && !loading && <div className="empty-state">{t('trade.noTrades')}</div>}
      </div>
    </div>
  );
}
