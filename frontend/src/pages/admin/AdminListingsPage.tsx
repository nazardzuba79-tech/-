import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { styles } from './adminStyles';
import {
  adminListingsApi, ListingApiError, LISTING_TIME_ZONES, newPublishKey, utcOffsetLabel, utcToZonedWallTime, zonedWallTimeToUtc,
  type AdminListing, type ListingConfig, type ListingForm, type ListingPreview,
} from './adminListingsApi';
import { LISTING_REVISION_CONFLICT, listingProfileLabel, listingRequestError, listingTimeZoneLabel } from './adminListingsCopy';
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
}

const emptyForm = (): FormState => ({
  name: '', symbol: '', logo: null, initialPrice: '', wallTime: '', timeZone: 'Europe/Kyiv', ownerAllocation: '0',
  seedMode: 'auto', seed: '', tradable: false, simulationProfile: null,
});

const fromConfig = (config: ListingConfig): FormState => ({
  name: config.name, symbol: config.symbol, logo: config.logo, initialPrice: config.initialPrice,
  wallTime: utcToZonedWallTime(config.listingAt, config.displayTimeZone), timeZone: config.displayTimeZone,
  ownerAllocation: config.ownerAllocation, seedMode: config.seedMode, seed: config.seed, tradable: config.tradable,
  simulationProfile: config.simulationProfile ?? null,
});

// Compare editable values, including exact text drafts. An automatic seed is
// assigned by the store; a hidden manual-seed edit does not change auto mode.
const formSignature = (form: FormState): string => JSON.stringify([
  form.name, form.symbol, form.logo, form.initialPrice, form.wallTime, form.timeZone,
  form.ownerAllocation, form.seedMode, form.seedMode === 'manual' ? form.seed : null, form.tradable,
]);

/** The instant in the listing's own zone and in UTC, always both. */
function listingMoment(iso: string, timeZone: string): string {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) return '—';
  const fmt = (zone: string, date: boolean) => new Intl.DateTimeFormat('ru-RU', {
    ...(date ? { day: '2-digit', month: '2-digit', year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone,
  }).format(new Date(instant)).replace(',', '');
  return timeZone === 'UTC' ? `${fmt('UTC', true)} UTC` : `${fmt(timeZone, true)} ${listingTimeZoneLabel(timeZone)} (${utcOffsetLabel(instant, timeZone)}) · ${fmt('UTC', false)} UTC`;
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

/** A tiny close-price line: enough to see that the preview history exists and is stable. */
function PreviewSpark({ candles }: { candles: ListingPreview['candles'] }) {
  if (candles.length < 2) return <div className="listing-spark-empty">Свечей ещё нет — рынок до листинга.</div>;
  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes), max = Math.max(...closes), span = max - min || 1;
  const points = closes.map((close, i) => `${(i / (closes.length - 1)) * 300},${60 - ((close - min) / span) * 56 - 2}`).join(' ');
  return <svg className="listing-spark" viewBox="0 0 300 60" preserveAspectRatio="none" role="img" aria-label="График предпросмотра"><polyline points={points} /></svg>;
}

export function AdminListingsPage() {
  const [listings, setListings] = useState<AdminListing[] | null>(null);
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
  const [publishing, setPublishing] = useState<{ listing: AdminListing; key: string } | null>(null);
  const loading = useRef(false);
  const mounted = useRef(false);
  const listRequest = useRef<AbortController | null>(null);
  const previewRequest = useRef(0);
  const logoRequest = useRef(0);

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
  const listingAtUtc = form.wallTime ? zonedWallTimeToUtc(form.wallTime, form.timeZone) : null;
  const draftIsSaved = Boolean(!logoReading && current && editing?.revision === current.draftRevision
    && formSignature(form) === formSignature(fromConfig(current.draft)));

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
    cancelLogoRead();
    setEditing({ id: null, revision: 0, locked: false });
    changeForm(emptyForm()); setFormError(null); setNotice(null);
  }
  function openEdit(listing: AdminListing) {
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
    if (!listingAtUtc) return setFormError('Укажите дату и время листинга.');
    const payload: ListingForm = {
      name: form.name.trim(), symbol: form.symbol.trim().toUpperCase(), logo: form.logo, initialPrice: form.initialPrice.trim(),
      listingAt: listingAtUtc, displayTimeZone: form.timeZone, ownerAllocation: form.ownerAllocation.trim() || '0',
      seedMode: form.seedMode, ...(form.seedMode === 'manual' ? { seed: form.seed.trim() } : {}), tradable: form.tradable,
    };
    setBusy(true); setFormError(null);
    try {
      const saved = editing.id ? await adminListingsApi.saveDraft(editing.id, payload, editing.revision) : await adminListingsApi.create(payload);
      setEditing({ id: saved.id, revision: saved.draftRevision, locked: editing.locked });
      changeForm(fromConfig(saved.draft));
      setNotice(`Черновик ${saved.draft.symbol}/USDT сохранён (ревизия ${saved.draftRevision}). Код генерации: ${saved.draft.seed}`);
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
      const result = await adminListingsApi.preview(editing.id, at);
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
    setPublishing({ listing: current, key: newPublishKey() });
  }

  async function confirmPublish() {
    if (!publishing || busy || !draftIsSaved || publishing.listing.id !== editing?.id
      || publishing.listing.draftRevision !== editing.revision) return;
    setBusy(true);
    try {
      // The key was fixed when this confirmation opened: a retry is the same publish.
      const result = await adminListingsApi.publish(publishing.listing.id, publishing.listing.draftRevision, publishing.key);
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
      </div>
      {notice && <p style={styles.successBox} role="status" data-listing-notice>{notice}</p>}
      {loadError && (
        <p role="alert" style={styles.errorBox} className="admin-inline-alert" data-listings-state={notConnected ? 'not-connected' : 'error'}>
          <span>{loadError}</span>
          <button type="button" className="admin-inline-retry" onClick={() => void load()}>Повторить</button>
        </p>
      )}

      {listings === null && !loadError && <p className="listing-muted">Загрузка…</p>}
      {listings && listings.length === 0 && <p className="listing-muted">Листингов пока нет.</p>}
      {listings && listings.length > 0 && (
        <div className="listing-table" role="table" aria-label="Листинги">
          {listings.map((listing) => {
            const status = statusOf(listing);
            return (
              <div className="listing-row" role="row" key={listing.id} data-listing-row={listing.draft.symbol}>
                <span className="listing-ident">
                  {listing.draft.logo ? <img src={listing.draft.logo} alt="" width={28} height={28} /> : <span className="listing-letter">{listing.draft.symbol[0]}</span>}
                  <span><b>{listing.draft.symbol}/USDT</b><small>{listing.draft.name}</small></span>
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
        <form className="listing-form" onSubmit={save} data-listing-form noValidate>
          <h2>{editing.id ? `Листинг ${form.symbol}/USDT` : 'Новый листинг'}</h2>
          {editing.locked && <p className="listing-hint">Опубликован: тикер, код генерации и начальная цена больше не меняются — это защищает историю цен. Время можно перенести только до открытия.</p>}
          <div className="listing-grid">
            <label>Название<input value={form.name} maxLength={40} onChange={(e) => changeForm({ ...form, name: e.target.value })} data-field="name" required /></label>
            <label>Тикер<input value={form.symbol} maxLength={10} disabled={editing.locked} onChange={(e) => changeForm({ ...form, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} data-field="symbol" required /></label>
            <label>Начальная цена, USDT<input value={form.initialPrice} inputMode="decimal" disabled={editing.locked} onChange={(e) => changeForm({ ...form, initialPrice: e.target.value.replace(',', '.') })} data-field="initialPrice" required /></label>
            <label>Количество токенов для владельца, {form.symbol || 'актив'}<input value={form.ownerAllocation} inputMode="decimal" onChange={(e) => changeForm({ ...form, ownerAllocation: e.target.value.replace(',', '.') })} data-field="ownerAllocation" />
              <small>Только параметр. Создание, предпросмотр и публикация ничего не зачисляют.</small></label>
            <label>Дата и время листинга<input type="datetime-local" value={form.wallTime} onChange={(e) => changeForm({ ...form, wallTime: e.target.value })} data-field="wallTime" required /></label>
            <label>Часовой пояс<select value={form.timeZone} onChange={(e) => changeForm({ ...form, timeZone: e.target.value })} data-field="timeZone">
              {LISTING_TIME_ZONES.map((zone) => <option key={zone} value={zone}>{listingTimeZoneLabel(zone)}</option>)}
            </select>
              <small data-listing-utc>{listingAtUtc ? `= ${listingMoment(listingAtUtc, form.timeZone)}` : 'Время указывается в выбранном поясе'}</small></label>
            <fieldset className="listing-seed" disabled={editing.locked}>
              <legend>Код генерации истории цены</legend>
              <label><input type="radio" checked={form.seedMode === 'auto'} onChange={() => changeForm({ ...form, seedMode: 'auto', seed: current?.draft.seed ?? '' })} /> Автоматически</label>
              <label><input type="radio" checked={form.seedMode === 'manual'} onChange={() => changeForm({ ...form, seedMode: 'manual' })} /> Вручную</label>
              {form.seedMode === 'manual' && <input value={form.seed} onChange={(e) => changeForm({ ...form, seed: e.target.value.toLowerCase() })} placeholder="например: qax-0001" data-field="seed" />}
              {form.seedMode === 'auto' && form.seed && <small>Сохранён: <code data-saved-seed>{form.seed}</code> — не меняется при правках.</small>}
              <small>Код сохраняет повторяемость симуляции; это не пароль и не ключ доступа.</small>
            </fieldset>
            <div className="listing-profile" data-listing-profile={form.simulationProfile ?? (editing.id ? 'original' : 'pending')}>
              <span>Характер свечей (симуляция)</span>
              <b>{form.simulationProfile ? listingProfileLabel(form.simulationProfile) : editing.id ? 'Исходный' : 'Назначится при создании'}</b>
              <small>По очереди для новых листингов: спокойный тренд → импульсный → с откатами → сжатие и пробой. Меняет только вид свечей, не траекторию и не итоговую цену; после создания не меняется.</small>
            </div>
            <div className="listing-logo">
              <span>Логотип</span>
              <div>
                {form.logo ? <img src={form.logo} alt="Логотип" width={40} height={40} /> : <span className="listing-letter">{form.symbol[0] ?? '?'}</span>}
                <input type="file" accept={LOGO_TYPES.join(',')} onChange={onLogo} data-field="logo" aria-label="Загрузить логотип" />
                {form.logo && <button type="button" onClick={() => { cancelLogoRead(); changeForm({ ...form, logo: null }); }}>Убрать</button>}
              </div>
              <small>PNG, JPEG, WebP или SVG, до 64 КБ.</small>
              {logoReading && <small role="status" data-logo-reading>Загрузка логотипа…</small>}
            </div>
            <label className="listing-check"><input type="checkbox" checked={form.tradable} onChange={(e) => changeForm({ ...form, tradable: e.target.checked })} data-field="tradable" /> Спотовая торговля после листинга
              <small>Заявки сводятся только с реальными заявками пользователей; отображаемый стакан — не ликвидность.</small></label>
          </div>
          {formError && <p role="alert" style={styles.errorBox} data-listing-error>{formError}</p>}
          {editing.id && !draftIsSaved && !logoReading && <p className="listing-hint" role="status" data-unsaved-draft>Сначала сохраните изменения черновика, чтобы открыть предпросмотр или опубликовать их.</p>}
          <div className="listing-buttons">
            <button type="submit" className="listing-primary" disabled={busy || logoReading} data-save-draft>Сохранить черновик</button>
            {editing.id && <button type="button" disabled={busy || !draftIsSaved} onClick={() => void runPreview()} data-preview>Предпросмотр</button>}
            {current && <button type="button" disabled={busy || !draftIsSaved} onClick={openPublish} data-publish>Опубликовать</button>}
            <button type="button" onClick={() => { cancelLogoRead(); setEditing(null); setPublishing(null); invalidatePreview(); }}>Закрыть</button>
          </div>
          {editing.id && (
            <div className="listing-preview-controls">
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
              <PreviewSpark candles={preview.candles} />
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
          <div className="listing-dialog" role="dialog" aria-modal="true" aria-label="Публикация листинга" data-publish-dialog>
            <h2>Опубликовать {publishing.listing.draft.symbol}/USDT?</h2>
            <p>{publishing.listing.draft.name} · начальная цена {publishing.listing.draft.initialPrice} USDT</p>
            <p>Листинг: {listingMoment(publishing.listing.draft.listingAt, publishing.listing.draft.displayTimeZone)}</p>
            <p className="listing-hint">После публикации рынок виден всем. Тикер, код генерации и начальная цена фиксируются. Баланс владельца не зачисляется.</p>
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
