import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { styles } from './adminStyles';
import {
  adminListingsApi, ListingApiError, LISTING_TIME_ZONES, newPublishKey, utcOffsetLabel, utcToZonedWallTime, zonedWallTimeToUtc,
  type AdminListing, type ListingConfig, type ListingCountdownAction, type ListingForm, type ListingPreview,
} from './adminListingsApi';
import { LISTING_REVISION_CONFLICT, listingProfileLabel, listingRequestError, listingTimeZoneLabel } from './adminListingsCopy';
import { ListingScenarioLab } from './ListingScenarioLab';
import { ListingMovementEditor } from './ListingMovementEditor';
import { ListingCandlePreview } from './ListingCandlePreview';
import { formatMovementPrice, historicalModelLabel, newListingMovement, rebaseListingMovement, validateListingMovement, type ListingMovement, type ListingProgram } from './listingMovementModel';
import { useAdminCompact } from './useAdminCompact';
import { listingPublicationAllowed, listingTimerSupported } from './listingTimerCapability';
import './adminListings.css';

const LOGO_MAX_BYTES = 64 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const REVISION_CONFLICT_MESSAGE = LISTING_REVISION_CONFLICT;

interface FormState {
  name: string; symbol: string; logo: string | null; initialPrice: string;
  wallTime: string; timeZone: string; ownerAllocation: string;
  seedMode: 'auto' | 'manual'; seed: string; tradable: boolean;
  /** Display only: assigned by the store, never sent. */
  simulationProfile: ListingConfig['simulationProfile'] | null;
  simulationProgram?: ListingProgram;
  wickModel?: 'NATURAL_V1';
}

const emptyForm = (): FormState => ({
  name: '', symbol: '', logo: null, initialPrice: '', wallTime: '', timeZone: 'Europe/Kyiv', ownerAllocation: '0',
  seedMode: 'auto', seed: '', tradable: false, simulationProfile: null, simulationProgram: newListingMovement(),
});

const fromConfig = (config: ListingConfig): FormState => ({
  name: config.name, symbol: config.symbol, logo: config.logo, initialPrice: config.initialPrice,
  wallTime: utcToZonedWallTime(config.listingAt, config.displayTimeZone), timeZone: config.displayTimeZone,
  ownerAllocation: config.ownerAllocation, seedMode: config.seedMode, seed: config.seed, tradable: config.tradable,
  simulationProfile: config.simulationProfile ?? null,
  simulationProgram: config.simulationProgram, wickModel: config.wickModel,
});

// Compare editable values, including exact text drafts. An automatic seed is
// assigned by the store; a hidden manual-seed edit does not change auto mode.
const formSignature = (form: FormState): string => JSON.stringify([
  form.name, form.symbol, form.logo, form.initialPrice, form.wallTime, form.timeZone,
  form.ownerAllocation, form.seedMode, form.seedMode === 'manual' ? form.seed : null, form.tradable,
  form.simulationProgram, form.wickModel,
]);

/** The instant in UTC, Kyiv and Moscow (the owner reads both UTC and МСК), plus the listing's own zone when it is another one. */
function listingMoment(iso: string, timeZone: string): string {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) return '—';
  const fmt = (zone: string, date: boolean) => new Intl.DateTimeFormat('ru-RU', {
    ...(date ? { day: '2-digit', month: '2-digit', year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone,
  }).format(new Date(instant)).replace(',', '');
  const own = !['UTC', 'Europe/Kyiv', 'Europe/Moscow'].includes(timeZone) ? ` · ${fmt(timeZone, true)} ${listingTimeZoneLabel(timeZone)}` : '';
  return `${fmt('UTC', true)} Всемирное время (UTC) · ${fmt('Europe/Kyiv', true)} Киев (${utcOffsetLabel(instant, 'Europe/Kyiv')}) · ${fmt('Europe/Moscow', true)} Москва (${utcOffsetLabel(instant, 'Europe/Moscow')})${own}`;
}

/** The timer line as the exchange shows it: «26.10.2026 — 13:00 UTC / 16:00 МСК». */
export function listingTimerLine(iso: string): string {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) return '—';
  const time = (timeZone: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(instant);
  const day = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(instant);
  return `${day} — ${time('UTC')} UTC / ${time('Europe/Moscow')} МСК`;
}

function statusOf(listing: AdminListing): { text: string; tone: 'draft' | 'live' | 'changed' } {
  if (listing.activeVersion === null) return { text: 'Черновик', tone: 'draft' };
  const changed = JSON.stringify(listing.active) !== JSON.stringify(listing.draft);
  return changed ? { text: `Опубликован: версия ${listing.activeVersion} · есть неопубликованные изменения`, tone: 'changed' } : { text: `Опубликован: версия ${listing.activeVersion}`, tone: 'live' };
}

export type ListingTimerTone = 'staged' | 'running' | 'paused' | 'open' | 'overdue';

/**
 * The pre-listing timer of a PUBLISHED listing, by server time. Nothing starts
 * by itself: a passed date with a timer that never ran is «overdue» — the
 * owner moves the date, then starts the timer. A listing published before the
 * timer existed counts as running (today's behaviour).
 */
export function listingTimerStatus(listing: AdminListing, serverNow: number, timerSupported = true): { tone: ListingTimerTone; text: string; actions: ListingCountdownAction[] } | null {
  if (listing.activeVersion === null || !listing.active) return null;
  // An API without the timer (listingTimerCapability) answers 404 to every action: offer none.
  if (!timerSupported) {
    const status = listingTimerStatus(listing, serverNow);
    return status && { ...status, actions: [] };
  }
  const state = listing.countdown?.state ?? 'running';
  const at = Date.parse(listing.active.listingAt);
  if (state === 'running' && at <= serverNow) return { tone: 'open', text: 'Рынок открыт', actions: [] };
  if (at <= serverNow) return { tone: 'overdue', text: 'Дата листинга прошла, таймер не был запущен — назначьте новую дату', actions: state === 'paused' ? ['stop'] : [] };
  if (state === 'running') return { tone: 'running', text: 'Таймер запущен: отсчёт виден на бирже', actions: ['pause', 'stop'] };
  if (state === 'paused') return { tone: 'paused', text: 'Таймер приостановлен: дата видна, отсчёт скрыт', actions: ['start', 'stop'] };
  return { tone: 'staged', text: 'Таймер не запущен: рынок скрыт с биржи', actions: ['start'] };
}

const TIMER_ACTION_LABELS: Record<ListingCountdownAction, string> = { start: 'Запустить таймер', pause: 'Приостановить', stop: 'Остановить и скрыть' };

const errorText = (error: unknown) => {
  if (!(error instanceof ListingApiError)) return 'Не удалось выполнить запрос.';
  return listingRequestError(error);
};

/** Phone navigation inside the long listing form: jumps to a section and opens it if it is folded. */
function ListingSectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const jump = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const folded = target instanceof HTMLDetailsElement ? target : target.closest('details');
    if (folded) folded.open = true;
    target.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };
  return <nav className="listing-section-nav" aria-label="Разделы листинга" data-listing-sections>
    {sections.map(section => <button type="button" key={section.id} onClick={() => jump(section.id)} data-listing-section={section.id}>{section.label}</button>)}
  </nav>;
}

export function AdminListingsPage() {
  const compact = useAdminCompact();
  const [listings, setListings] = useState<AdminListing[] | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loadError, setLoadError] = useState<string | null>(null);
  // A configuration fault, not an outage: nothing can be created until the rollout is finished.
  const [notConnected, setNotConnected] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; revision: number; locked: boolean } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoReading, setLogoReading] = useState(false);
  const [preview, setPreview] = useState<ListingPreview | null>(null);
  const [previewAt, setPreviewAt] = useState('');
  const [previewHorizon, setPreviewHorizon] = useState<'first24h' | 'growth' | 'afterGrowth' | 'history'>('first24h');
  const [previewInterval, setPreviewInterval] = useState('5m');
  const [publishing, setPublishing] = useState<{ listing: AdminListing; key: string; startTimer: boolean } | null>(null);
  // Server clock from the last list read: the timer statuses never trust the browser's clock alone.
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [timerError, setTimerError] = useState<string | null>(null);
  const timerSupported = listingTimerSupported(listings);
  const loading = useRef(false);
  const mounted = useRef(false);
  const listRequest = useRef<AbortController | null>(null);
  const previewRequest = useRef(0);
  const logoRequest = useRef(0);
  // Rebase each keystroke from one unrounded editing baseline, not the last rounded result.
  const initialPriceAnchor = useRef<{ initial: string; program: ListingMovement } | null>(null);
  const publishDialog = useRef<HTMLDivElement>(null);
  // The publish confirmation takes focus and gives it back; Escape cancels it
  // while nothing is in flight (the same as its «Отмена»).
  useEffect(() => {
    if (!publishing) return;
    const previous = document.activeElement as HTMLElement | null;
    publishDialog.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); setPublishing(null); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [publishing, busy]);

  const load = useCallback(async () => {
    if (!mounted.current || loading.current) return;
    loading.current = true;
    const controller = new AbortController(); listRequest.current = controller;
    try {
      const body = await adminListingsApi.list(controller.signal);
      if (controller.signal.aborted) return;
      setListings(body.listings);
      setClockOffsetMs(body.serverTime - Date.now());
      setLoadError(null);
      setNotConnected(false);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(errorText(error));
      setNotConnected(error instanceof ListingApiError && (error.code === 'STORE_NOT_CONFIGURED' || error.code === 'STORE_AUTH_FAILED'));
    } finally { if (listRequest.current === controller) { loading.current = false; listRequest.current = null; } }
  }, []);
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; listRequest.current?.abort(); listRequest.current = null; loading.current = false; };
  }, [load]);

  const current = useMemo(() => (editing?.id ? listings?.find((item) => item.id === editing.id) ?? null : null), [editing, listings]);
  const visibleListings = listings?.filter(listing => listing.draft.symbol.includes(search.trim().toUpperCase())
    && (statusFilter === 'all' || statusOf(listing).tone === statusFilter));
  const listingAtUtc = form.wallTime ? zonedWallTimeToUtc(form.wallTime, form.timeZone) : null;
  const draftIsSaved = Boolean(!logoReading && current && editing?.revision === current.draftRevision
    && formSignature(form) === formSignature(fromConfig(current.draft)));
  // A historical continuation stays a saved draft with a private preview: the
  // server refuses to publish it (HISTORICAL_RIGHTS_UNVERIFIED), so does the form.
  const historicalMode = form.simulationProgram?.kind === 'scenario-controls-v2' && form.simulationProgram.afterGrowth === 'historical';
  // A first publication through an API without the timer would be public at once: it is not sent (listingTimerCapability).
  const publicationBlocked = Boolean(current && !listingPublicationAllowed(current, timerSupported));
  const historicalHours = historicalMode && form.simulationProgram?.kind === 'scenario-controls-v2'
    ? (form.simulationProgram.historical?.clips ?? []).reduce((hours, clip) => hours + clip.bars.length, 0) : 0;
  // Historical models saved with OTHER listings (draft or published version), for reuse in this one.
  const savedModels = useMemo(() => (listings ?? []).filter(listing => listing.id !== editing?.id).flatMap(listing =>
    [['черновик', listing.draft] as const, ['опубликовано', listing.active] as const].flatMap(([kind, config]) => {
      const program = config?.simulationProgram?.kind === 'scenario-controls-v2' ? config.simulationProgram : null;
      const label = historicalModelLabel(program);
      return program?.historical && label ? [{ key: `${listing.id}:${kind}`, label: `${listing.draft.symbol} (${kind}): ${label}`, program: program.historical }] : [];
    })).filter((model, index, all) => all.findIndex(other => other.label.slice(other.label.indexOf(':')) === model.label.slice(model.label.indexOf(':'))
      && JSON.stringify(other.program) === JSON.stringify(model.program)) === index), [listings, editing?.id]);

  function invalidatePreview() {
    previewRequest.current += 1;
    setPreview(null);
  }

  function changeForm(next: FormState | ((previous: FormState) => FormState)) {
    invalidatePreview();
    setPublishing(null);
    setForm(next);
  }

  function cancelLogoRead() {
    logoRequest.current += 1;
    setLogoReading(false);
  }

  function openCreate() {
    initialPriceAnchor.current = null;
    cancelLogoRead();
    setEditing({ id: null, revision: 0, locked: false });
    changeForm(emptyForm()); setFormError(null); setNotice(null);
  }
  function openEdit(listing: AdminListing) {
    initialPriceAnchor.current = null;
    cancelLogoRead();
    setEditing({ id: listing.id, revision: listing.draftRevision, locked: listing.activeVersion !== null });
    changeForm(fromConfig(listing.draft)); setFormError(null); setNotice(null);
  }

  function onLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return setFormError('Логотип: PNG, JPEG, WebP или SVG.');
    if (file.size > LOGO_MAX_BYTES) return setFormError('Логотип не больше 64 КБ.');
    const request = ++logoRequest.current;
    invalidatePreview(); setPublishing(null); setLogoReading(true); setFormError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (request !== logoRequest.current) return;
      changeForm((f) => ({ ...f, logo: String(reader.result) }));
      setLogoReading(false); setFormError(null);
    };
    reader.onerror = () => {
      if (request !== logoRequest.current) return;
      setLogoReading(false); setFormError('Не удалось прочитать логотип. Выберите файл ещё раз.');
    };
    reader.readAsDataURL(file);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || busy || logoReading) return;
    if (!listingAtUtc) return setFormError('Время не существует или неоднозначно в выбранном часовом поясе. Укажите корректное время; при переводе часов можно выбрать UTC.');
    if (form.simulationProgram?.kind === 'scenario-controls-v2') {
      const invalid = validateListingMovement(form.initialPrice, form.simulationProgram);
      if (invalid) return setFormError(invalid);
    }
    const payload: ListingForm = {
      name: form.name.trim(), symbol: form.symbol.trim().toUpperCase(), logo: form.logo, initialPrice: form.initialPrice.trim(),
      listingAt: listingAtUtc, displayTimeZone: form.timeZone, ownerAllocation: form.ownerAllocation.trim() || '0',
      seedMode: form.seedMode, ...(form.seedMode === 'manual' ? { seed: form.seed.trim() } : {}), tradable: form.tradable,
      ...(form.simulationProgram ? { simulationProgram: form.simulationProgram } : {}),
      ...(form.wickModel ? { wickModel: form.wickModel } : {}),
    };
    setBusy(true); setFormError(null);
    try {
      const saved = editing.id ? await adminListingsApi.saveDraft(editing.id, payload, editing.revision) : await adminListingsApi.create(payload);
      setEditing({ id: saved.id, revision: saved.draftRevision, locked: editing.locked });
      changeForm(fromConfig(saved.draft));
      setNotice(`Черновик ${saved.draft.symbol}/USDT сохранён (ревизия ${saved.draftRevision}). Код варианта: ${saved.draft.seed}`);
      await load();
    } catch (error) {
      setFormError(errorText(error));
    } finally { setBusy(false); }
  }

  async function runPreview() {
    if (!editing?.id || busy || !draftIsSaved) return;
    const request = ++previewRequest.current;
    setBusy(true);
    try {
      const at = previewAt ? zonedWallTimeToUtc(previewAt, form.timeZone) : null;
      if (previewAt && !at) {
        setFormError('Время предпросмотра не существует или неоднозначно. Выберите другое время или UTC.');
        return;
      }
      const result = await adminListingsApi.preview(editing.id, at, previewInterval, form.simulationProgram?.kind === 'scenario-controls-v2' ? previewHorizon : undefined);
      if (request !== previewRequest.current) return;
      if (result.draftRevision !== editing.revision) {
        setPreview(null);
        setFormError(REVISION_CONFLICT_MESSAGE);
        return;
      }
      setPreview(result);
      setFormError(null);
    } catch (error) {
      if (request === previewRequest.current) setFormError(errorText(error));
    } finally { setBusy(false); }
  }

  function openPublish() {
    if (!current || busy || !draftIsSaved || !listingPublicationAllowed(current, timerSupported)) return;
    if (current.draft.simulationProgram?.kind === 'scenario-controls-v2'
      && current.draft.simulationProgram.afterGrowth === 'historical') {
      setFormError('Историческое движение пока только для закрытого предпросмотра. Публикация требует проверки прав на источник и отдельного торгового счёта.');
      return;
    }
    // A first publication may stay hidden until «Запустить таймер» (the box is ticked by default, as before the
    // timer existed); a re-publication keeps the timer it has.
    setPublishing({ listing: current, key: newPublishKey(), startTimer: true });
  }

  async function confirmPublish() {
    if (!publishing || busy || !draftIsSaved || publishing.listing.id !== editing?.id
      || publishing.listing.draftRevision !== editing.revision || !listingPublicationAllowed(publishing.listing, timerSupported)) return;
    setBusy(true);
    try {
      // The key was fixed when this confirmation opened: a retry is the same publish.
      // A first publication reaches this line only through an API that runs the timer, which keeps «staged» hidden.
      const staged = publishing.listing.activeVersion === null && !publishing.startTimer;
      const result = await adminListingsApi.publish(publishing.listing.id, publishing.listing.draftRevision, publishing.key, staged ? 'staged' : undefined);
      setEditing(previous => previous?.id === publishing.listing.id ? { ...previous, locked: true } : previous);
      setNotice(result.replayed ? `Уже опубликовано: версия ${result.version}.`
        : result.countdown?.state === 'staged' ? `Опубликовано: версия ${result.version}. Таймер не запущен — рынок скрыт с биржи до нажатия «Запустить таймер».`
        : `Опубликовано: версия ${result.version}. Рынок появится при ближайшем обновлении списка.`);
      setPublishing(null);
      await load();
    } catch (error) {
      setFormError(errorText(error));
      if (error instanceof ListingApiError && error.status !== 0 && error.status < 500) setPublishing(null);
    } finally { setBusy(false); }
  }

  /** Start, pause or stop the public timer of a published listing. The listing time itself never moves here. */
  async function timer(listing: AdminListing, action: ListingCountdownAction) {
    if (busy || !listing.active) return;
    setBusy(true); setTimerError(null);
    try {
      const result = await adminListingsApi.countdown(listing.id, action);
      const pair = `${listing.symbol}/USDT`, line = listingTimerLine(listing.active.listingAt);
      setNotice(!result.changed ? `Таймер ${pair}: состояние не изменилось.`
        : result.countdown.state === 'running' ? `Таймер ${pair} запущен: отсчёт до ${line}. Биржа покажет его при ближайшем обновлении списка.`
        : result.countdown.state === 'paused' ? `Таймер ${pair} приостановлен: дата ${line} видна, отсчёт скрыт. Рынок не откроется, пока таймер не запущен.`
        : `Таймер ${pair} остановлен: рынок скрыт с биржи до нового запуска. Дата ${line} сохранена.`);
      await load();
    } catch (error) {
      setTimerError(errorText(error));
    } finally { setBusy(false); }
  }

  return (
    <div className="admin-listings">
      <h1 style={styles.title}>Листинги</h1>
      <p style={styles.subtitle}>Симуляции новых рынков: создание, приватный предпросмотр и публикация — без изменения кода и обновления приложения.</p>
      <div className="listing-toolbar">
        <button type="button" className="listing-primary" data-create-listing onClick={openCreate} disabled={notConnected}
          title={notConnected ? 'Листинги не подключены' : undefined}>+ Создать листинг</button>
        <label>Поиск по тикеру<input type="search" value={search} onChange={e => setSearch(e.target.value)} data-field="listingSearch" /></label>
        <label>Статус публикации<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} data-field="listingStatus">
          <option value="all">Все</option><option value="draft">Черновики</option>
          <option value="live">Опубликованы</option><option value="changed">Есть неопубликованные изменения</option>
        </select></label>
      </div>
      <ListingScenarioLab />
      {notice && <p style={styles.successBox} role="status" data-listing-notice>{notice}</p>}
      {timerError && <p role="alert" style={styles.errorBox} className="admin-inline-alert" data-timer-error><span>{timerError}</span>
        <button type="button" className="admin-inline-retry" onClick={() => setTimerError(null)}>Закрыть</button></p>}
      {loadError && (
        <p role="alert" style={styles.errorBox} className="admin-inline-alert" data-listings-state={notConnected ? 'not-connected' : 'error'}>
          <span>{loadError}</span>
          <button type="button" className="admin-inline-retry" onClick={() => void load()}>Повторить</button>
        </p>
      )}

      {listings === null && !loadError && <p className="listing-muted">Загрузка…</p>}
      {listings && listings.length === 0 && <p className="listing-muted">Листингов пока нет.</p>}
      {listings && listings.length > 0 && visibleListings?.length === 0 && <p className="listing-muted" role="status">По выбранным условиям ничего не найдено.</p>}
      {listings && listings.length > 0 && (
        <div className="listing-table" role="table" aria-label="Листинги">
          {visibleListings?.map((listing) => {
            const status = statusOf(listing);
            const timerStatus = listingTimerStatus(listing, Date.now() + clockOffsetMs, timerSupported);
            return (
              <div className="listing-row" role="row" key={listing.id} data-listing-row={listing.draft.symbol}>
                <span className="listing-ident">
                  {listing.draft.logo ? <img src={listing.draft.logo} alt="" width={28} height={28} /> : <span className="listing-letter">{listing.draft.symbol[0]}</span>}
                  <span><b>{listing.draft.symbol}/USDT</b><small>{listing.draft.name}</small>
                    {(() => {
                      const program = listing.draft.simulationProgram?.kind === 'scenario-controls-v2' ? listing.draft.simulationProgram : null;
                      const label = historicalModelLabel(program);
                      return label && <small className="listing-model" data-listing-model="historical">История после этапов: {label} · только черновик</small>;
                    })()}</span>
                </span>
                <span className="listing-when">{listingMoment(listing.draft.listingAt, listing.draft.displayTimeZone)}</span>
                <span className={`listing-status listing-status-${status.tone}`} data-listing-status={status.tone}>{status.text}</span>
                <span className="listing-actions">
                  <button type="button" onClick={() => openEdit(listing)} data-edit-listing={listing.draft.symbol}>Изменить</button>
                  {listing.activeVersion !== null && <Link to={`/trade?pair=${listing.draft.symbol}/USDT`} data-open-market={listing.draft.symbol}>Открыть рынок</Link>}
                </span>
                {timerStatus && listing.active && (
                  <span className={`listing-timer listing-timer-${timerStatus.tone}`} data-listing-timer={timerStatus.tone} role={timerStatus.tone === 'overdue' ? 'alert' : undefined}>
                    <b>{timerStatus.text}</b>
                    <small data-listing-timer-line>Листинг: {listingTimerLine(listing.active.listingAt)} · таймер считает до этого момента по серверному времени</small>
                    {timerStatus.tone === 'overdue' && <small>Ничего не запускается автоматически. Откройте листинг, задайте новую дату и опубликуйте её, затем нажмите «Запустить таймер».</small>}
                    {timerStatus.actions.length > 0 && <span className="listing-timer-actions">
                      {timerStatus.actions.map(action => <button type="button" key={action} disabled={busy} className={action === 'start' ? 'listing-primary' : undefined}
                        onClick={() => void timer(listing, action)} data-timer-action={action} data-timer-listing={listing.draft.symbol}>{TIMER_ACTION_LABELS[action]}</button>)}
                    </span>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <form className={`listing-form${compact ? ' listing-form-compact' : ''}`} onSubmit={save} data-listing-form noValidate>
          <h2>{editing.id ? `Листинг ${form.symbol}/USDT` : 'Новый листинг'}</h2>
          {editing.locked && <p className="listing-hint">Опубликован: тикер, код варианта, начальная цена и настройки движения больше не меняются — это защищает историю цен. Время можно перенести только до открытия рынка; запуск, пауза и остановка таймера — в списке листингов, они дату не меняют.</p>}
          {compact && <ListingSectionNav sections={[
            { id: 'listing-section-main', label: 'Параметры' },
            ...(form.simulationProgram?.kind === 'scenario-controls-v2' ? [{ id: 'listing-section-movement', label: 'Движение' }, { id: 'listing-section-stages', label: 'Этапы' }, { id: 'listing-section-advanced', label: 'Точная настройка' }] : []),
            ...(editing.id ? [{ id: 'listing-section-preview', label: 'Предпросмотр' }] : []),
          ]} />}
          <div className="listing-grid" id="listing-section-main">
            <label>Название<input value={form.name} maxLength={40} onChange={(e) => changeForm({ ...form, name: e.target.value })} data-field="name" required /></label>
            <label>Тикер<input value={form.symbol} maxLength={10} disabled={editing.locked} onChange={(e) => changeForm({ ...form, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} data-field="symbol" required /></label>
            <label>Начальная цена, USDT<input value={form.initialPrice} inputMode="decimal" disabled={editing.locked} onFocus={() => {
              initialPriceAnchor.current = form.simulationProgram?.kind === 'scenario-controls-v2' ? { initial: form.initialPrice, program: form.simulationProgram } : null;
            }} onBlur={() => { initialPriceAnchor.current = null; }} onChange={(e) => {
              const initialPrice = e.target.value.replace(',', '.');
              if (form.simulationProgram?.kind === 'scenario-controls-v2' && !initialPriceAnchor.current) initialPriceAnchor.current = { initial: form.initialPrice, program: form.simulationProgram };
              const anchor = initialPriceAnchor.current;
              changeForm({ ...form, initialPrice, ...(anchor ? { simulationProgram: rebaseListingMovement(anchor.program, anchor.initial, initialPrice) } : {}) });
            }} data-field="initialPrice" required /></label>
            <label>Количество токенов для владельца, {form.symbol || 'актив'}<input value={historicalMode ? '0' : form.ownerAllocation} inputMode="decimal" disabled={historicalMode} onChange={(e) => changeForm({ ...form, ownerAllocation: e.target.value.replace(',', '.') })} data-field="ownerAllocation" />
              <small>{historicalMode ? 'Историческая симуляция не выдаёт актив: всегда 0.' : 'Только параметр. Создание, предпросмотр и публикация ничего не зачисляют.'}</small></label>
            <label>Дата и время листинга<input type="datetime-local" value={form.wallTime} onChange={(e) => changeForm({ ...form, wallTime: e.target.value })} data-field="wallTime" required /></label>
            <label>Часовой пояс<select value={form.timeZone} onChange={(e) => changeForm({ ...form, timeZone: e.target.value })} data-field="timeZone">
              {LISTING_TIME_ZONES.map((zone) => <option key={zone} value={zone}>{listingTimeZoneLabel(zone)}</option>)}
            </select>
              <small data-listing-utc>{listingAtUtc ? `= ${listingMoment(listingAtUtc, form.timeZone)}` : 'Время указывается в выбранном поясе'}</small></label>
            <fieldset className="listing-seed" disabled={editing.locked}>
              <legend>Код варианта</legend>
              <label><input type="radio" checked={form.seedMode === 'auto'} onChange={() => changeForm({ ...form, seedMode: 'auto', seed: current?.draft.seed ?? '' })} /> Автоматически</label>
              <label><input type="radio" checked={form.seedMode === 'manual'} onChange={() => changeForm({ ...form, seedMode: 'manual' })} /> Вручную</label>
              {form.seedMode === 'manual' && <input value={form.seed} onChange={(e) => changeForm({ ...form, seed: e.target.value.toLowerCase() })} placeholder="например: qax-0001" data-field="seed" />}
              {form.seedMode === 'auto' && form.seed && <small>Сохранён: <code data-saved-seed>{form.seed}</code> — не меняется при правках.</small>}
              <small>Код сохраняет повторяемость симуляции; это не пароль и не ключ доступа.</small>
            </fieldset>
            {!form.simulationProgram && <div className="listing-profile" data-listing-profile={form.simulationProfile ?? (editing.id ? 'original' : 'pending')}>
              <span>Характер свечей (симуляция)</span>
              <b>{form.simulationProfile ? listingProfileLabel(form.simulationProfile) : editing.id ? 'Исходный' : 'Назначится при создании'}</b>
              <small>По очереди для новых листингов: спокойный тренд → импульсный → с откатами → сжатие и пробой. Меняет только вид свечей, не траекторию и не итоговую цену; после создания не меняется.</small>
            </div>}
            <div className="listing-logo">
              <span>Логотип</span>
              <div>
                {form.logo ? <img src={form.logo} alt="Логотип" width={40} height={40} /> : <span className="listing-letter">{form.symbol[0] ?? '?'}</span>}
                <label className="listing-file-button">Выбрать файл<input type="file" accept={LOGO_TYPES.join(',')} onChange={onLogo} data-field="logo" aria-label="Загрузить логотип" /></label>
                {form.logo && <button type="button" onClick={() => { cancelLogoRead(); changeForm({ ...form, logo: null }); }}>Убрать</button>}
              </div>
              <small>PNG, JPEG, WebP или SVG, до 64 КБ.</small>
              {logoReading && <small role="status" data-logo-reading>Загрузка логотипа…</small>}
            </div>
            <label className="listing-check"><input type="checkbox" checked={form.tradable} disabled={Boolean(form.simulationProgram)} onChange={(e) => changeForm({ ...form, tradable: e.target.checked })} data-field="tradable" /> Спотовая торговля после листинга
              <small>{form.simulationProgram ? 'Для ограниченной демонстрации исполнение заявок недоступно. Сохранение и публикация не меняют балансы.' : 'Заявки сводятся только с реальными заявками пользователей; отображаемый стакан — не ликвидность.'}</small></label>
          </div>
          {form.simulationProgram?.kind === 'scenario-controls-v2' && <div id="listing-section-movement" className="listing-section-anchor"><ListingMovementEditor key={editing.id ?? 'new'} value={form.simulationProgram} initialPrice={form.initialPrice} listingAt={listingAtUtc} locked={editing.locked} savedModels={savedModels} onChange={simulationProgram => changeForm({ ...form, simulationProgram,
            ...(simulationProgram.afterGrowth === 'historical' ? { ownerAllocation: '0' } : {}) })} /></div>}
          {form.simulationProgram?.kind === 'capped-growth-range-v1' && <p className="listing-hint" data-legacy-movement>Сохранён прежний ограниченный сценарий. Его параметры и история не заменяются новым алгоритмом.</p>}
          {!form.simulationProgram && !editing.locked && <button type="button" onClick={() => changeForm({ ...form, simulationProgram: newListingMovement(form.initialPrice || '1'), tradable: false })} data-enable-movement>Настроить движение в демонстрационном режиме</button>}
          {/* The error and the unsaved-draft note travel with the actions, so a refused
              save is shown next to the button that was pressed. */}
          <div className="listing-actions-dock">
            {formError && <p role="alert" style={styles.errorBox} data-listing-error>{formError}</p>}
            {editing.id && !draftIsSaved && !logoReading && <p className="listing-hint" role="status" data-unsaved-draft>Настройки изменены — обновите предпросмотр. Сначала сохраните изменения черновика, чтобы открыть предпросмотр или опубликовать их.</p>}
            {publicationBlocked && <p className="listing-hint" role="status" data-publish-needs-timer>Первая публикация закрыта: сервер API пока без таймера листинга и показал бы рынок на бирже сразу. Черновик и предпросмотр доступны.</p>}
            {historicalMode && <p className="listing-hint" role="status" data-historical-publish-gate>Историческая модель: сохранение черновика и предпросмотр доступны, публичный запуск заблокирован до подтверждения прав и полной изоляции симуляционных счетов.</p>}
            <div className="listing-buttons">
              <button type="submit" className="listing-primary" disabled={busy || logoReading} data-save-draft>Сохранить черновик</button>
              {editing.id && <button type="button" disabled={busy || !draftIsSaved} onClick={() => void runPreview()} data-preview>Предпросмотр</button>}
              {current && <button type="button" disabled={busy || !draftIsSaved || historicalMode || publicationBlocked} onClick={openPublish} data-publish>Опубликовать</button>}
              <button type="button" onClick={() => { cancelLogoRead(); setEditing(null); setPublishing(null); invalidatePreview(); }}>Закрыть</button>
            </div>
          </div>
          {editing.id && form.simulationProgram?.kind === 'scenario-controls-v2' && <div className="listing-preview-selectors listing-grid" id="listing-section-preview">
            <label>Отрезок предпросмотра<select value={previewHorizon} data-field="previewHorizon" onChange={e => { invalidatePreview(); setPreviewHorizon(e.target.value as typeof previewHorizon); setPreviewInterval(e.target.value === 'first24h' ? '5m' : e.target.value === 'history' ? (Math.min(historicalHours + 24, 720) < 359 ? '1h' : '4h') : '1h'); }}><option value="first24h">Первые 24 часа</option><option value="growth">Весь этап роста</option><option value="afterGrowth">Поведение после роста</option>{historicalMode && historicalHours > 0 && <option value="history">{historicalHours + 24 <= 720 ? `Весь исторический отрезок (${historicalHours} ч)` : 'Исторический отрезок: первые 30 дней'}</option>}</select></label>
            <label>Интервал свечей<select value={previewInterval} data-field="previewInterval" onChange={e => { invalidatePreview(); setPreviewInterval(e.target.value); }}><option value="5m">5 минут</option><option value="15m">15 минут</option><option value="1h">1 час</option><option value="4h">4 часа</option><option value="1d">1 день</option></select><small>До 360 свечей за запрос. Для длинного отрезка выберите более крупный интервал.</small></label>
          </div>}
          {editing.id && form.simulationProgram?.kind !== 'scenario-controls-v2' && (
            <div className="listing-preview-controls" id="listing-section-preview">
              <label>Момент предпросмотра ({listingTimeZoneLabel(form.timeZone)})<input type="datetime-local" value={previewAt} onChange={(e) => { invalidatePreview(); setPreviewAt(e.target.value); }} data-field="previewAt" /></label>
              <small>Пусто = через 2 часа после листинга. Предпросмотр виден только администратору.</small>
            </div>
          )}
          {preview && draftIsSaved && (
            <section className="listing-preview" data-listing-preview={preview.asset.state.phase} aria-label="Предпросмотр симуляции">
              <header>
                <b>{preview.asset.pair}</b>
                <span>{preview.asset.state.phase === 'live' ? 'Симуляция после листинга' : 'До листинга'} · {new Date(preview.previewAt).toISOString().replace('.000Z', 'Z')}</span>
                {preview.asset.state.lastPrice !== null && <span data-preview-price>{preview.asset.state.lastPrice} USDT ({preview.asset.state.change24hPercent?.toFixed(2)}%)</span>}
              </header>
              <p className="listing-hint">Цены, объёмы, стакан и сделки в этом предпросмотре сгенерированы. Это симуляция, а не реальные рыночные данные.</p>
              {preview.scenarioSummary && <dl className="listing-preview-metrics" data-preview-summary>
                <div><dt>Начальная цена</dt><dd>{formatMovementPrice(preview.scenarioSummary.initialPrice)} USDT</dd></div>
                <div><dt>Цена через 24 часа</dt><dd>{formatMovementPrice(preview.scenarioSummary.first24hPrice)} USDT</dd></div>
                <div><dt>Максимальная разрешённая цена</dt><dd>{formatMovementPrice(preview.scenarioSummary.maxPrice)} USDT</dd></div>
                <div><dt>Максимум показанного отрезка</dt><dd>{formatMovementPrice(preview.scenarioSummary.observedHigh)} USDT</dd></div>
                {preview.scenarioSummary.observedLow !== undefined && <div><dt>Минимум показанного отрезка</dt><dd>{formatMovementPrice(preview.scenarioSummary.observedLow)} USDT</dd></div>}
              </dl>}
              <ListingCandlePreview candles={preview.candles} />
              <small className="listing-hint">{preview.candles.length} свечей · время на графике: Всемирное время (UTC). Объём — модельная активность.</small>
              <div className="listing-preview-grid">
                <div><h3>Стакан (симуляция)</h3>{preview.book.available ? preview.book.asks.slice(0, 5).reverse().concat(preview.book.bids.slice(0, 5)).map((level, i) =>
                  <div key={i} className={i < 5 ? 'ask' : 'bid'}><span>{level.price}</span><span>{level.quantity}</span></div>) : <p className="listing-muted">—</p>}</div>
                <div><h3>Сделки (симуляция)</h3>{preview.trades.slice(0, 10).map((trade) => <div key={trade.id} className={trade.side === 'BUY' ? 'bid' : 'ask'}><span>{trade.price}</span><span>{trade.quantity}</span></div>)}
                  {!preview.trades.length && <p className="listing-muted">—</p>}</div>
              </div>
            </section>
          )}
          {current && current.versions.length > 0 && (
            <section className="listing-versions" aria-label="Версии">
              <h3>Опубликованные версии</h3>
              {current.versions.map((v) => <div key={v.version}>Версия {v.version} · {new Date(v.publishedAt).toLocaleString('ru-RU')} · {v.publishedBy}{v.version === current.activeVersion ? ' · активна' : ''}</div>)}
            </section>
          )}
        </form>
      )}

      {publishing && (
        <div className="listing-dialog-backdrop" role="presentation">
          <div className="listing-dialog" role="dialog" aria-modal="true" aria-label="Публикация листинга" data-publish-dialog ref={publishDialog} tabIndex={-1}>
            <h2>Опубликовать {publishing.listing.draft.symbol}/USDT?</h2>
            <p>{publishing.listing.draft.name} · начальная цена {publishing.listing.draft.initialPrice} USDT</p>
            <p>Листинг: {listingMoment(publishing.listing.draft.listingAt, publishing.listing.draft.displayTimeZone)}</p>
            <p data-publish-timer-line>Таймер на бирже: {listingTimerLine(publishing.listing.draft.listingAt)}</p>
            {!listingPublicationAllowed(publishing.listing, timerSupported) ? (
              <p className="listing-hint" role="alert" data-publish-timer-unsupported>Первая публикация закрыта: сервер API пока без таймера листинга и показал бы рынок на бирже сразу.</p>
            ) : publishing.listing.activeVersion === null ? (
              <label className="listing-check"><input type="checkbox" checked={publishing.startTimer} disabled={busy}
                onChange={(e) => setPublishing({ ...publishing, startTimer: e.target.checked })} data-field="publishStartTimer" /> Запустить таймер сразу после публикации
                <small>{publishing.startTimer ? 'Рынок и обратный отсчёт появятся на бирже при ближайшем обновлении списка.'
                  : 'Рынок останется скрытым с биржи до нажатия «Запустить таймер» в списке листингов. Дата при этом не меняется.'}</small></label>
            ) : <p className="listing-hint">Состояние таймера сохраняется: публикация новой версии его не запускает и не останавливает.</p>}
            <p className="listing-hint">Тикер, код варианта, начальная цена и настройки движения фиксируются. Баланс владельца не зачисляется.</p>
            <div className="listing-buttons">
              <button type="button" className="listing-primary" disabled={busy || !draftIsSaved || !listingPublicationAllowed(publishing.listing, timerSupported)} onClick={() => void confirmPublish()} data-confirm-publish>Опубликовать</button>
              <button type="button" disabled={busy} onClick={() => setPublishing(null)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
