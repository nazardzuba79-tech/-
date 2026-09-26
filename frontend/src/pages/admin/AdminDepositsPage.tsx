import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';
import { CopyValue, RailLabel } from './AdminPrimitives';
import { Skeleton } from '../../components/Skeleton';
import { CreditDepositDrawer } from './CreditDepositDrawer';
import {
  adminDepositApi, AdminDepositApiError, STATE_LABEL, IGNORE_REASON_LABEL,
  type CreditedBatch, type DepositPackage, type DepositQueue, type DepositQueueRow, type IgnoreReason, type WatcherStatus,
} from './adminDepositApi';

type Client = Awaited<ReturnType<typeof api.getAllClients>>[number];
type Tab = 'unattributed' | 'topup' | 'network' | 'ready' | 'review' | 'credited' | 'ignored';

const TABS: { key: Tab; label: string }[] = [
  { key: 'unattributed', label: 'Непривязанные' },
  { key: 'topup', label: 'Ожидают доплаты' },
  { key: 'network', label: 'Ожидают подтверждений' },
  { key: 'ready', label: 'Готовы к проверке' },
  { key: 'review', label: 'Требуют уточнения' },
  { key: 'credited', label: 'Зачисленные' },
  { key: 'ignored', label: 'Игнорированные' },
];
/** Queue re-read while the tab is visible. A hidden tab schedules nothing. */
const REFRESH_MS = 60_000;
const network = (chain: string) => (chain === 'tron' ? 'TRC20' : chain);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU') : '—');

function lagLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} ч` : `${Math.round(hours / 24)} дн`;
}

/**
 * Пополнения — the deposit registry and the only place a package is credited.
 * Detection, attribution, the 300 USD minimum and the credit are separate
 * steps; the state of every transfer is computed by the server.
 */
export function AdminDepositsPage() {
  const { hash } = useLocation();
  const [queue, setQueue] = useState<DepositQueue | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>(hash === '#unattributed' ? 'unattributed' : 'ready');
  const [clients, setClients] = useState<Client[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crediting, setCrediting] = useState<DepositPackage | null>(null);
  const loading = useRef(false);

  const reload = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try { setQueue(await adminDepositApi.queue()); setLoadError(false); }
    catch { setLoadError(true); }
    finally { loading.current = false; }
  }, []);

  useEffect(() => {
    void reload();
    // The day's first automatic scan runs when an admin opens this page after
    // 07:00 (Kyiv). The server allows it once a day, never at night, never
    // right after another scan; otherwise it does nothing.
    adminDepositApi.openTrigger().then((r) => { if (r.ran) void reload(); }).catch(() => {});
    api.getAllClients().then(setClients).catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => document.visibilityState === 'visible';
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (visible()) timer = setTimeout(() => { void reload().then(schedule); }, REFRESH_MS);
    };
    const onVisibility = () => { if (visible()) void reload().then(schedule); else if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { if (timer !== undefined) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [reload]);

  useEffect(() => {
    if (hash === '#unattributed') setTab('unattributed');
  }, [hash]);

  const lists = useMemo(() => {
    const rows = queue?.rows ?? [];
    const packages = queue?.packages ?? [];
    return {
      unattributed: rows.filter((r) => r.state === 'UNATTRIBUTED'),
      network: rows.filter((r) => r.state === 'AWAITING_CONFIRMATIONS'),
      review: rows.filter((r) => r.state === 'NEEDS_REVIEW' && !packages.some((p) => p.transfers.some((t) => t.id === r.id))),
      reviewPackages: packages.filter((p) => p.state === 'NEEDS_REVIEW'),
      credited: rows.filter((r) => r.state === 'CREDITED'),
      ignored: rows.filter((r) => r.state === 'IGNORED'),
      batches: queue?.creditedBatches ?? [],
      topup: packages.filter((p) => p.state === 'AWAITING_TOPUP'),
      ready: packages.filter((p) => p.state === 'READY'),
    };
  }, [queue]);

  // Transfers for Непривязанные / Ожидают подтверждений / Игнорированные;
  // PACKAGES (one user + asset + network) for Ожидают доплаты / Готовы.
  const counts: Record<Tab, number> = {
    unattributed: queue?.counts.UNATTRIBUTED ?? 0,
    topup: queue?.packageCounts?.AWAITING_TOPUP ?? lists.topup.length,
    network: queue?.counts.AWAITING_CONFIRMATIONS ?? 0,
    ready: queue?.packageCounts?.READY ?? lists.ready.length,
    review: lists.review.length + lists.reviewPackages.length,
    credited: queue?.counts.CREDITED ?? 0,
    ignored: queue?.counts.IGNORED ?? lists.ignored.length,
  };
  const [ignoring, setIgnoring] = useState<DepositQueueRow | null>(null);

  async function restore(row: DepositQueueRow) {
    if (!window.confirm('Вернуть перевод в очередь «Непривязанные»? Баланс не изменится.')) return;
    setMessage(null); setError(null);
    try { await adminDepositApi.restore(row.id); setMessage('Перевод возвращён в очередь. Баланс не изменён.'); await reload(); }
    catch (err) { setError(err instanceof AdminDepositApiError ? err.message : 'Не удалось вернуть перевод.'); }
  }

  async function attribute(row: DepositQueueRow, userId: string | null, reassign: boolean) {
    setMessage(null); setError(null);
    try {
      await adminDepositApi.attribute(row.id, userId, reassign);
      setMessage(userId ? 'Перевод привязан. Баланс не изменён.' : 'Привязка снята. Баланс не изменён.');
      await reload();
    } catch (err) {
      setError(err instanceof AdminDepositApiError ? err.message : 'Не удалось привязать перевод.');
    }
  }

  return (
    <div>
      <h1 style={styles.title}>Пополнения</h1>
      <p style={styles.hint}>
        Зачисление — только вручную, пакетом: переводы одного пользователя в одном активе и одной сети суммируются.
        Пакет становится доступным для проверки от {queue?.minDepositUsd ?? 300} USD; ниже минимума зачислить нельзя.
      </p>
      {error && <div role="alert" style={{ ...styles.errorBox, marginBottom: 12 }}>{error}</div>}
      {message && <p role="status" style={{ ...styles.successBox, marginBottom: 12 }}>{message}</p>}
      {loadError && <div role="alert" style={{ ...styles.errorBox, marginBottom: 12 }}>Не удалось загрузить очередь пополнений. Сохранённые данные не изменены — повторите позже.</div>}

      <WatcherPanel status={queue?.watcher ?? null} onChanged={reload} onError={setError} />
      <CheckTxForm onChecked={reload} />

      <div className="admin-user-tabs" role="tablist" aria-label="Очередь пополнений" style={{ margin: '16px 0 10px' }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} data-deposit-tab={t.key}
            className={tab === t.key ? 'active' : undefined} onClick={() => setTab(t.key)}>
            {t.label}<span className="admin-user-tab-count">{counts[t.key]}</span>
          </button>
        ))}
      </div>
      {queue?.counts.truncated && <p role="alert" style={styles.errorBox}>Показаны первые записи из {queue.counts.uncreditedTotal}. Счётчики вкладок — по загруженным записям.</p>}
      {queue === null && !loadError && <Skeleton height={120} />}

      {queue && tab === 'unattributed' && (
        <section id="unattributed" data-deposit-section="unattributed">
          {lists.unattributed.length === 0 && <Empty text="Непривязанных переводов нет." />}
          {lists.unattributed.map((r) => <UnattributedRow key={r.id} row={r} clients={clients} onAttribute={attribute} onIgnore={() => setIgnoring(r)} />)}
        </section>
      )}
      {queue && (tab === 'topup' || tab === 'ready') && (
        <section data-deposit-section={tab} style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
          {(tab === 'topup' ? lists.topup : lists.ready).map((p) => <PackageCard key={p.key} pkg={p} onCredit={() => setCrediting(p)} />)}
          {(tab === 'topup' ? lists.topup : lists.ready).length === 0 && <Empty text={tab === 'topup' ? 'Нет пакетов, ожидающих доплаты.' : 'Нет пакетов, готовых к проверке.'} />}
        </section>
      )}
      {queue && tab === 'network' && (
        <section data-deposit-section="network">
          {lists.network.length === 0 && <Empty text="Нет переводов, ожидающих подтверждений сети." />}
          {lists.network.map((r) => <TransferRow key={r.id} row={r} />)}
        </section>
      )}
      {queue && tab === 'review' && (
        <section data-deposit-section="review" style={{ display: 'grid', gap: 12 }}>
          {lists.reviewPackages.map((p) => <PackageCard key={p.key} pkg={p} onCredit={() => setCrediting(p)} />)}
          {lists.review.map((r) => <TransferRow key={r.id} row={r} clients={clients} onAttribute={attribute} />)}
          {lists.review.length + lists.reviewPackages.length === 0 && <Empty text="Нет переводов, требующих уточнения." />}
        </section>
      )}
      {queue && tab === 'credited' && (
        <section data-deposit-section="credited" style={{ display: 'grid', gap: 12 }}>
          {lists.batches.length === 0 && lists.credited.length === 0 && <Empty text="Зачисленных пополнений пока нет." />}
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
            {lists.batches.map((b) => <CreditedBatchCard key={b.id} batch={b} />)}
          </div>
          {/* Transfers credited before packages existed (no batch). */}
          {lists.credited.filter((r) => !r.batchId).map((r) => <TransferRow key={r.id} row={r} />)}
        </section>
      )}
      {queue && tab === 'ignored' && (
        <section data-deposit-section="ignored">
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 8px' }}>
            Не являются депозитами клиентов. Записи сохранены, в накопления и зачисления не входят.
          </p>
          {lists.ignored.length === 0 && <Empty text="Игнорированных переводов нет." />}
          {lists.ignored.map((r) => <IgnoredRow key={r.id} row={r} onRestore={() => restore(r)} />)}
        </section>
      )}
      {ignoring && (
        <IgnoreModal row={ignoring} onClose={() => setIgnoring(null)} onDone={async () => {
          setIgnoring(null); setMessage('Перевод перенесён в «Игнорированные». Запись сохранена, баланс не изменён.'); await reload();
        }} />
      )}

      <OtherNetworksFeed onDone={reload} />

      {crediting && (
        <CreditDepositDrawer
          userId={crediting.userId}
          chain={crediting.chain}
          asset={crediting.asset}
          email={crediting.userEmail ?? crediting.userId}
          onClose={() => setCrediting(null)}
          onDone={(r) => { setCrediting(null); setMessage(`Зачислено ${r.totalAmount} ${r.asset}.`); void reload(); }}
        />
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{text}</p>;
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '3px 0' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

/** The accumulation card, exactly the fields the admin decides on. */
function PackageCard({ pkg: p, onCredit }: { pkg: DepositPackage; onCredit: () => void }) {
  const ready = p.state === 'READY';
  return (
    <article data-package={p.key} data-package-state={p.state} style={{ ...styles.card, display: 'grid', gap: 2 }}>
      <Line label="Пользователь">{p.userEmail ?? p.userId}</Line>
      <Line label="Актив / сеть">{p.asset} / {network(p.chain)}</Line>
      <Line label="Подтверждённые переводы"><span className="mono" data-package-parts>{p.transfers.map((t) => t.amount).join(' + ')} {p.asset}</span></Line>
      <ul data-package-transfer-list style={{ listStyle: 'none', margin: '2px 0 4px', padding: 0, display: 'grid', gap: 4 }}>
        {p.transfers.map((t) => (
          <li key={t.id} data-package-transfer={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, padding: '4px 8px', borderRadius: 6, background: 'var(--panel-alt)', minWidth: 0 }}>
            <span style={{ minWidth: 0 }}>
              <span className="mono" title={t.txHash} style={{ display: 'block', overflowWrap: 'anywhere', color: 'var(--text-secondary)' }}>{t.txHash.slice(0, 8)}…{t.txHash.slice(-6)}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>{t.blockTimestamp ? when(t.blockTimestamp) : 'время блока неизвестно'} · подтв. {t.confirmations}/{t.minConfirmations}{t.finalized ? ' ✓' : ''} · подтверждён сетью</span>
            </span>
            <strong className="mono" style={{ whiteSpace: 'nowrap' }}>{t.amount} {p.asset}</strong>
          </li>
        ))}
      </ul>
      <Line label="Всего накоплено"><strong className="mono" data-package-total>{p.total} {p.asset}</strong></Line>
      {p.unconfirmedCount > 0 && <Line label="Ещё не подтверждено сетью"><span className="mono">{p.unconfirmedTotal} {p.asset} ({p.unconfirmedCount})</span></Line>}
      <Line label="Минимум">{p.minDepositUsd} USD</Line>
      {p.remaining !== null && <Line label="Осталось доплатить"><span className="mono" data-package-remaining>{p.remaining} {p.asset}</span></Line>}
      {!p.minimumReached && p.remaining === null && p.remainingUsd !== null && <Line label="Осталось доплатить"><span className="mono">≈ {p.remainingUsd} USD</span></Line>}
      <Line label="Статус"><span data-package-status>{STATE_LABEL[p.state]}</span></Line>
      {ready
        ? <button type="button" data-open-package={p.key} onClick={onCredit} style={{ ...styles.approveBtn, marginTop: 8 }}>Проверить и зачислить {p.total} {p.asset}</button>
        : <Line label="Зачислить"><span data-package-credit="unavailable" style={{ color: 'var(--text-tertiary)' }}>недоступно</span></Line>}
    </article>
  );
}

function ClaimsHint({ row }: { row: DepositQueueRow }) {
  if (!row.claims.length) return null;
  return <small style={{ display: 'block', color: 'var(--text-tertiary)' }}>Заявка клиента: {row.claims.map((c) => c.email ?? c.userId).join(', ')}</small>;
}

function TransferFacts({ row }: { row: DepositQueueRow }) {
  return (
    <>
      <RailLabel asset={row.asset} chain={row.chain} />
      <span className="mono" style={{ textAlign: 'right' }}>
        {row.amount}
        <small style={{ display: 'block', color: 'var(--text-tertiary)' }}>{row.verified ? (row.state === 'CREDITED' ? 'зачислено' : 'проверено') : 'не проверено'}</small>
      </span>
      <span className="mono" style={{ textAlign: 'right' }}>{row.confirmations}/{row.minConfirmations}{row.finalized ? ' ✓' : ''}</span>
      <CopyValue value={row.txHash} label="txid" />
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {row.blockTimestamp ? `Блок: ${when(row.blockTimestamp)}` : 'Время блока неизвестно'}
        <small style={{ display: 'block', color: 'var(--text-tertiary)' }}>Обнаружен: {when(row.firstDetectedAt)}</small>
        {row.creditedAt && <small style={{ display: 'block', color: 'var(--buy)' }}>Зачислен: {when(row.creditedAt)}</small>}
      </span>
    </>
  );
}

const ROW_GRID = '150px 0.8fr 70px 1fr 1.1fr 1.4fr';

function UnattributedRow({ row, clients, onAttribute, onIgnore }: { row: DepositQueueRow; clients: Client[]; onAttribute: (row: DepositQueueRow, userId: string | null, reassign: boolean) => void; onIgnore: () => void }) {
  const [picked, setPicked] = useState(row.claims.length === 1 ? row.claims[0].userId : '');
  const [busy, setBusy] = useState(false);
  return (
    <div data-deposit-row={row.id} className="row-hover admin-history-grid admin-deposit-row" style={{ ...styles.tableRow, gridTemplateColumns: ROW_GRID, minWidth: 0 }}>
      <TransferFacts row={row} />
      <div style={{ display: 'grid', gap: 6 }}>
        <select aria-label={`Пользователь для ${row.txHash}`} value={picked} onChange={(e) => setPicked(e.target.value)} style={styles.input}>
          <option value="">Выберите пользователя</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.email}</option>)}
        </select>
        <ClaimsHint row={row} />
        <button type="button" data-attribute={row.id} disabled={!picked || busy} style={styles.neutralBtn}
          onClick={async () => { setBusy(true); await onAttribute(row, picked, false); setBusy(false); }}>
          Привязать к пользователю
        </button>
        <button type="button" data-ignore={row.id} disabled={busy} style={styles.neutralBtn} onClick={onIgnore}>Игнорировать</button>
      </div>
    </div>
  );
}

const REASONS: IgnoreReason[] = ['HISTORICAL_WALLET_OPERATION', 'OWN_TRANSFER', 'NOT_CLIENT_DEPOSIT', 'OTHER'];

/** «Игнорировать»: a reason is required; the transfer row is kept. */
function IgnoreModal({ row, onClose, onDone }: { row: DepositQueueRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState<IgnoreReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = !!reason && (reason !== 'OTHER' || note.trim().length > 0) && !busy;
  return (
    <>
      <div style={styles.drawerOverlay} onClick={() => { if (!busy) onClose(); }} />
      <div role="dialog" aria-modal="true" aria-labelledby="ignore-title" data-ignore-modal={row.id}
        style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 'min(440px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
          background: 'var(--panel)', color: 'var(--text-primary)', borderRadius: 12, boxShadow: '0 20px 50px rgba(15,17,21,.25)', padding: 18, zIndex: 1001, boxSizing: 'border-box' }}>
        <strong id="ignore-title" style={{ fontSize: 15 }}>Игнорировать перевод</strong>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '6px 0 10px', overflowWrap: 'anywhere' }}>
          {row.amount} {row.asset} · {row.txHash.slice(0, 10)}…{row.txHash.slice(-8)}. Запись не удаляется: она уйдёт из «Непривязанные» в «Игнорированные» и не будет участвовать в накоплениях.
        </p>
        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          <legend style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Причина</legend>
          {REASONS.map((r) => (
            <label key={r} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="radio" name="ignore-reason" value={r} checked={reason === r} onChange={() => setReason(r)} /> {IGNORE_REASON_LABEL[r]}
            </label>
          ))}
        </fieldset>
        {reason === 'OTHER' && (
          <input aria-label="Причина (другое)" placeholder="Коротко опишите причину" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)}
            style={{ ...styles.input, width: '100%', boxSizing: 'border-box', marginTop: 8 }} />
        )}
        {error && <p role="alert" style={{ ...styles.errorBox, marginTop: 10 }}>{error}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
          <button type="button" disabled={busy} style={styles.neutralBtn} onClick={onClose}>Отмена</button>
          <button type="button" data-confirm-ignore disabled={!canSubmit} style={styles.rejectBtn} onClick={async () => {
            if (!reason) return;
            setBusy(true); setError(null);
            try { await adminDepositApi.ignore(row.id, reason, reason === 'OTHER' ? note.trim() : null); await onDone(); }
            catch (err) { setError(err instanceof AdminDepositApiError ? err.message : 'Не удалось игнорировать перевод.'); }
            finally { setBusy(false); }
          }}>{busy ? 'Сохранение…' : 'Игнорировать'}</button>
        </div>
      </div>
    </>
  );
}

function IgnoredRow({ row, onRestore }: { row: DepositQueueRow; onRestore: () => void }) {
  return (
    <div data-ignored-row={row.id} className="row-hover admin-history-grid admin-deposit-row" style={{ ...styles.tableRow, gridTemplateColumns: ROW_GRID, minWidth: 0 }}>
      <TransferFacts row={row} />
      <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
        <span><b>{IGNORE_REASON_LABEL[row.ignoredReason ?? ''] ?? row.ignoredReason}</b>{row.ignoredNote ? `: ${row.ignoredNote}` : ''}</span>
        <span style={{ color: 'var(--text-tertiary)' }}>Скрыт: {when(row.ignoredAt)}</span>
        <button type="button" data-restore={row.id} style={styles.neutralBtn} onClick={onRestore}>Вернуть в очередь</button>
      </div>
    </div>
  );
}

function CreditedBatchCard({ batch: b }: { batch: CreditedBatch }) {
  return (
    <article data-credited-batch={b.id} style={{ ...styles.card, display: 'grid', gap: 2 }}>
      <Line label="Пользователь">{b.userEmail ?? b.userId}</Line>
      <Line label="Актив / сеть">{b.asset} / {network(b.chain)}</Line>
      <Line label="Переводы"><span className="mono">{b.transfers.map((t) => t.amount).join(' + ')} {b.asset}</span></Line>
      <Line label="Зачислено"><strong className="mono" style={{ color: 'var(--buy)' }}>{b.totalAmount} {b.asset}</strong></Line>
      <Line label="Дата">{when(b.createdAt)}</Line>
      <Line label="Статус">{STATE_LABEL.CREDITED}</Line>
    </article>
  );
}

function TransferRow({ row, clients, onAttribute }: { row: DepositQueueRow; clients?: Client[]; onAttribute?: (row: DepositQueueRow, userId: string | null, reassign: boolean) => void }) {
  const [picked, setPicked] = useState('');
  return (
    <div data-deposit-row={row.id} data-deposit-state={row.state} className="row-hover admin-history-grid admin-deposit-row" style={{ ...styles.tableRow, gridTemplateColumns: ROW_GRID, minWidth: 0 }}>
      <TransferFacts row={row} />
      <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
        <span>{row.userEmail ?? 'Не привязан'}</span>
        <span style={{ color: row.state === 'NEEDS_REVIEW' ? 'var(--sell)' : 'var(--text-tertiary)' }}>{STATE_LABEL[row.state]}{row.verifyError ? `: ${row.verifyError}` : ''}</span>
        <ClaimsHint row={row} />
        {clients && onAttribute && row.state !== 'CREDITED' && (
          <>
            <select aria-label={`Перепривязать ${row.txHash}`} value={picked} onChange={(e) => setPicked(e.target.value)} style={styles.input}>
              <option value="">Перепривязать к…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.email}</option>)}
            </select>
            <button type="button" disabled={!picked} style={styles.neutralBtn}
              onClick={() => { if (window.confirm('Перепривязать перевод к другому пользователю? Действие записывается в журнал.')) onAttribute(row, picked, true); }}>
              Перепривязать
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function WatcherPanel({ status, onChanged, onError }: { status: WatcherStatus | null; onChanged: () => Promise<void>; onError: (m: string | null) => void }) {
  const [busy, setBusy] = useState<'run' | 'toggle' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  if (!status) return null;
  const provider = status.providerStatus?.startsWith('RATE_LIMITED') ? 'Лимит запросов провайдера' : status.providerStatus === 'UNAVAILABLE' ? 'Провайдер недоступен'
    : status.providerStatus === 'ERROR' ? 'Ошибка' : status.providerStatus === 'NOT_CONFIGURED' ? 'Сеть не настроена' : status.providerStatus === 'OK' ? 'В норме' : '—';
  const lag = status.cursors.length ? Math.max(...status.cursors.map((c) => c.lagMs)) : null;
  const backlog = status.cursors.some((c) => c.windowInProgress) || !!status.lastRunSummary?.backlog;
  const schedule = `при первом открытии после ${status.policy.dayStart}, в ${status.policy.slots.join(', ')} (Киев)`;
  return (
    <section data-watcher style={{ ...styles.card, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14 }}>Наблюдение USDT / TRC20</strong>
        <span data-watcher-enabled={status.enabled ? 'on' : 'off'} style={{ fontSize: 12, fontWeight: 700, color: status.enabled ? 'var(--buy)' : 'var(--text-tertiary)' }}>
          {status.enabled ? `Автоматически: ${schedule}` : 'Автоматическая проверка выключена'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', columnGap: 24, rowGap: 2, marginTop: 8 }}>
        <Line label="Последняя успешная">{when(status.lastSuccessAt)}</Line>
        <Line label="Следующая автоматическая">{status.enabled ? when(status.nextScheduledRunAt) : '—'}</Line>
        <Line label="Провайдер">{provider}</Line>
        <Line label="Проверено до">{status.cursors.length ? when(status.cursors.reduce((m, c) => (c.scannedThrough < m ? c.scannedThrough : m), status.cursors[0].scannedThrough)) : 'ещё не запускалось'}</Line>
        <Line label="Отставание">{lag === null ? '—' : lagLabel(lag)}{backlog ? ' · есть очередь' : ''}</Line>
        <Line label="Не проверено / не окончательно">{status.unverifiedOrUnfinalized}</Line>
      </div>
      <p data-watcher-schedule style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '6px 0 0' }}>
        Ночью {status.policy.nightStart}–{status.policy.dayStart} автоматическая проверка не выполняется. Уведомлений нет — ручная проверка доступна всегда.
      </p>
      {status.lastRunSummary?.error && <p role="alert" style={{ ...styles.errorBox, marginTop: 8 }}>Последняя проверка не завершена: {status.lastRunSummary.error}. Сохранённые переводы доступны.</p>}
      {result && <p role="status" style={{ fontSize: 12, marginTop: 8 }}>{result}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" data-watcher-run disabled={busy !== null || status.running} style={styles.neutralBtn} onClick={async () => {
          setBusy('run'); onError(null); setResult(null);
          try {
            const r = await adminDepositApi.runWatcher();
            setResult(r.skipped === 'LEASE_HELD' ? 'Проверка уже выполняется.' : r.ok ? `Проверка выполнена. Новых переводов: ${r.newTransfers}.` : `Проверка не завершена: ${r.error ?? 'ошибка провайдера'}.`);
          } catch (err) { onError(err instanceof AdminDepositApiError ? err.message : 'Не удалось запустить проверку.'); }
          finally { setBusy(null); await onChanged(); }
        }}>{busy === 'run' ? 'Проверка…' : 'Проверить новые поступления'}</button>
        <button type="button" data-watcher-toggle disabled={busy !== null} style={styles.neutralBtn} onClick={async () => {
          if (!window.confirm(status.enabled ? 'Выключить автоматическую проверку? Очередь и прогресс сохранятся.' : `Включить автоматическую проверку (${schedule}; ночью ${status.policy.nightStart}–${status.policy.dayStart} — нет)? Она только находит переводы: без уведомлений и без зачисления.`)) return;
          setBusy('toggle'); onError(null);
          try { await adminDepositApi.setWatcherEnabled(!status.enabled); }
          catch (err) { onError(err instanceof AdminDepositApiError ? err.message : 'Не удалось изменить режим.'); }
          finally { setBusy(null); await onChanged(); }
        }}>{status.enabled ? 'Выключить автопроверку' : 'Включить автопроверку'}</button>
      </div>
    </section>
  );
}

function CheckTxForm({ onChecked }: { onChecked: () => Promise<void> }) {
  const [chain, setChain] = useState('tron');
  const [asset, setAsset] = useState('USDT');
  const [txHash, setTxHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form data-check-tx style={{ ...styles.card, display: 'grid', gap: 8 }} onSubmit={async (e) => {
      e.preventDefault();
      if (!txHash.trim() || busy) return;
      setBusy(true); setResult(null);
      try {
        const r = await adminDepositApi.checkTx({ chain, asset, txHash: txHash.trim() });
        setResult(r.ok
          ? { ok: true, text: `Перевод найден: ${r.amount} ${asset.toUpperCase()}, подтверждений ${r.confirmations}${r.finalized ? ', блок окончательный' : ''}. Сохранён в очереди (без привязки и без зачисления).` }
          : { ok: false, text: r.reason === 'NOT_FOUND' ? `Сеть пока не знает эту транзакцию: ${r.error}` : `Перевод не принят: ${r.error}` });
        if (r.ok) await onChecked();
      } catch (err) {
        setResult({ ok: false, text: err instanceof AdminDepositApiError ? err.message : 'Проверка не выполнена.' });
      } finally { setBusy(false); }
    }}>
      <strong style={{ fontSize: 14 }}>Проверить TXID</strong>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select aria-label="Сеть" value={chain} onChange={(e) => setChain(e.target.value)} style={{ ...styles.input, width: 140 }}>
          {['tron', 'ethereum', 'bsc', 'bitcoin', 'solana', 'ton'].map((c) => <option key={c} value={c}>{c === 'tron' ? 'TRON (TRC20)' : c}</option>)}
        </select>
        <input aria-label="Актив" value={asset} onChange={(e) => setAsset(e.target.value.toUpperCase())} style={{ ...styles.input, width: 90 }} />
        <input aria-label="TXID" placeholder="Хэш транзакции" value={txHash} onChange={(e) => setTxHash(e.target.value)} style={{ ...styles.input, flex: '1 1 260px', minWidth: 0 }} />
        <button type="submit" disabled={busy || !txHash.trim()} style={styles.neutralBtn}>{busy ? 'Проверка…' : 'Проверить'}</button>
      </div>
      {result && <p role={result.ok ? 'status' : 'alert'} style={result.ok ? styles.successBox : styles.errorBox}>{result.text}</p>}
    </form>
  );
}

/** Other configured networks have no watcher: their recent-transfer feed is
 * read only when an admin asks. Found transfers are stored, never credited. */
function OtherNetworksFeed({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <section style={{ marginTop: 20 }}>
      <button type="button" data-other-networks disabled={busy} style={styles.neutralBtn} onClick={async () => {
        setBusy(true); setNote(null);
        try {
          const r = await api.getAdminIncomingDepositFeed();
          setNote(r.failedChains.length ? `Ленты загружены не полностью (${r.failedChains.join(', ')}). Это не значит, что переводов нет.` : 'Ленты сетей проверены.');
        } catch (err) { setNote(err instanceof ApiError ? err.message : 'Не удалось загрузить ленты сетей.'); }
        finally { setBusy(false); await onDone(); }
      }}>{busy ? 'Загрузка…' : 'Проверить ленты других сетей'}</button>
      {note && <p role="status" style={{ fontSize: 12, marginTop: 6 }}>{note}</p>}
    </section>
  );
}
