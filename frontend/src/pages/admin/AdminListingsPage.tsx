import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { styles } from './adminStyles';
import {
  adminListingsApi, ListingApiError, LISTING_TIME_ZONES, newPublishKey, utcOffsetLabel, utcToZonedWallTime, zonedWallTimeToUtc,
  type AdminListing, type ListingConfig, type ListingForm, type ListingPreview,
} from './adminListingsApi';
import { LISTING_REVISION_CONFLICT, listingProfileLabel, listingRequestError, listingTimeZoneLabel } from './adminListingsCopy';
import { ListingScenarioLab } from './ListingScenarioLab';
import { ListingMovementEditor } from './ListingMovementEditor';
import { ListingCandlePreview } from './ListingCandlePreview';
import { formatMovementPrice, historicalModelLabel, isHistoricalWindow, newListingMovement, rebaseListingMovement, validateListingMovement, type ListingMovement, type ListingProgram } from './listingMovementModel';
import { historicalGrowthProvenance, ListingHistoricalGrowthPanel } from './ListingHistoricalGrowthPanel';
import { HISTORICAL_GROWTH_LABEL, HISTORICAL_GROWTH_PREVIEW_UNIT, historicalGrowthDays, historicalWindowMovement, type HistoricalGrowthProgram } from './historicalGrowthModel';
import { useAdminCompact } from './useAdminCompact';
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

/**
 * The owner's file proposal 04_NEXT_LISTING_DRAFT.json (BotLab 01). Prefilled
 * only: the name and ticker are not checked for uniqueness until saved and
 * the start time is left for the admin to choose. Nothing is created here.
 */
const BOTLAB_01 = { name: 'VOLTEX BotLab 01', symbol: 'VHX01', initialPrice: '2', scenarioId: 'VHX-01-BTC' } as const;

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

/** The instant in the listing's own zone and in UTC, always both. */
function listingMoment(iso: string, timeZone: string): string {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) return '—';
  const fmt = (zone: string, date: boolean) => new Intl.DateTimeFormat('ru-RU', {
    ...(date ? { day: '2-digit', month: '2-digit', year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone,
  }).format(new Date(instant)).replace(',', '');
  return `${fmt('UTC', true)} Всемирное время (UTC) · ${fmt('Europe/Kyiv', true)} Киев (${utcOffsetLabel(instant, 'Europe/Kyiv')})${timeZone !== 'UTC' && timeZone !== 'Europe/Kyiv' ? ` · ${fmt(timeZone, true)} ${listingTimeZoneLabel(timeZone)}` : ''}`;
}

function statusOf(listing: AdminListing): { text: string; tone: 'draft' | 'live' | 'changed' } {
  if (listing.activeVersion === null) return { text: 'Черновик', tone: 'draft' };
  const changed = JSON.stringify(listing.active) !== JSON.stringify(listing.draft);
  return changed ? { text: `Опубликован: версия ${listing.activeVersion} · есть неопубликованные изменения`, tone: 'changed' } : { text: `Опубликован: версия ${listing.activeVersion}`, tone: 'live' };
}

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
  const [previewHorizon, setPreviewHorizon] = useState<'first24h' | 'growth' | 'afterGrowth' | 'history' | 'window'>('first24h');
  const [previewFromDay, setPreviewFromDay] = useState('0');
  /** The growth window was chosen as the mode but no window is applied yet (the stages stay until one is). */
  const [windowPending, setWindowPending] = useState(false);
  const [autoChoose, setAutoChoose] = useState<string | undefined>(undefined);
  /** The stages program to restore on «Вернуться к этапам». */
  const stagesProgram = useRef<ListingMovement | null>(null);
  const [previewInterval, setPreviewInterval] = useState('5m');
  const [publishing, setPublishing] = useState<{ listing: AdminListing; key: string } | null>(null);
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
  const windowMode = isHistoricalWindow(form.simulationProgram);
  const historicalMode = form.simulationProgram?.kind === 'scenario-controls-v2' && (form.simulationProgram.afterGrowth === 'historical' || windowMode);
  const windowDays = windowMode && form.simulationProgram?.kind === 'scenario-controls-v2' && form.simulationProgram.historicalGrowth ? historicalGrowthDays(form.simulationProgram.historicalGrowth) : 0;
  // The rotation's saved cursor: one step per OTHER listing ID that already uses a growth window.
  const rotationCursor = (listings ?? []).filter(listing => listing.id !== editing?.id
    && (isHistoricalWindow(listing.draft.simulationProgram) || isHistoricalWindow(listing.active?.simulationProgram))).length;
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
    cancelLogoRead(); setWindowPending(false); setAutoChoose(undefined); stagesProgram.current = null;
    setEditing({ id: null, revision: 0, locked: false });
    changeForm(emptyForm()); setFormError(null); setNotice(null);
  }
  /** BotLab 01 from the owner's proposal file: a new, unsaved form in growth-window mode. */
  function openBotLab() {
    openCreate();
    changeForm({ ...emptyForm(), name: BOTLAB_01.name, symbol: BOTLAB_01.symbol, initialPrice: BOTLAB_01.initialPrice, timeZone: 'UTC',
      simulationProgram: newListingMovement(BOTLAB_01.initialPrice) });
    setWindowPending(true); setAutoChoose(BOTLAB_01.scenarioId);
    setNotice('Предложение BotLab 01 заполнено, но не сохранено: проверьте уникальность тикера, выберите время запуска и сохраните черновик.');
  }
  /** Clone the window (not the listing) into a NEW listing ID; the original draft and its history stay as they are. */
  function cloneWindow() {
    if (!windowMode) return;
    const source = form;
    initialPriceAnchor.current = null; cancelLogoRead(); setWindowPending(false); setAutoChoose(undefined);
    setEditing({ id: null, revision: 0, locked: false });
    changeForm({ ...emptyForm(), name: source.name ? `${source.name.slice(0, 32)} (копия)` : '', initialPrice: source.initialPrice, timeZone: source.timeZone,
      simulationProgram: source.simulationProgram });
    setFormError(null);
    setNotice('Копия окна в новом листинге: укажите новый тикер и время запуска. Исходный черновик не изменён.');
  }
  function chooseWindow(program: HistoricalGrowthProgram) {
    changeForm(previous => {
      const base = previous.simulationProgram?.kind === 'scenario-controls-v2' ? previous.simulationProgram : newListingMovement(previous.initialPrice || '1');
      if (!isHistoricalWindow(base)) stagesProgram.current = base;
      return { ...previous, ownerAllocation: '0', tradable: false, simulationProgram: historicalWindowMovement(base, previous.initialPrice || '1', program) };
    });
    setWindowPending(false); setAutoChoose(undefined);
    setPreviewHorizon('first24h'); setPreviewInterval('5m');
  }
  function returnToStages() {
    const restored = stagesProgram.current ?? newListingMovement(form.initialPrice || '1');
    stagesProgram.current = null; setWindowPending(false); setAutoChoose(undefined);
    // The previous initial price is read back from the day-one stage, so the restored stages follow today's P0.
    changeForm({ ...form, simulationProgram: rebaseListingMovement(restored, '', form.initialPrice || '1') });
    setPreviewHorizon('first24h'); setPreviewInterval('5m');
    setNotice('Возвращены запрограммированные этапы. Сохраните черновик, чтобы изменение вступило в силу.');
  }
  function openEdit(listing: AdminListing) {
    initialPriceAnchor.current = null;
    cancelLogoRead(); setWindowPending(false); setAutoChoose(undefined); stagesProgram.current = null;
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
      const fromDay = Number(previewFromDay);
      if (windowMode && previewHorizon === 'window' && !(Number.isSafeInteger(fromDay) && fromDay >= 0 && fromDay < windowDays)) {
        setFormError(`Укажите день окна от 0 до ${windowDays - 1}.`);
        return;
      }
      const result = await adminListingsApi.preview(editing.id, at, previewInterval, form.simulationProgram?.kind === 'scenario-controls-v2' ? previewHorizon : undefined, windowMode ? fromDay : undefined);
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
    if (!current || busy || !draftIsSaved) return;
    if (current.draft.simulationProgram?.kind === 'scenario-controls-v2'
      && (current.draft.simulationProgram.afterGrowth === 'historical' || current.draft.simulationProgram.growth === 'historical-window')) {
      setFormError('Историческое движение пока только для закрытого предпросмотра. Публикация требует проверки прав на источник и отдельного торгового счёта.');
      return;
    }
    setPublishing({ listing: current, key: newPublishKey() });
  }

  async function confirmPublish() {
    if (!publishing || busy || !draftIsSaved || publishing.listing.id !== editing?.id
      || publishing.listing.draftRevision !== editing.revision) return;
    setBusy(true);
    try {
      // The key was fixed when this confirmation opened: a retry is the same publish.
      const result = await adminListingsApi.publish(publishing.listing.id, publishing.listing.draftRevision, publishing.key);
      setEditing(previous => previous?.id === publishing.listing.id ? { ...previous, locked: true } : previous);
      setNotice(result.replayed ? `Уже опубликовано: версия ${result.version}.` : `Опубликовано: версия ${result.version}. Рынок появится при ближайшем обновлении списка.`);
      setPublishing(null);
      await load();
    } catch (error) {
      setFormError(errorText(error));
      if (error instanceof ListingApiError && error.status !== 0 && error.status < 500) setPublishing(null);
    } finally { setBusy(false); }
  }

  return (
    <div className="admin-listings">
      <h1 style={styles.title}>Листинги</h1>
      <p style={styles.subtitle}>Симуляции новых рынков: создание, приватный предпросмотр и публикация — без изменения кода и обновления приложения.</p>
      <div className="listing-toolbar">
        <button type="button" className="listing-primary" data-create-listing onClick={openCreate} disabled={notConnected}
          title={notConnected ? 'Листинги не подключены' : undefined}>+ Создать листинг</button>
        <button type="button" data-create-botlab onClick={openBotLab} disabled={notConnected}
          title="Предложение 04_NEXT_LISTING_DRAFT.json: VHX01, P0 = 2, окно VHX-01-BTC. Не сохраняется автоматически.">Черновик BotLab 01</button>
        <label>Поиск по тикеру<input type="search" value={search} onChange={e => setSearch(e.target.value)} data-field="listingSearch" /></label>
        <label>Статус публикации<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} data-field="listingStatus">
          <option value="all">Все</option><option value="draft">Черновики</option>
          <option value="live">Опубликованы</option><option value="changed">Есть неопубликованные изменения</option>
        </select></label>
      </div>
      <ListingScenarioLab />
      {notice && <p style={styles.successBox} role="status" data-listing-notice>{notice}</p>}
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
            return (
              <div className="listing-row" role="row" key={listing.id} data-listing-row={listing.draft.symbol}>
                <span className="listing-ident">
                  {listing.draft.logo ? <img src={listing.draft.logo} alt="" width={28} height={28} /> : <span className="listing-letter">{listing.draft.symbol[0]}</span>}
                  <span><b>{listing.draft.symbol}/USDT</b><small>{listing.draft.name}</small>
                    {(() => {
                      const program = listing.draft.simulationProgram?.kind === 'scenario-controls-v2' ? listing.draft.simulationProgram : null;
                      if (program?.growth === 'historical-window' && program.historicalGrowth)
                        return <small className="listing-model" data-listing-model="historical-window">Историческое окно роста: {program.historicalGrowth.scenarioId} · только черновик</small>;
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
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <form className={`listing-form${compact ? ' listing-form-compact' : ''}`} onSubmit={save} data-listing-form noValidate>
          <h2>{editing.id ? `Листинг ${form.symbol}/USDT` : 'Новый листинг'}</h2>
          {editing.locked && <p className="listing-hint">Опубликован: тикер, код варианта, начальная цена и настройки движения больше не меняются — это защищает историю цен. Время можно перенести только до открытия.</p>}
          {compact && <ListingSectionNav sections={[
            { id: 'listing-section-main', label: 'Параметры' },
            ...(form.simulationProgram?.kind === 'scenario-controls-v2' ? (windowMode || windowPending ? [{ id: 'listing-section-movement', label: 'Историческое окно' }]
              : [{ id: 'listing-section-movement', label: 'Движение' }, { id: 'listing-section-stages', label: 'Этапы' }, { id: 'listing-section-advanced', label: 'Точная настройка' }]) : []),
            ...(editing.id ? [{ id: 'listing-section-preview', label: 'Предпросмотр' }] : []),
          ]} />}
          <div className="listing-grid" id="listing-section-main">
            <label>Название<input value={form.name} maxLength={40} onChange={(e) => changeForm({ ...form, name: e.target.value })} data-field="name" required /></label>
            <label>Тикер<input value={form.symbol} maxLength={10} disabled={editing.locked} onChange={(e) => changeForm({ ...form, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} data-field="symbol" required /></label>
            <label>Начальная цена, {windowMode ? HISTORICAL_GROWTH_PREVIEW_UNIT : 'USDT'}<input value={form.initialPrice} inputMode="decimal" disabled={editing.locked} onFocus={() => {
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
          {form.simulationProgram?.kind === 'scenario-controls-v2' && !editing.locked && <fieldset className="listing-growth-mode" data-growth-mode={windowMode || windowPending ? 'historical-window' : 'stages'}>
            <legend>Источник роста</legend>
            <label><input type="radio" name="growthMode" checked={!windowMode && !windowPending} onChange={() => { if (windowMode) returnToStages(); else setWindowPending(false); }} data-growth-mode-stages /> Запрограммированные этапы (прежний режим; можно продолжить часовой историей после отката)</label>
            <label><input type="radio" name="growthMode" checked={windowMode || windowPending} onChange={() => setWindowPending(true)} data-growth-mode-window /> Историческое окно роста (History20) — вместо этапов</label>
            <small>Режимы взаимоисключающие: нормализованный исторический рост не накладывается на уже запрограммированный.</small>
          </fieldset>}
          {form.simulationProgram?.kind === 'scenario-controls-v2' && (windowMode || windowPending) && <div id="listing-section-movement" className="listing-section-anchor">
            <ListingHistoricalGrowthPanel program={windowMode ? form.simulationProgram.historicalGrowth : undefined} initialPrice={form.initialPrice} listingAt={listingAtUtc}
              rotationCursor={rotationCursor} locked={editing.locked} draftSymbol={form.symbol} autoChoose={autoChoose} onChoose={chooseWindow} onReturn={returnToStages} />
          </div>}
          {form.simulationProgram?.kind === 'scenario-controls-v2' && !windowMode && !windowPending && <div id="listing-section-movement" className="listing-section-anchor"><ListingMovementEditor key={editing.id ?? 'new'} value={form.simulationProgram} initialPrice={form.initialPrice} listingAt={listingAtUtc} locked={editing.locked} savedModels={savedModels} onChange={simulationProgram => changeForm({ ...form, simulationProgram,
            ...(simulationProgram.afterGrowth === 'historical' ? { ownerAllocation: '0' } : {}) })} /></div>}
          {form.simulationProgram?.kind === 'capped-growth-range-v1' && <p className="listing-hint" data-legacy-movement>Сохранён прежний ограниченный сценарий. Его параметры и история не заменяются новым алгоритмом.</p>}
          {!form.simulationProgram && !editing.locked && <button type="button" onClick={() => changeForm({ ...form, simulationProgram: newListingMovement(form.initialPrice || '1'), tradable: false })} data-enable-movement>Настроить движение в демонстрационном режиме</button>}
          {/* The error and the unsaved-draft note travel with the actions, so a refused
              save is shown next to the button that was pressed. */}
          <div className="listing-actions-dock">
            {formError && <p role="alert" style={styles.errorBox} data-listing-error>{formError}</p>}
            {editing.id && !draftIsSaved && !logoReading && <p className="listing-hint" role="status" data-unsaved-draft>Настройки изменены — обновите предпросмотр. Сначала сохраните изменения черновика, чтобы открыть предпросмотр или опубликовать их.</p>}
            {historicalMode && <p className="listing-hint" role="status" data-historical-publish-gate>Историческая модель: сохранение черновика и предпросмотр доступны, публичный запуск заблокирован до подтверждения прав и полной изоляции симуляционных счетов.{windowMode ? ` ${HISTORICAL_GROWTH_LABEL}.` : ''}</p>}
            {windowPending && !windowMode && <p className="listing-hint" role="status" data-window-pending>Выберите окно в библиотеке: до этого черновик сохраняется с этапами.</p>}
            <div className="listing-buttons">
              <button type="submit" className="listing-primary" disabled={busy || logoReading} data-save-draft>Сохранить черновик</button>
              {editing.id && <button type="button" disabled={busy || !draftIsSaved} onClick={() => void runPreview()} data-preview>Предпросмотр</button>}
              {current && <button type="button" disabled={busy || !draftIsSaved || historicalMode} onClick={openPublish} data-publish>Опубликовать</button>}
              {editing.id && windowMode && <button type="button" disabled={busy} onClick={cloneWindow} data-clone-window>Клонировать в новый листинг</button>}
              <button type="button" onClick={() => { cancelLogoRead(); setEditing(null); setPublishing(null); invalidatePreview(); }}>Закрыть</button>
            </div>
          </div>
          {editing.id && windowMode && <div className="listing-preview-selectors listing-grid" id="listing-section-preview" data-window-preview-selectors>
            <label>Отрезок предпросмотра<select value={previewHorizon === 'window' ? 'window' : 'first24h'} data-field="previewHorizon" onChange={e => { invalidatePreview(); setPreviewHorizon(e.target.value as typeof previewHorizon); setPreviewInterval(e.target.value === 'window' ? '4h' : '5m'); }}>
              <option value="first24h">Первые 24 часа</option><option value="window">Фрагмент окна: до 30 суток</option></select></label>
            {previewHorizon === 'window' && <label>С суток окна (0 — запуск)<input inputMode="numeric" value={previewFromDay} data-field="previewFromDay" onChange={e => { invalidatePreview(); setPreviewFromDay(e.target.value.replace(/\D/g, '').slice(0, 4)); }} /><small>Из {windowDays} суток; сервер считает только запрошенный фрагмент.</small></label>}
            <label>Интервал свечей<select value={previewInterval} data-field="previewInterval" onChange={e => { invalidatePreview(); setPreviewInterval(e.target.value); }}><option value="5m">5 минут</option><option value="15m">15 минут</option><option value="1h">1 час</option><option value="4h">4 часа</option><option value="1d">1 день</option></select><small>До 360 свечей за запрос.</small></label>
          </div>}
          {editing.id && form.simulationProgram?.kind === 'scenario-controls-v2' && !windowMode && <div className="listing-preview-selectors listing-grid" id="listing-section-preview">
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
                {/* A growth window is priced in the preview's own accounting unit, never a deposit currency. */}
                <b>{preview.scenarioSummary?.historicalGrowth ? preview.asset.pair.replace(/\/USDT$/, `/${HISTORICAL_GROWTH_PREVIEW_UNIT}`) : preview.asset.pair}</b>
                <span>{preview.asset.state.phase === 'live' ? 'Симуляция после листинга' : 'До листинга'} · {new Date(preview.previewAt).toISOString().replace('.000Z', 'Z')}</span>
                {preview.asset.state.lastPrice !== null && <span data-preview-price>{preview.asset.state.lastPrice} {preview.scenarioSummary?.historicalGrowth ? HISTORICAL_GROWTH_PREVIEW_UNIT : 'USDT'} ({preview.asset.state.change24hPercent?.toFixed(2)}%)</span>}
              </header>
              <p className="listing-hint">Цены, объёмы, стакан и сделки в этом предпросмотре сгенерированы. Это симуляция, а не реальные рыночные данные.</p>
              {preview.scenarioSummary && (() => {
                const summary = preview.scenarioSummary, window = summary.historicalGrowth, unit = window ? window.unit : 'USDT';
                return <dl className="listing-preview-metrics" data-preview-summary>
                  <div><dt>Начальная цена</dt><dd>{formatMovementPrice(summary.initialPrice)} {unit}</dd></div>
                  <div><dt>Цена через 24 часа{window ? ' (модель окна)' : ''}</dt><dd>{formatMovementPrice(Number(Number(summary.first24hPrice).toPrecision(10)))} {unit}</dd></div>
                  <div><dt>Максимальная разрешённая цена{window ? ' = P0 · M' : ''}</dt><dd>{formatMovementPrice(summary.maxPrice)} {unit}</dd></div>
                  <div><dt>Максимум показанного отрезка</dt><dd>{formatMovementPrice(summary.observedHigh)} {unit}</dd></div>
                  {summary.observedLow !== undefined && <div><dt>Минимум показанного отрезка</dt><dd>{formatMovementPrice(summary.observedLow)} {unit}</dd></div>}
                  {window && <div data-preview-window><dt>Окно {window.scenarioId}</dt><dd>сутки {window.fromDay}–{window.toDay} из {window.windowDays} · α {window.alpha.toFixed(4)} · {window.clock}</dd></div>}
                </dl>;
              })()}
              <ListingCandlePreview candles={preview.candles} />
              <small className="listing-hint">{preview.candles.length} свечей · время на графике: Всемирное время (UTC). Объём — модельная активность.</small>
              {preview.scenarioSummary?.historicalGrowth && (() => {
                const window = preview.scenarioSummary.historicalGrowth;
                const provenance = historicalGrowthProvenance({ intrabar: window.intrabar, source: { dataKind: window.dataKind, provider: window.provider, metric: window.metric } });
                // 1d candles of an OHLC source are the observed bars; every finer candle is the intraday model.
                return <p className="listing-hint" data-preview-provenance={preview.scenarioSummary.interval === '1d' ? 'daily' : 'intraday'}>
                  {preview.scenarioSummary.interval === '1d' ? provenance.observed : 'Свечи этого интервала — синтетическая модель внутри суток, а не исторические наблюдения.'} {provenance.modeled}
                </p>;
              })()}
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
            <p className="listing-hint">После публикации рынок виден всем. Тикер, код варианта, начальная цена и настройки движения фиксируются. Баланс владельца не зачисляется.</p>
            <div className="listing-buttons">
              <button type="button" className="listing-primary" disabled={busy || !draftIsSaved} onClick={() => void confirmPublish()} data-confirm-publish>Опубликовать</button>
              <button type="button" disabled={busy} onClick={() => setPublishing(null)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
