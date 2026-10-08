import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, List, X } from 'lucide-react';
import { catalogueHistoryPath, stockHistoryCheck, useStocks, type StockCatalogue, type StockCandle, type StockHistory, type StockInstrument, type StockRead } from '../../lib/stocks';
import { useLanguage } from '../../lib/i18n';
import { formatStockPrice, formatStockTime } from './stockFormat';
import { chartPeriods, newestClose, readLastInstrument, readPanelFilter, writeLastInstrument, writePanelFilter, type ChartPeriod } from './stockModel';
import { StockChart, type ChartStatus } from './StockChart';
import { StockFacts } from './StockFacts';
import { StockList, type ListFilter } from './StockList';
import { FavoriteStar, StaleNotice, StockChange, StockLogo, ViewSwitch } from './StockParts';
import './stocksTerminal.css';

interface Props {
  instrumentId?: string;
  catalogue: StockRead<StockCatalogue>;
  favorites: ReadonlySet<string>;
  onToggleFavorite: (id: string) => void;
}

const EMPTY: readonly StockCandle[] = [];

/** The newer of the catalogue's latest candle and the last loaded history candle. */
function newest(a: StockCandle | null, b: StockCandle | undefined): StockCandle | null {
  if (!b) return a;
  return !a || b.closeTimeUtc > a.closeTimeUtc ? b : a;
}

/** Dark working panel: list, one chart of the chosen instrument, its facts. Information only, no trading. */
export default function StocksTerminal({ instrumentId, catalogue, favorites, onToggleFavorite }: Props) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const items = catalogue.data?.instruments ?? [];
  const selected = instrumentId ? items.find(item => item.instrumentId === instrumentId) : undefined;
  const [filter, setFilter] = useState<ListFilter>(readPanelFilter);
  const [drawer, setDrawer] = useState(false);
  const drawerButton = useRef<HTMLButtonElement>(null);
  const drawerSearch = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Having data and the state of its latest refresh are separate: kept data
  // stays on screen and a failed refresh is reported beside it.
  const listStatus = catalogue.data ? 'ready' : catalogue.loading ? 'loading' : catalogue.error ? 'error' : 'loading';
  const errorText = catalogue.failure === 'invalid' ? 'stocks.invalidData' : 'stocks.unavailable';
  const listNotice = catalogue.error && catalogue.data
    ? <StaleNotice failure={catalogue.failure} busy={catalogue.loading} onRetry={catalogue.retry}
      time={formatStockTime(newestClose(catalogue.data.instruments), lang)} />
    : null;

  const changeFilter = (next: ListFilter) => { setFilter(next); writePanelFilter(next); };

  // The main entry reopens the last valid instrument; never a guessed one.
  const last = instrumentId ? null : readLastInstrument();
  const restoring = !!last && items.some(item => item.instrumentId === last);
  useEffect(() => {
    if (restoring && last) navigate(`/stocks/${encodeURIComponent(last)}`, { replace: true });
  }, [restoring, last, navigate]);

  useEffect(() => { if (selected) writeLastInstrument(selected.instrumentId); }, [selected]);

  useEffect(() => {
    if (!drawer) return;
    drawerSearch.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); return; }
      if (event.key !== 'Tab') return;
      // A modal list: Tab cycles inside it instead of reaching the page behind.
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>('button, input, a[href]');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [drawer]);
  const closeDrawer = () => { setDrawer(false); drawerButton.current?.focus(); };

  const list = (inDrawer: boolean) => (
    <StockList items={items} status={listStatus} onRetry={catalogue.retry} errorText={errorText} notice={listNotice} selectedId={selected?.instrumentId}
      favorites={favorites} onToggleFavorite={onToggleFavorite} filter={filter} onFilter={changeFilter}
      onPick={inDrawer ? () => setDrawer(false) : undefined} searchRef={inDrawer ? drawerSearch : undefined} />
  );
  const panelTo = instrumentId ? `/stocks/${encodeURIComponent(instrumentId)}` : '/stocks';
  const listButton = (
    <button ref={drawerButton} type="button" className="vxs-list-button" aria-expanded={drawer} aria-haspopup="dialog" onClick={() => setDrawer(true)}>
      <List size={16} aria-hidden="true" />
      <span>{selected ? selected.symbol : t('stocks.openList')}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
  );

  return (
    <div className={`vxs-terminal${selected ? ' has-instrument' : ''}`}>
      <h1 className="vxs-sr-only">{t('stocks.title')}</h1>
      <aside className="vxs-tile vxs-list-tile" aria-label={t('stocks.instruments')}>
        <div className="vxs-list-head"><span>{t('stocks.title')}</span><ViewSwitch view="panel" panelTo={panelTo} /></div>
        {list(false)}
      </aside>
      {selected ? <InstrumentView key="instrument" instrument={selected} favorite={favorites.has(selected.instrumentId)}
        onToggleFavorite={onToggleFavorite} listButton={listButton} panelTo={panelTo} />
        : <section className="vxs-center">
          <div className="vxs-tile vxs-strip vxs-strip-empty">{listButton}<ViewSwitch view="panel" panelTo={panelTo} /></div>
          <div className="vxs-tile vxs-choose" role="status">
            {listStatus === 'error' ? <>
              <h2>{t(errorText)}</h2>
              <button type="button" className="vxs-retry" onClick={catalogue.retry}>{t('stocks.retry')}</button>
            </> : listStatus === 'loading' || restoring ? <p>{t('stocks.loading')}</p>
            : <>
              <h2>{t(instrumentId ? 'stocks.notFound' : 'stocks.selectTitle')}</h2>
              <p>{t(instrumentId ? 'stocks.notFoundHint' : 'stocks.selectHint')}</p>
              <button type="button" className="vxs-choose-list" onClick={() => setDrawer(true)}>{t('stocks.openList')}</button>
            </>}
          </div>
        </section>}
      {drawer && <div className="vxs-drawer-backdrop" onClick={closeDrawer}>
        <div ref={drawerRef} className="vxs-drawer" role="dialog" aria-modal="true" aria-label={t('stocks.instruments')} onClick={event => event.stopPropagation()}>
          <div className="vxs-drawer-head">
            <strong>{t('stocks.instruments')}</strong>
            <button type="button" className="vxs-icon-button" aria-label={t('stocks.closeList')} onClick={closeDrawer}><X size={18} aria-hidden="true" /></button>
          </div>
          {list(true)}
        </div>
      </div>}
    </div>
  );
}

function InstrumentView({ instrument, favorite, onToggleFavorite, listButton, panelTo }: {
  instrument: StockInstrument; favorite: boolean; onToggleFavorite: (id: string) => void; listButton: JSX.Element; panelTo: string;
}) {
  const { t, lang } = useLanguage();
  // Checked before caching: another instrument's (or a malformed) page is an
  // error and never replaces this instrument's last valid page.
  const accept = useMemo(() => stockHistoryCheck(instrument), [instrument.instrumentId, instrument.currency]);
  const history = useStocks<StockHistory>(catalogueHistoryPath(instrument.instrumentId), accept);
  const own = history.data;
  const candles = own?.candles ?? EMPTY;
  const periods = useMemo(() => chartPeriods(candles, instrument.exchangeTimeZone), [candles, instrument.exchangeTimeZone]);
  const [chosen, setChosen] = useState<ChartPeriod>('all');
  const period = periods.has(chosen) ? chosen : 'all';
  const status: ChartStatus = candles.length ? 'ready' : own ? 'empty' : history.loading ? 'loading' : history.error ? 'error' : 'loading';
  const latest = newest(instrument.latest, candles[candles.length - 1]);
  const zone = instrument.exchangeTimeZone;
  const lastCandle = candles[candles.length - 1];
  const notice = history.error && own
    ? <StaleNotice failure={history.failure} busy={history.loading} onRetry={history.retry}
      time={lastCandle ? formatStockTime(lastCandle.closeTimeUtc, lang, zone) : null} />
    : null;

  return <>
    <section className="vxs-center" aria-label={instrument.name}>
      <div className="vxs-tile vxs-strip">
        {listButton}
        <div className="vxs-strip-id">
          <StockLogo instrument={instrument} size={28} />
          <div><h2>{instrument.symbol}</h2><span title={instrument.name}>{instrument.name}</span></div>
          <FavoriteStar instrument={instrument} active={favorite} onToggle={onToggleFavorite} />
        </div>
        <div className="vxs-strip-price" title={t('stocks.priceNote')}>
          <span className="vxs-label">{t('stocks.price')}</span>
          <strong>{formatStockPrice(latest?.close, instrument.currency)} <small>{instrument.currency}</small></strong>
        </div>
        <div className="vxs-strip-metric"><span className="vxs-label">{t('stocks.change')}</span><StockChange value={instrument.sessionChange} /></div>
        <div className="vxs-strip-metric"><span className="vxs-label">{t('stocks.candleClosed')}</span><span>{formatStockTime(latest?.closeTimeUtc, lang, zone)}</span></div>
        <div className="vxs-strip-metric"><span className="vxs-label">{t('stocks.session')}</span><span className="vxs-session">{t('stocks.noSession')}</span></div>
        <ViewSwitch view="panel" panelTo={panelTo} />
      </div>
      <div className="vxs-tile vxs-chart-tile">
        <StockChart instrumentId={instrument.instrumentId} candles={candles} currency={instrument.currency} timeZone={zone}
          status={status} periods={periods} period={period} onPeriod={setChosen} onRetry={history.retry}
          errorText={history.failure === 'invalid' ? 'stocks.invalidData' : 'stocks.unavailable'} notice={notice} />
      </div>
      <details className="vxs-tile vxs-about">
        <summary>{t('stocks.about')}</summary>
        <StockFacts instrument={instrument} latest={latest} adjustmentMode={own?.adjustmentMode} />
      </details>
    </section>
    <aside className="vxs-tile vxs-facts-tile" aria-label={t('stocks.about')}>
      <h2>{t('stocks.about')}</h2>
      <StockFacts instrument={instrument} latest={latest} adjustmentMode={own?.adjustmentMode} />
    </aside>
  </>;
}
