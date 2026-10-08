import { useEffect, useRef, useState } from 'react';
import type { StockInstrument } from '../../lib/stocks';
import { useLanguage } from '../../lib/i18n';
import { FavoriteStar, StockLogo, ViewSwitch } from './StockParts';
import { StockFacts } from './StockFacts';
import { widgetLocale, widgetSymbol } from './stockWidgetCatalogue';
import './stockWidget.css';

const EMBED = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

/**
 * A disposable browsing context isolates the official script's timers/listeners
 * from VOLTEX. Removing it on switch/exit stops that context and its widget.
 * Messages concern script loading only: never read the provider frame/DOM/data.
 */
export function StockWidget({ instrumentId }: { instrumentId: string }) {
  const { t, lang } = useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const symbol = widgetSymbol(instrumentId);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    setFailed(false);
    if (!symbol || !visible || !host.current) return;
    const frame = document.createElement('iframe');
    frame.title = symbol + ' — TradingView';
    frame.className = 'vxs-tv-frame';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    const config = { autosize: true, symbol, interval: '15', timezone: 'Etc/UTC', theme: 'dark',
      style: '1', locale: widgetLocale(lang), allow_symbol_change: false, calendar: false,
      support_host: 'https://www.tradingview.com' };
    // Only an allowlisted symbol and fixed official URL reach this document.
    frame.srcdoc = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#0f1014}iframe{border:0}</style></head><body>'
      + '<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:calc(100% - 32px);width:100%"></div>'
      + '<div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank"><span style="color:#2962ff;font:13px Arial">Track all markets on TradingView</span></a></div>'
      + '<script src="' + EMBED + '" async onload="parent.postMessage({voltexWidget: &quot;script-loaded&quot;}, &quot;*&quot;)" onerror="parent.postMessage({voltexWidget: &quot;script-error&quot;}, &quot;*&quot;)">'
      + JSON.stringify(config) + '</script></div></body></html>';
    const deadline = window.setTimeout(() => setFailed(true), 20_000);
    const message = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
      if (event.data?.voltexWidget === 'script-loaded') { clearTimeout(deadline); }
      if (event.data?.voltexWidget === 'script-error') { clearTimeout(deadline); setFailed(true); }
    };
    window.addEventListener('message', message);
    host.current.appendChild(frame);
    return () => {
      clearTimeout(deadline);
      window.removeEventListener('message', message);
      frame.remove();
    };
  }, [symbol, lang, attempt, visible]);
  return <div className="vxs-tv" data-widget-symbol={symbol ?? ''}>
    <div ref={host} className="vxs-tv-host" />
    {(!symbol || failed) && <div className="vxs-tv-error" role="status">
      <p>{t(symbol ? 'stocks.widgetLoadError' : 'stocks.widgetUnavailable')}</p>
      {symbol && <button type="button" className="vxs-retry" onClick={() => setAttempt(n => n + 1)}>{t('stocks.retry')}</button>}
    </div>}
    <div className="vxs-tv-foot"><span>{t('stocks.widgetNotice')}</span>
      <button type="button" className="vxs-retry" onClick={() => setAttempt(n => n + 1)}>{t('stocks.retry')}</button>
    </div>
  </div>;
}

export function WidgetInstrumentView({ instrument, favorite, onToggleFavorite, listButton, panelTo }: {
  instrument: StockInstrument; favorite: boolean; onToggleFavorite: (id: string) => void; listButton: JSX.Element; panelTo: string;
}) {
  const { t } = useLanguage();
  const facts = <StockFacts instrument={instrument} latest={null} widgetMode />;
  return <>
    <section className="vxs-center" aria-label={instrument.name}>
      <div className="vxs-tile vxs-strip">
        {listButton}
        <div className="vxs-strip-id"><StockLogo instrument={instrument} size={28} />
          <div><h2>{instrument.symbol}</h2><span title={instrument.name}>{instrument.name}</span></div>
          <FavoriteStar instrument={instrument} active={favorite} onToggle={onToggleFavorite} />
        </div>
        <div className="vxs-strip-metric"><span className="vxs-label">TradingView</span><span>{t('stocks.widgetDelayed')}</span></div>
        <ViewSwitch view="panel" panelTo={panelTo} />
      </div>
      <div className="vxs-tile vxs-chart-tile"><StockWidget instrumentId={instrument.instrumentId} /></div>
      <details className="vxs-tile vxs-about"><summary>{t('stocks.about')}</summary>{facts}</details>
    </section>
    <aside className="vxs-tile vxs-facts-tile" aria-label={t('stocks.about')}><h2>{t('stocks.about')}</h2>{facts}</aside>
  </>;
}
