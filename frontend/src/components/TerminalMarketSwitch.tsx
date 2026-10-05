import { Link } from 'react-router-dom';
import { useLanguage } from '../lib/i18n';
import { marketDataStore } from '../lib/marketDataStore';
import { readFuturesSymbolCache } from '../lib/terminalWarmCache';
import { futuresSwitchHref, spotSwitchHref, type TerminalMarket } from '../lib/terminalMarketSwitch';

/**
 * The phone header's two-position «Спот / Фьючерсы» switch.
 *
 * Two plain links to the two existing routes — never both terminals mounted.
 * Each target is worked out from what the browser already holds (the Futures
 * symbol warm cache, the Spot snapshot in the shared market store); nothing
 * is fetched to draw it. Shown by CSS on phones only; desktop keeps its menu.
 */
export function TerminalMarketSwitch({ current, pair }: { current: TerminalMarket; pair: string }) {
  const { t } = useLanguage();
  const spotState = current === 'futures' ? marketDataStore.getState() : null;
  const spotListed = spotState?.tickersMeta ? new Set(spotState.tickers.keys()) : null;
  const items: { market: TerminalMarket; label: string; to: string }[] = [
    { market: 'spot', label: t('trade.spotTab'), to: current === 'spot' ? `/trade?pair=${encodeURIComponent(pair)}` : spotSwitchHref(pair, spotListed) },
    { market: 'futures', label: t('nav.futures'), to: current === 'futures' ? `/futures?pair=${encodeURIComponent(pair)}` : futuresSwitchHref(pair, readFuturesSymbolCache()) },
  ];
  return (
    <nav className="terminal-market-switch" aria-label={t('terminal.marketSwitch')}>
      {items.map(item => item.market === current
        ? <span key={item.market} className="terminal-market-option is-active" aria-current="page">{item.label}</span>
        : <Link key={item.market} className="terminal-market-option" to={item.to} data-market-switch={item.market}>{item.label}</Link>)}
    </nav>
  );
}
