import { useEffect, useState } from 'react';
import { ChevronDown, Command, LayoutTemplate } from 'lucide-react';
import { api } from '../../lib/api';
import { CryptoIcon } from '../../components/CryptoIcon';
import { formatCompact } from '../../lib/formatNumber';
import { formatTerminalQuote, formatTerminalSpreadPercent } from '../../lib/terminalExecution';
import { parseChangePercent } from '../../lib/priceChange';
import { useLanguage } from '../../lib/i18n';
import { terminalBookMetrics, type TerminalWorkspace } from '../../lib/terminalMarket';
import type { BookSnapshot } from '../../lib/krakenSocket';

type Ticker = Awaited<ReturnType<typeof api.getExternalTicker>>['ticker'];

export function MarketSpine({ pair, book, onOpenMarkets, workspace, onWorkspaceChange }: {
  pair: string; book: BookSnapshot; onOpenMarkets: () => void;
  workspace: TerminalWorkspace; onWorkspaceChange: (workspace: TerminalWorkspace) => void;
}) {
  const { t } = useLanguage();
  const [quote, setQuote] = useState<{ pair: string; ticker: Ticker } | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    setQuote(null);
    setStale(false);
    const load = () => {
      if (pending) return;
      pending = true;
      return api.getExternalTicker(pair).then(({ ticker }) => {
        if (active) { setQuote({ pair, ticker }); setStale(false); }
      }).catch(() => { if (active) setStale(true); }).finally(() => { pending = false; });
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pair]);
  const ticker = quote?.pair === pair ? quote.ticker : null;
  const change = ticker?.changePercent24h?.trim() && Number.isFinite(Number(ticker.changePercent24h)) ? parseChangePercent(ticker.changePercent24h, pair) : null;
  const price = ticker ? Number(ticker.lastPrice) : null;
  const positive = change !== null && change >= 0;
  const metrics = terminalBookMetrics(book.bids, book.asks);
  const [base, currency] = pair.split('/');
  const safePrice = (value: string | number | null | undefined) => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? formatTerminalQuote(Number(value)) : '—';
  return <section className="market-spine" aria-label="Market Spine">
    <button className="pair-identity" onClick={onOpenMarkets} aria-label={`${t('nav.markets')}: ${pair}`}>
      <CryptoIcon symbol={base} size={30} />
      <span className="identity-text"><strong>{pair}</strong><small>SPOT <span>VOLTEX</span></small></span><ChevronDown size={14} />
    </button>
    <div className="spine-price">
      <strong className={positive ? 'up' : change !== null ? 'down' : ''}>{safePrice(price)}</strong>
      <span className={`spine-change ${positive ? 'up' : change !== null ? 'down' : ''}`} title="Изменение за 24 часа; публичный review использует ближайшее закрытие 5-минутной свечи у границы периода.">
        {change !== null ? `${positive ? '+' : ''}${change.toFixed(2)}%` : '—'} <small>24h</small>
      </span>
      {stale && <small className="spine-stale" role="status">{ticker ? 'Обновление задерживается' : 'Нет котировок'}</small>}
    </div>
    <div className="spine-metrics">
      <Metric label={t('trade.high24h')} value={safePrice(ticker?.high24h)} />
      <Metric label={t('trade.low24h')} value={safePrice(ticker?.low24h)} />
      <Metric label={`24h ${base}`} value={ticker ? formatCompact(Number(ticker.volume24h)) : '—'} />
      <Metric label={`24h ${currency}`} value={ticker ? formatCompact(Number(ticker.quoteVolume24h)) : '—'} />
      <Metric label={t('trade.spread')} value={metrics.spread === null ? '—' : `${formatTerminalQuote(metrics.spread)} · ${formatTerminalSpreadPercent(metrics.spreadPercent!)}`} />
      <Metric label="Глубина ±0,5%" value={metrics.depth === null ? '—' : `${formatCompact(metrics.depth)} ${currency}`} title="Сумма доступных уровней публичного стакана в пределах ±0,5% от середины. Не полный объём рынка." />
    </div>
    <div className="workspace-controls">
      <button className="command-trigger" onClick={onOpenMarkets} aria-label="Командная панель" title="Поиск и команды · Ctrl/⌘ K"><Command size={16} /><kbd>⌘K</kbd></button>
      <label title="Рабочее пространство"><LayoutTemplate size={15} /><select aria-label="Рабочее пространство" value={workspace} onChange={e => onWorkspaceChange(e.target.value as TerminalWorkspace)}>
        <option value="standard">Standard</option><option value="chart">Chart focus</option><option value="flow">Flow</option>
      </select></label>
    </div>
  </section>;
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="spine-metric" title={title}><span>{label}</span><strong>{value}</strong></div>;
}
