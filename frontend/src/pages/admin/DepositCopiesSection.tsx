import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { browserFetch as fetch } from '../../lib/browserActivity';
import { API_BASE, getToken, onSessionChange } from '../../lib/api';
import { CryptoIcon } from '../../components/CryptoIcon';
import { depositAssetMetadata } from '../../lib/depositAssetMetadata';
import { CopyValue } from './AdminPrimitives';
import { styles } from './adminStyles';
import { ignoreCopySignal } from './depositCopyReviewClient';
import { useAdminCompact } from './useAdminCompact';
import './depositCopies.css';

/**
 * Пополнения → «Копировали адрес»: who copied which deposit address, in
 * which network, and when the note reached the server.
 *
 * A row is a hint for the admin's own reconciliation, never evidence: a copy
 * proves no transfer, a transfer needs no copy, and nothing here credits,
 * attributes or links anything. Read only when the admin opens the section,
 * asks for «Обновить», filters or pages — never on a timer. The last page
 * stays on screen when the admin comes back.
 */

export interface DepositCopyRow {
  id: string; userId: string; email: string; displayName: string | null;
  asset: string; network: string; networkName: string; standard: string | null; destinationId: string | null;
  address: string; memo: string | null; source: string;
  receivedAt: string; clientCopiedAt: string | null;
}
interface Page { asOf: string; items: DepositCopyRow[]; nextCursor: string | null }
interface Filters { user: string; asset: string }
interface View { filters: Filters; cursors: string[]; page: Page; loadedAt: number }

/** The last view, kept across visits to Пополнения; dropped on any session change. */
let lastView: View | null = null;
onSessionChange(() => { lastView = null; });

const SOURCE_LABEL: Record<string, string> = { wallet: 'Кошелёк', header: 'Шапка сайта', otc: 'OTC', support: 'Помощник' };
/** A note that arrived this long after the device's own time is shown as delayed. */
export const DELAYED_DELIVERY_MS = 2 * 60_000;
export const RECONCILE_WINDOW_MS = 60 * 60_000;

function kyivFormatter(options: Intl.DateTimeFormatOptions) {
  for (const timeZone of ['Europe/Kyiv', 'Europe/Kiev']) {
    try { return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone }); } catch { /* older ICU */ }
  }
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' });
}
const kyivDateTime = kyivFormatter({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const kyivTime = kyivFormatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const kyivClock = kyivFormatter({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export const formatKyivDateTime = (iso: string) => kyivDateTime.format(new Date(iso));
/** «10:24–11:24», from the server's time of the note. */
export function reconcileWindow(receivedAt: string): string {
  const start = new Date(receivedAt);
  return `${kyivTime.format(start)}–${kyivTime.format(new Date(start.getTime() + RECONCILE_WINDOW_MS))}`;
}
export function deliveryDelayMs(row: Pick<DepositCopyRow, 'receivedAt' | 'clientCopiedAt'>): number | null {
  return row.clientCopiedAt ? Date.parse(row.receivedAt) - Date.parse(row.clientCopiedAt) : null;
}
export const networkText = (row: Pick<DepositCopyRow, 'networkName' | 'standard'>) =>
  `${row.networkName}${row.standard && row.standard !== 'Native' ? ` · ${row.standard}` : ''}`;
export const shortAddress = (address: string) => (address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address);

async function readPage(filters: Filters, cursor: string, signal: AbortSignal): Promise<Page> {
  const token = getToken();
  if (!token) throw new Error('Сессия администратора недоступна.');
  const query = new URLSearchParams();
  if (cursor) query.set('before', cursor);
  if (filters.user.trim()) query.set('user', filters.user.trim());
  if (filters.asset.trim()) query.set('asset', filters.asset.trim().toUpperCase());
  const search = query.toString();
  const response = await fetch(`${API_BASE}/admin/deposit-address-copies${search ? `?${search}` : ''}`, {
    cache: 'no-store', signal, headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(response.status === 400 ? 'Проверьте фильтр.' : 'Не удалось загрузить журнал. Показан последний загруженный список.');
  const body = await response.json() as Page;
  if (!body || !Array.isArray(body.items)) throw new Error('Не удалось загрузить журнал. Показан последний загруженный список.');
  return body;
}

export function DepositCopiesSection({ onOpenQueue }: { onOpenQueue: () => void }) {
  const compact = useAdminCompact();
  const [view, setView] = useState<View | null>(lastView);
  const [draft, setDraft] = useState<Filters>(lastView?.filters ?? { user: '', asset: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  async function load(filters: Filters, cursors: string[]) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(null);
    try {
      const page = await readPage(filters, cursors[cursors.length - 1] ?? '', controller.signal);
      if (controller.signal.aborted) return;
      const next = { filters, cursors, page, loadedAt: Date.now() };
      lastView = next; setView(next);
    } catch (err) {
      // The list on screen stays; only the error is new.
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить журнал.');
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }

  // The first open reads page one; a return shows what was loaded before.
  useEffect(() => {
    if (!lastView) void load({ user: '', asset: '' }, ['']);
    return () => request.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filters = view?.filters ?? { user: '', asset: '' };
  const cursors = view?.cursors ?? [''];
  const submit = (event: FormEvent) => { event.preventDefault(); void load({ user: draft.user.trim(), asset: draft.asset.trim().toUpperCase() }, ['']); };
  const reset = () => { setDraft({ user: '', asset: '' }); void load({ user: '', asset: '' }, ['']); };

  async function ignoreRow(row: DepositCopyRow) {
    await ignoreCopySignal(row.userId, row.id);
    // Remove immediately from the operational queue. The server-side journal
    // query also excludes resolved rows, so it stays gone after refresh.
    setView(current => {
      if (!current) return current;
      const next = { ...current, page: { ...current.page, items: current.page.items.filter(item => item.id !== row.id) } };
      lastView = next;
      return next;
    });
  }

  return (
    <section data-deposit-copies className="deposit-copies">
      <p className="deposit-copies-warning" role="note">Копирование адреса не подтверждает оплату. Сверяйте поступление перед зачислением.</p>

      <form className="deposit-copies-filters" onSubmit={submit} aria-label="Фильтр журнала">
        <label>
          <span>Пользователь</span>
          <input style={styles.input} value={draft.user} maxLength={120} placeholder="Email, имя или UID" data-copies-filter="user"
            onChange={(e) => setDraft({ ...draft, user: e.target.value })} />
        </label>
        <label>
          <span>Криптовалюта</span>
          <input style={styles.input} value={draft.asset} maxLength={15} placeholder="USDT" data-copies-filter="asset"
            onChange={(e) => setDraft({ ...draft, asset: e.target.value.toUpperCase() })} />
        </label>
        <div className="deposit-copies-filter-actions">
          <button type="submit" style={styles.primaryBtn} disabled={busy}>Найти</button>
          {(filters.user || filters.asset) && <button type="button" style={styles.neutralBtn} disabled={busy} onClick={reset}>Сбросить</button>}
          <button type="button" style={styles.neutralBtn} disabled={busy} data-copies-refresh onClick={() => void load(filters, cursors)}>
            {busy ? 'Загрузка…' : 'Обновить'}
          </button>
        </div>
      </form>

      <p className="deposit-copies-meta" data-copies-meta>
        Время — Киев{view ? <> · Загружено в {kyivClock.format(new Date(view.loadedAt))}</> : null}
        {cursors.length > 1 ? <> · Страница {cursors.length}</> : null}
      </p>
      {error && <div role="alert" style={{ ...styles.errorBox, marginBottom: 10 }}>{error}</div>}

      {!view && !error && <p style={styles.hint}>Загрузка…</p>}
      {view && view.page.items.length === 0 && (
        <p className="deposit-copies-empty" data-copies-empty>{filters.user || filters.asset ? 'По этому фильтру записей нет.' : 'Пока никто не копировал адрес.'}</p>
      )}
      {view && view.page.items.length > 0 && (compact
        ? <div className="deposit-copies-cards" data-copies-cards aria-label="Копировали адрес">
          {view.page.items.map((row) => <CopyCard key={row.id} row={row} onOpenQueue={onOpenQueue} onIgnore={() => ignoreRow(row)} />)}
        </div>
        : <div className="deposit-copies-table" role="table" aria-label="Копировали адрес">
          <div className="deposit-copies-head" role="row">
            <span role="columnheader">Пользователь</span>
            <span role="columnheader">Криптовалюта</span>
            <span role="columnheader">Сеть</span>
            <span role="columnheader">Время записи</span>
            <span role="columnheader">Адрес</span>
            <span role="columnheader" className="deposit-copies-sr">Действия</span>
          </div>
          {view.page.items.map((row) => <CopyRow key={row.id} row={row} onOpenQueue={onOpenQueue} onIgnore={() => ignoreRow(row)} />)}
        </div>
      )}

      {view && (cursors.length > 1 || view.page.nextCursor) && (
        <div className="deposit-copies-pager">
          <button type="button" style={styles.neutralBtn} disabled={busy || cursors.length < 2} data-copies-newer
            onClick={() => void load(filters, cursors.slice(0, -1))}>← Новее</button>
          <button type="button" style={styles.neutralBtn} disabled={busy || !view.page.nextCursor} data-copies-older
            onClick={() => view.page.nextCursor && void load(filters, [...cursors, view.page.nextCursor])}>Старее →</button>
        </div>
      )}
    </section>
  );
}

/** The admin's own clipboard: never a client «Копировали адрес» note. */
function AdminCopyButton({ value }: { value: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'failed'>('idle');
  return <>
    <button type="button" className="deposit-copies-link" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setState('ok'); } catch { setState('failed'); }
    }}>{state === 'ok' ? 'Скопировано' : 'Скопировать'}</button>
    {state === 'failed' && <small role="alert">Не удалось скопировать — выделите адрес вручную.</small>}
  </>;
}

/** «Обработано» with its busy and error states — the same request from the row and the card. */
function useIgnoreAction(onIgnore: () => Promise<void>) {
  const [ignoring, setIgnoring] = useState(false);
  const [ignoreError, setIgnoreError] = useState<string | null>(null);
  const run = async () => {
    if (ignoring) return;
    setIgnoring(true); setIgnoreError(null);
    try { await onIgnore(); }
    catch { setIgnoreError('Не удалось скрыть. Повторите.'); setIgnoring(false); }
  };
  return { ignoring, ignoreError, run };
}

/** Phone card: the operator sees who, which coin, which network and when at
 * a glance; the UID, the full address, the device time, the reconciliation
 * window and the source open under «Подробности». The delayed-delivery sign
 * stays on top. Actions and the ignore request are the same as the row's. */
function CopyCard({ row, onOpenQueue, onIgnore }: { row: DepositCopyRow; onOpenQueue: () => void; onIgnore: () => Promise<void> }) {
  const [full, setFull] = useState(false);
  const { ignoring, ignoreError, run } = useIgnoreAction(onIgnore);
  const delay = deliveryDelayMs(row);
  const delayed = delay !== null && delay > DELAYED_DELIVERY_MS;
  const icon = depositAssetMetadata[row.asset]?.icon;
  return (
    <article className="deposit-copies-card" data-copy-row={row.id} data-copy-card>
      <div className="deposit-copies-card-head">
        <span className="deposit-copies-user">
          {row.displayName && <strong>{row.displayName}</strong>}
          <span className="deposit-copies-email">{row.email}</span>
        </span>
        <span className="deposit-copies-asset">
          {icon ? <CryptoIcon symbol={row.asset} size={20} imageUrl={icon} metadataOnly /> : null}
          <strong>{row.asset}</strong>
        </span>
      </div>
      <div className="deposit-copies-card-line">
        <span data-copy-network>{networkText(row)}</span>
        <span className="num" data-copy-received>{formatKyivDateTime(row.receivedAt)}</span>
      </div>
      {delayed && <small className="deposit-copies-delayed" data-copy-delayed>Доставлено с задержкой — время копирования неточно</small>}
      <details className="deposit-copies-card-details" data-copy-details>
        <summary>Подробности<span>UID, адрес, окно сверки</span></summary>
        <dl className="admin-key-values deposit-copies-card-facts">
          <dt>UID</dt><dd className="deposit-copies-uid"><CopyValue value={row.userId} label="UID" /></dd>
          <dt>Адрес</dt><dd className="deposit-copies-address">
            {full ? <span className="mono deposit-copies-full" data-copy-address-full>{row.address}</span>
              : <span className="mono" title={row.address} data-copy-address>{shortAddress(row.address)}</span>}
            <span className="deposit-copies-address-actions">
              <button type="button" className="deposit-copies-link" aria-expanded={full} onClick={() => setFull(!full)}>{full ? 'Скрыть' : 'Показать полностью'}</button>
              <AdminCopyButton value={row.address} />
            </span>
            {row.memo && <small>Memo/Tag: <span className="mono">{row.memo}</span></small>}
          </dd>
          {row.clientCopiedAt && <><dt>Время устройства</dt><dd>{formatKyivDateTime(row.clientCopiedAt)}</dd></>}
          <dt>{delayed ? 'Окно сверки (примерно)' : 'Окно сверки'}</dt><dd data-copy-window>{reconcileWindow(row.receivedAt)}</dd>
          <dt>Открыто</dt><dd className="deposit-copies-source">{SOURCE_LABEL[row.source] ?? row.source}</dd>
        </dl>
      </details>
      <div className="deposit-copies-actions">
        <Link to={`/admin/users/${encodeURIComponent(row.userId)}`} className="deposit-copies-action">Открыть пользователя</Link>
        <button type="button" className="deposit-copies-action" onClick={onOpenQueue}>Очередь поступлений</button>
        <button type="button" className="deposit-copies-action" data-ignore-copy-row={row.id} disabled={ignoring} onClick={() => void run()}>{ignoring ? 'Сохраняем…' : 'Обработано'}</button>
        {ignoreError && <small role="alert">{ignoreError}</small>}
      </div>
    </article>
  );
}

function CopyRow({ row, onOpenQueue, onIgnore }: { row: DepositCopyRow; onOpenQueue: () => void; onIgnore: () => Promise<void> }) {
  const [full, setFull] = useState(false);
  const { ignoring, ignoreError, run } = useIgnoreAction(onIgnore);
  const delay = deliveryDelayMs(row);
  const delayed = delay !== null && delay > DELAYED_DELIVERY_MS;
  const icon = depositAssetMetadata[row.asset]?.icon;
  return (
    <div className="deposit-copies-row" role="row" data-copy-row={row.id}>
      <span role="cell" className="deposit-copies-user">
        {row.displayName && <strong>{row.displayName}</strong>}
        <span className="deposit-copies-email">{row.email}</span>
        <span className="deposit-copies-uid"><small>UID</small><CopyValue value={row.userId} label="UID" /></span>
      </span>
      <span role="cell" className="deposit-copies-asset" data-label="Криптовалюта">
        {icon ? <CryptoIcon symbol={row.asset} size={20} imageUrl={icon} metadataOnly /> : null}
        <strong>{row.asset}</strong>
      </span>
      <span role="cell" data-label="Сеть" data-copy-network>{networkText(row)}</span>
      <span role="cell" className="deposit-copies-time" data-label="Время записи">
        <span className="num" data-copy-received>{formatKyivDateTime(row.receivedAt)}</span>
        {row.clientCopiedAt && <small>Копирование по времени устройства: {formatKyivDateTime(row.clientCopiedAt)}</small>}
        {delayed && <small className="deposit-copies-delayed" data-copy-delayed>Доставлено с задержкой — время копирования неточно</small>}
        <small data-copy-window>{delayed ? 'Окно сверки (примерно)' : 'Окно сверки'}: {reconcileWindow(row.receivedAt)}</small>
        <small className="deposit-copies-source">Открыто: {SOURCE_LABEL[row.source] ?? row.source}</small>
      </span>
      <span role="cell" className="deposit-copies-address" data-label="Адрес">
        {full ? <span className="mono deposit-copies-full" data-copy-address-full>{row.address}</span>
          : <span className="mono" title={row.address} data-copy-address>{shortAddress(row.address)}</span>}
        <span className="deposit-copies-address-actions">
          <button type="button" className="deposit-copies-link" aria-expanded={full} onClick={() => setFull(!full)}>{full ? 'Скрыть' : 'Показать полностью'}</button>
          <AdminCopyButton value={row.address} />
        </span>
        {row.memo && <small>Memo/Tag: <span className="mono">{row.memo}</span></small>}
      </span>
      <span role="cell" className="deposit-copies-actions">
        <Link to={`/admin/users/${encodeURIComponent(row.userId)}`} className="deposit-copies-action">Открыть пользователя</Link>
        <button type="button" className="deposit-copies-action" onClick={onOpenQueue}>Очередь поступлений</button>
        <button type="button" className="deposit-copies-action" data-ignore-copy-row={row.id} disabled={ignoring} onClick={() => void run()}>{ignoring ? 'Сохраняем…' : 'Обработано'}</button>
        {ignoreError && <small role="alert">{ignoreError}</small>}
      </span>
    </div>
  );
}
