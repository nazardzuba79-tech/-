import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import { getToken } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { usePageMeta } from '../../lib/content/usePageMeta';
import { EXCHANGERS_META } from '../../lib/seo/site';
import { fetchExchangerOffers, fetchExchangersDirectory } from '../../lib/exchangersApi';
import { Nav } from '../../components/Nav';
import { Logo } from '../../components/Logo';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { TradingBotIcon } from '../../components/TradingBotIcon';
import { Footer } from '../../components/Footer';
import { formatRub, parseRubAmount } from '../../../../src/shared/exchangers/amount';
import type { OffersQuery } from '../../../../src/shared/exchangers/types';
import { PageHeading } from './PageHeading';
import { ExchangeCalculator, type Estimate } from './ExchangeCalculator';
import { ResultsToolbar } from './ResultsToolbar';
import { OffersList } from './OffersList';
import {
  DirectionButton,
  EmptyOffers,
  InvalidAmount,
  LoadError,
  NotConfigured,
  OffersSkeleton,
  RateLimited,
  Unavailable,
} from './ResultStates';
import { ExchangeTutorial } from './ExchangeTutorial';
import { ExchangersFaq } from './ExchangersFaq';
import {
  AMOUNT_ERROR,
  DEFAULT_AMOUNT,
  DEFAULT_FILTERS,
  bestOffer,
  directionHref,
  fallbackOptions,
  filterOffers,
  formatTime,
  networkDisplay,
  optionsFromDirectory,
  queryFromDraft,
  reconcileDraft,
  resultsStatusText,
  sortOffers,
  type CalculatorDraft,
  type DirectoryResult,
  type OfferFilters,
  type OffersResult,
  type SortKey,
} from './model';
import './exchangers.css';

type DirectoryState = { kind: 'loading' } | DirectoryResult;
type OffersState = { kind: 'idle' } | { kind: 'loading' } | OffersResult;

const INITIAL_DRAFT: CalculatorDraft = {
  method: 'sbp',
  assetId: 'USDT',
  networkId: 'tron',
  amountText: new Intl.NumberFormat('ru-RU').format(DEFAULT_AMOUNT),
};

function GuestHeader() {
  const { t } = useLanguage();
  return (
    <>
      <header className="global-header top-nav-bar vx-ex-guest-header">
        <div className="header-left">
          <Link to="/" className="header-brand" aria-label="VOLTEX"><Logo /></Link>
          <span className="brand-separator top-nav-divider" aria-hidden="true" />
          <nav className="main-nav nav-desktop-links" aria-label={t('nav.menu')}>
            <Link to="/markets" className="nav-item top-nav-link">{t('nav.markets')}</Link>
            <Link to="/trade" className="nav-item top-nav-link">{t('nav.trade')}</Link>
            <Link to="/futures" className="nav-item top-nav-link">{t('nav.futures')}</Link>
            <Link to="/copy-trading" className="nav-item top-nav-link">{t('nav.copyTrading')}</Link>
            <Link to="/trading-bots" className="nav-item top-nav-link"><TradingBotIcon />Торговые боты</Link>
            <Link to="/exchangers" className="nav-item top-nav-link nav-active is-active" aria-current="page">{t('nav.exchangers')}</Link>
            <Link to="/academy" className="nav-item top-nav-link">{t('nav.academy')}</Link>
          </nav>
        </div>
        <div className="header-actions vx-ex-guest-actions">
          <LanguageSwitcher variant="pill" />
          <Link to="/login" className="vx-ex-guest-login">{t('auth.login')}</Link>
          <Link to="/register" className="deposit-button top-nav-fund-btn"><span>{t('home.cta.startTrading')}</span></Link>
        </div>
      </header>
      {/* Below 1531 px the header's product row folds away (index.css); this row keeps the way back. */}
      <nav className="vx-ex-guest-tabs" aria-label={t('nav.menu')}>
        <Link to="/markets">{t('nav.markets')}</Link>
        <Link to="/exchangers" aria-current="page">{t('nav.exchangers')}</Link>
        <Link to="/academy">{t('nav.academy')}</Link>
      </nav>
    </>
  );
}

function ExchangersView() {
  const [directory, setDirectory] = useState<DirectoryState>({ kind: 'loading' });
  const [offers, setOffers] = useState<OffersState>({ kind: 'idle' });
  const [draft, setDraft] = useState<CalculatorDraft>(INITIAL_DRAFT);
  const [submitted, setSubmitted] = useState<OffersQuery | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('best');
  const [filters, setFilters] = useState<OfferFilters>(DEFAULT_FILTERS);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const directoryCtl = useRef<AbortController | null>(null);
  const offersCtl = useRef<AbortController | null>(null);

  const search = useCallback((query: OffersQuery) => {
    offersCtl.current?.abort();
    const ctl = new AbortController();
    offersCtl.current = ctl;
    setSubmitted(query);
    setOffers({ kind: 'loading' });
    fetchExchangerOffers(query, ctl.signal)
      .then((result) => { if (!ctl.signal.aborted) setOffers(result); })
      .catch(() => { if (!ctl.signal.aborted) setOffers({ kind: 'error' }); });
  }, []);

  const loadDirectory = useCallback(() => {
    directoryCtl.current?.abort();
    offersCtl.current?.abort();
    const ctl = new AbortController();
    directoryCtl.current = ctl;
    setDirectory({ kind: 'loading' });
    setOffers({ kind: 'loading' });
    fetchExchangersDirectory(ctl.signal)
      .then((result) => {
        if (ctl.signal.aborted) return;
        setDirectory(result);
        if (result.kind === 'ok') {
          const next = reconcileDraft(draftRef.current, optionsFromDirectory(result.data));
          setDraft(next);
          const query = queryFromDraft(next);
          if (query) search(query);
          else setOffers({ kind: 'idle' });
        } else {
          // not_configured: no rates at all, only the BestChange link. Other problems: shown with a retry.
          setOffers(result);
        }
      })
      .catch(() => {
        if (ctl.signal.aborted) return;
        setDirectory({ kind: 'error' });
        setOffers({ kind: 'error' });
      });
  }, [search]);

  useEffect(() => {
    loadDirectory();
    return () => {
      directoryCtl.current?.abort();
      offersCtl.current?.abort();
    };
  }, [loadDirectory]);

  const options = useMemo(
    () => (directory.kind === 'ok' ? optionsFromDirectory(directory.data) : fallbackOptions()),
    [directory],
  );
  const ratesOff = directory.kind === 'not_configured';

  function submit() {
    const query = queryFromDraft(draft);
    if (!query) {
      if (parseRubAmount(draft.amountText) === null) {
        setAmountError(AMOUNT_ERROR);
        document.getElementById('vx-ex-amount')?.focus();
      }
      return;
    }
    setAmountError(null);
    if (ratesOff) {
      setSubmitted(query);
      return;
    }
    search(query);
  }

  function refresh() {
    if (directory.kind === 'loading') return;
    if (directory.kind !== 'ok' && directory.kind !== 'not_configured' && offers.kind !== 'ok') {
      loadDirectory();
      return;
    }
    if (submitted && !ratesOff) search(submitted);
    else loadDirectory();
  }

  const okData = offers.kind === 'ok' ? offers.data : null;
  const allOffers = useMemo(() => okData?.offers ?? [], [okData]);
  const best = useMemo(() => bestOffer(allOffers), [allOffers]);
  const visible = useMemo(() => sortOffers(filterOffers(allOffers, filters), sort), [allOffers, filters, sort]);

  const draftQuery = queryFromDraft(draft);
  const dirty =
    !ratesOff &&
    (submitted === null ||
      draft.method !== submitted.method ||
      draft.assetId !== submitted.asset ||
      draft.networkId !== submitted.network ||
      (draftQuery !== null && draftQuery.amount !== submitted.amount));

  // The section-level BestChange link follows the selected pair; the server's link is used only for that same pair.
  const sameAsServer = okData && okData.query.method === draft.method && okData.query.asset === draft.assetId && okData.query.network === draft.networkId;
  const sectionDirection = directionHref(draft.method, draft.assetId, draft.networkId, sameAsServer ? okData.directionUrl : null);
  const listDirection = okData ? directionHref(okData.query.method, okData.query.asset, okData.query.network, okData.directionUrl) : null;

  const estimate: Estimate =
    offers.kind === 'loading' || directory.kind === 'loading'
      ? { kind: 'loading' }
      : okData && best && best.receiveAmount !== null
        ? { kind: 'value', amount: best.receiveAmount, assetId: okData.query.asset }
        : null;

  const shown = okData?.query ?? submitted;
  const methodLabel = shown ? options.methods.find((m) => m.id === shown.method)?.label ?? shown.method : null;
  const updated = formatTime(okData?.asOf ?? null);
  const busy = offers.kind === 'loading' || directory.kind === 'loading';
  const statusText = resultsStatusText(
    offers.kind === 'idle' && directory.kind === 'loading' ? 'loading' : offers.kind,
    { shown: visible.length, total: allOffers.length },
    updated,
    okData?.delayed ?? false,
  );

  return (
    <>
      <ExchangeCalculator
        options={options}
        busy={directory.kind === 'loading'}
        ratesOff={ratesOff}
        draft={draft}
        onDraftChange={(next) => {
          setDraft(next);
          if (amountError && parseRubAmount(next.amountText) !== null) setAmountError(null);
        }}
        dirty={dirty}
        amountError={amountError}
        onSubmit={submit}
        estimate={estimate}
      />

      <section aria-labelledby="vx-ex-results-title" className="vx-ex-results">
        <div className="vx-ex-results-head">
          <div>
            <h2 id="vx-ex-results-title">Предложения обменников</h2>
            {shown && methodLabel && (
              <p className="vx-ex-muted">
                {`${methodLabel} → ${shown.asset} ${networkDisplay(shown.asset, shown.network)} · ${formatRub(shown.amount)}`}
              </p>
            )}
          </div>
          <div className="vx-ex-results-meta">
            <span className="vx-ex-attribution">Данные: BestChange</span>
            {updated && okData && <span>Обновлено в <time dateTime={okData.asOf ?? undefined}>{updated}</time></span>}
            {!ratesOff && (
              <button type="button" className="vx-ex-btn vx-ex-btn--ghost" onClick={refresh} disabled={busy}>
                <RotateCw size={14} aria-hidden="true" className={busy ? 'is-spinning' : undefined} />
                Обновить
              </button>
            )}
          </div>
        </div>

        {offers.kind === 'ok' && okData && okData.offers.length > 0 && (
          <ResultsToolbar sort={sort} onSortChange={setSort} filters={filters} onFiltersChange={setFilters} />
        )}

        {okData?.delayed && (
          <p className="vx-ex-note" role="note">
            {`Показаны данные BestChange${updated ? ` на ${updated}` : ''}: свежие курсы сейчас не получены. Сверяйте курс на сайте обменника.`}
          </p>
        )}

        {/* The only live region: a short summary, not the whole list (re-reading every row on refresh is noise). */}
        <p className="vx-ex-sr" role="status" aria-live="polite" aria-atomic="true">{statusText}</p>

        <div aria-busy={busy}>
          {(offers.kind === 'loading' || (offers.kind === 'idle' && directory.kind === 'loading')) && <OffersSkeleton />}
          {offers.kind === 'idle' && directory.kind !== 'loading' && (
            <p className="vx-ex-muted">Выберите параметры обмена и нажмите «Найти обменники».</p>
          )}
          {offers.kind === 'not_configured' && <NotConfigured directionUrl={sectionDirection} />}
          {offers.kind === 'unavailable' && <Unavailable retryAfter={offers.retryAfter} onRetry={refresh} directionUrl={sectionDirection} />}
          {offers.kind === 'rate_limited' && <RateLimited retryAfter={offers.retryAfter} onRetry={refresh} />}
          {offers.kind === 'invalid' && <InvalidAmount />}
          {offers.kind === 'error' && <LoadError onRetry={refresh} />}
          {offers.kind === 'ok' && okData && allOffers.length === 0 && <EmptyOffers filtered={false} directionUrl={sectionDirection} />}
          {offers.kind === 'ok' && okData && allOffers.length > 0 && (
            visible.length > 0 ? (
              <div className="vx-ex-list">
                <div className="vx-ex-list-head">
                  <p className="vx-ex-muted">{`Показано ${visible.length} из ${allOffers.length}`}</p>
                  <DirectionButton href={sectionDirection} />
                </div>
                <OffersList offers={visible} assetId={okData.query.asset} bestOfferId={best?.id ?? null} directionUrl={listDirection} />
              </div>
            ) : (
              <EmptyOffers filtered onReset={() => setFilters(DEFAULT_FILTERS)} directionUrl={sectionDirection} />
            )
          )}
        </div>
      </section>
    </>
  );
}

/**
 * «Обменники» (/exchangers, Issue #694). Public: no sign-in, no RequireAuth.
 * A signed-in visitor gets the shared Nav (without its profile read and price
 * ticker, as on the Academy); a guest gets the same guest header the Academy
 * uses. The page copy is Russian only, so its content root says lang="ru".
 */
export function ExchangersPage() {
  usePageMeta(EXCHANGERS_META.title, EXCHANGERS_META.description);
  const signedIn = !!getToken();
  return (
    <div className="vx-ex-page">
      {signedIn ? <Nav active="/exchangers" hideTicker readProfile={false} /> : <GuestHeader />}
      <main className="vx-ex" lang="ru">
        <PageHeading />
        <ExchangersView />
        <ExchangeTutorial />
        <ExchangersFaq />
        <p className="vx-ex-disclaimer">
          VOLTEX показывает предложения независимых обменников по данным BestChange, не принимает рубли и не проводит обмен.
          Курсы, резервы и лимиты могут измениться к моменту создания заявки.
        </p>
      </main>
      <div className="vx-ex-footer"><Footer /></div>
    </div>
  );
}
