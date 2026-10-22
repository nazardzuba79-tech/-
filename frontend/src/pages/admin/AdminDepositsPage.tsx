import { waitUntilActive } from '../../lib/browserActivity';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEPOSIT_MINIMUM_USD } from '../../lib/depositMinimum';
import { useLocation } from 'react-router-dom';
import { api, ApiError, getToken, onSessionChange } from '../../lib/api';
import { getAdminClientsPage } from '../../lib/adminPagedApi';
import { useAdminRead } from './useAdminRead';
import { AdminCompatibilityNotice, adminPageCount, adminPageEmpty } from './adminPageSupport';
import { refreshAdminSummary } from './adminWorkSummary';
import { styles } from './adminStyles';
import { CopyValue, RailLabel } from './AdminPrimitives';
import { Skeleton } from '../../components/Skeleton';
import { CreditDepositDrawer } from './CreditDepositDrawer';
import { DepositCopiesSection } from './DepositCopiesSection';
import {
  adminDepositApi, AdminDepositApiError, STATE_LABEL, IGNORE_REASON_LABEL,
  type CreditedBatch, type DepositPackage, type DepositQueue, type DepositQueueRow, type IgnoreReason, type WatcherStatus,
} from './adminDepositApi';
import './adminDeposits.css';

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
const TAB_LABEL = Object.fromEntries(TABS.map(t => [t.key, t.label])) as Record<Tab, string>;
// Owner (2026-10-15): the queue reads by what the admin does next, not in pipeline order.
const TAB_GROUPS: { key: 'action' | 'waiting' | 'archive'; label: string; tabs: Tab[] }[] = [
  { key: 'action', label: 'Нужно действие', tabs: ['ready', 'unattributed', 'review'] },
  { key: 'waiting', label: 'Ожидание', tabs: ['topup', 'network'] },
  { key: 'archive', label: 'Архив', tabs: ['credited', 'ignored'] },
];
// Without a requested tab the page opens on the first list that has work in it.
const FIRST_WORK: Tab[] = ['ready', 'unattributed', 'review', 'topup', 'network'];
const FOCUS_FRESHNESS_MS = 30_000;
const READ_TIMEOUT_MS = 15_000;
const STATE_TAB: Record<string, Tab> = { UNATTRIBUTED: 'unattributed', AWAITING_TOPUP: 'topup', AWAITING_CONFIRMATIONS: 'network', READY: 'ready', NEEDS_REVIEW: 'review', CREDITED: 'credited', IGNORED: 'ignored' };
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
 * Detection, attribution, the USD minimum and the credit are separate
 * steps; the state of every transfer is computed by the server.
 */
export function AdminDepositsPage() {
  const [session, setSession] = useState(getToken);
  useEffect(() => onSessionChange(() => setSession(getToken())), []);
  // A different login never inherits the previous operator's queue or drafts.
  return session ? <AdminDepositsSession key={session} session={session} /> : <p role="alert">Сессия завершена. Войдите снова.</p>;
}

function AdminDepositsSession({ session }: { session: string }) {
  const { hash, search } = useLocation();
  const params = new URLSearchParams(search);
  const requestedTab = STATE_TAB[params.get('state') ?? ''];
  const userFilter = params.get('userId') ?? '';
  const [queue, setQueue] = useState<DepositQueue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>(requestedTab ?? (hash === '#unattributed' ? 'unattributed' : 'ready'));
  const tabChosen = useRef(!!requestedTab || hash === '#unattributed');
  const chooseTab = (next: Tab) => { tabChosen.current = true; setTab(next); };
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crediting, setCrediting] = useState<DepositPackage | null>(null);
  // «Копировали адрес» mounts on first open and then stays, hidden, so a
  // return shows its last list; it has its own reads, none on a timer.
  const [view, setView] = useState<'queue' | 'copies'>(hash === '#copies' ? 'copies' : 'queue');
  const [copiesOpened, setCopiesOpened] = useState(hash === '#copies');
  const openView = (next: 'queue' | 'copies') => { setView(next); if (next === 'copies') setCopiesOpened(true); };
  const loading = useRef<Promise<void> | null>(null);

  // One read at a time. A reload requested while one is in flight is not
  // dropped: it runs once more after it, so an action's confirmation never
  // shows over a list read before that action.
  const again = useRef(false);
  const mounted = useRef(false);
  const queueRequest = useRef<AbortController | null>(null);
  const lastAttempt = useRef<number | null>(null);
  const queueVisible = useRef(view === 'queue');
  queueVisible.current = view === 'queue';
  const reload = useCallback((): Promise<void> => {
    if (!mounted.current || document.hidden || !queueVisible.current || getToken() !== session) return Promise.resolve();
    if (loading.current) { again.current = true; return loading.current; }
    const controller = new AbortController();
    queueRequest.current = controller;
    setReadBusy(true);
    const run = (async () => {
      do {
        again.current = false;
        lastAttempt.current = Date.now();
        let timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, READ_TIMEOUT_MS);
        let cancel: () => void = () => {};
        try {
          // The race settles even if the transport ignores AbortSignal.
          const cancelled = new Promise<never>((_, reject) => {
            cancel = () => reject(new DOMException('Read cancelled', 'AbortError'));
            controller.signal.addEventListener('abort', cancel, { once: true });
          });
          const next = await Promise.race([adminDepositApi.queue(controller.signal), cancelled]);
          if (controller.signal.aborted || getToken() !== session || !mounted.current) return;
          setQueue(next); setLoadError(null); setUpdatedAt(Date.now());
        } catch (err) {
          if (getToken() !== session || !mounted.current) return;
          if (timedOut) setLoadError('Истекло время ожидания. Повторите запрос.');
          else if (!controller.signal.aborted) {
            const status = (err as { status?: number })?.status;
            if (status === 401 || status === 403) { setQueue(null); setUpdatedAt(null); }
            setLoadError(status === 401 ? 'Сессия завершена. Войдите снова.' : status === 403 ? 'Нет доступа к данным.' : 'Не удалось загрузить очередь пополнений. Повторите запрос.');
          }
        } finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', cancel); }
      } while (!controller.signal.aborted && again.current && !document.hidden && queueVisible.current);
    })().finally(() => {
      if (queueRequest.current === controller) { loading.current = null; queueRequest.current = null; if (mounted.current) setReadBusy(false); }
    });
    loading.current = run;
    return run;
  }, [session]);
  const changed = useCallback(async () => {
    if (!mounted.current || getToken() !== session) return;
    refreshAdminSummary(); await reload();
  }, [reload, session]);
  const cancelRead = useCallback(() => {
    if (queueRequest.current) { queueRequest.current.abort(); lastAttempt.current = null; }
    queueRequest.current = null; loading.current = null; again.current = false;
    if (mounted.current) setReadBusy(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    void reload();
    // The day's first automatic scan runs when an admin opens this page after
    // 07:00 (Kyiv). The server allows it once a day, never at night, never
    // right after another scan; otherwise it does nothing.
    const pendingOpen = new AbortController();
    void waitUntilActive(pendingOpen.signal).then(() => {
      if (!pendingOpen.signal.aborted && getToken() === session) return adminDepositApi.openTrigger().then((r) => { if (!disposed && r.ran) void changed(); });
    }).catch(() => {});
    const onVisibility = () => {
      if (document.hidden) cancelRead();
      else if (lastAttempt.current === null || Date.now() - lastAttempt.current >= FOCUS_FRESHNESS_MS) void reload();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      disposed = true; mounted.current = false;
      pendingOpen.abort(); cancelRead();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [reload, changed, cancelRead, session]);

  useEffect(() => {
    if (view !== 'queue') cancelRead();
    else if (lastAttempt.current === null || Date.now() - lastAttempt.current >= FOCUS_FRESHNESS_MS) void reload();
  }, [view, reload, cancelRead]);

  useEffect(() => {
    if (hash === '#unattributed') { tabChosen.current = true; setTab('unattributed'); setView('queue'); }
    if (hash === '#copies') { setView('copies'); setCopiesOpened(true); }
    if (requestedTab) { tabChosen.current = true; setTab(requestedTab); setView('queue'); }
  }, [hash, requestedTab]);

  const lists = useMemo(() => {
    const rows = (queue?.rows ?? []).filter(r => !userFilter || r.userId === userFilter || r.claims.some(c => c.userId === userFilter));
    const packages = (queue?.packages ?? []).filter(p => !userFilter || p.userId === userFilter);
    return {
      unattributed: rows.filter((r) => r.state === 'UNATTRIBUTED'),
      network: rows.filter((r) => r.state === 'AWAITING_CONFIRMATIONS'),
      review: rows.filter((r) => r.state === 'NEEDS_REVIEW' && !packages.some((p) => p.transfers.some((t) => t.id === r.id))),
      reviewPackages: packages.filter((p) => p.state === 'NEEDS_REVIEW'),
      credited: rows.filter((r) => r.state === 'CREDITED'),
      ignored: rows.filter((r) => r.state === 'IGNORED'),
      batches: (queue?.creditedBatches ?? []).filter(b => !userFilter || b.userId === userFilter),
      topup: packages.filter((p) => p.state === 'AWAITING_TOPUP'),
      ready: packages.filter((p) => p.state === 'READY'),
    };
  }, [queue, userFilter]);

  // Transfers for Непривязанные / Ожидают подтверждений / Игнорированные;
  // PACKAGES (one user + asset + network) for Ожидают доплаты / Готовы.
  const counts: Record<Tab, number | null> = !queue || queue.counts.truncated ? { unattributed: null, topup: null, network: null, ready: null, review: null, credited: null, ignored: null } : userFilter ? {
    unattributed: lists.unattributed.length, topup: lists.topup.length, network: lists.network.length, ready: lists.ready.length,
    review: lists.review.length + lists.reviewPackages.length, credited: lists.credited.length, ignored: lists.ignored.length,
  } : {
    unattributed: queue.counts.UNATTRIBUTED,
    topup: queue?.packageCounts?.AWAITING_TOPUP ?? lists.topup.length,
    network: queue?.counts.AWAITING_CONFIRMATIONS ?? 0,
    ready: queue?.packageCounts?.READY ?? lists.ready.length,
    review: lists.review.length + lists.reviewPackages.length,
    credited: queue?.counts.CREDITED ?? 0,
    ignored: queue?.counts.IGNORED ?? lists.ignored.length,
  };
  const [ignoring, setIgnoring] = useState<DepositQueueRow | null>(null);
  const firstWork = FIRST_WORK.find(key => (counts[key] ?? 0) > 0) ?? null;
  useEffect(() => {
    if (!queue || tabChosen.current) return;
    tabChosen.current = true;
    if (firstWork) setTab(firstWork);
  }, [queue, firstWork]);

  async function restore(row: DepositQueueRow) {
    if (!window.confirm('Вернуть перевод в очередь «Непривязанные»? Баланс не изменится.')) return;
    setMessage(null); setError(null);
    try { await adminDepositApi.restore(row.id); await changed(); setMessage('Перевод возвращён в очередь. Баланс не изменён.'); }
    catch (err) { setError(err instanceof AdminDepositApiError ? err.message : 'Не удалось вернуть перевод.'); }
  }

  async function attribute(row: DepositQueueRow, userId: string | null, reassign: boolean) {
    setMessage(null); setError(null);
    try {
      await adminDepositApi.attribute(row.id, userId, reassign);
      // Refresh first, then confirm: the message never describes a stale list.
      await changed();
      setMessage(userId ? 'Перевод привязан. Баланс не изменён.' : 'Привязка снята. Баланс не изменён.');
    } catch (err) {
      setError(err instanceof AdminDepositApiError ? err.message : 'Не удалось привязать перевод.');
    }
  }

  const minimumUsd = queue?.minDepositUsd ?? DEPOSIT_MINIMUM_USD;
  return (
    <div className="dep-page">
      {/* Owner (2026-10-15): the title, one short rule and the refresh share one header; every way of
          finding a transfer sits in one card; the queue tabs are grouped by what the admin does next. */}
      <div className="dep-heading">
        <div className="dep-heading-text">
          <h1 style={{ ...styles.title, marginBottom: 4 }}>Пополнения</h1>
          <p className="dep-lede">Переводы одного пользователя в одном активе и сети складываются в пакет. Зачисление — вручную, от {minimumUsd} USD.</p>
        </div>
        {view === 'queue' && <div className="dep-refresh">
          <span role="status">{updatedAt ? `Обновлено в ${new Date(updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Данные ещё не загружены'}</span>
          <button type="button" data-deposit-refresh disabled={readBusy} style={styles.neutralBtn} onClick={() => void reload()}>{readBusy ? 'Обновление…' : 'Обновить'}</button>
        </div>}
      </div>
      <div className="admin-user-tabs deposit-view-switch" role="tablist" aria-label="Раздел пополнений">
        <button type="button" role="tab" aria-selected={view === 'queue'} data-deposit-view="queue"
          className={view === 'queue' ? 'active' : undefined} onClick={() => openView('queue')}>Поступления</button>
        <button type="button" role="tab" aria-selected={view === 'copies'} data-deposit-view="copies"
          className={view === 'copies' ? 'active' : undefined} onClick={() => openView('copies')}>Копировали адрес</button>
      </div>
      {copiesOpened && (
        <div hidden={view !== 'copies'}>
          <DepositCopiesSection onOpenQueue={() => { openView('queue'); chooseTab('unattributed'); }} />
        </div>
      )}

      {view === 'queue' && <div className="dep-queue">
      {error && <div role="alert" style={styles.errorBox}>{error}</div>}
      {message && <p role="status" style={{ ...styles.successBox, margin: 0 }}>{message}</p>}
      {loadError && <div role="alert" style={styles.errorBox}>{loadError}{queue ? ' Показаны последние загруженные данные; они могут быть устаревшими.' : ''}</div>}
      {userFilter && <p className="dep-filter">Только пользователь <span className="mono">{userFilter}</span></p>}

      <DepositTools status={queue?.watcher ?? null} onChanged={changed} onError={setError} />

      <div className="dep-tabs" role="tablist" aria-label="Очередь пополнений">
        {TAB_GROUPS.map((group) => (
          <div key={group.key} className="dep-tab-group" role="presentation" data-tab-group={group.key}>
            <span className="dep-tab-group-label" aria-hidden="true">{group.label}</span>
            <div className="dep-tab-group-items" role="presentation">
              {group.tabs.map((key) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} data-deposit-tab={key}
                  data-attention={(group.key === 'action' && !!counts[key]) || undefined}
                  className={tab === key ? 'active' : undefined} onClick={() => chooseTab(key)}>
                  {TAB_LABEL[key]}<span className="admin-user-tab-count">{counts[key] ?? '—'}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {queue?.counts.truncated && <p role="alert" style={styles.errorBox}>Загружена только часть очереди из {queue.counts.uncreditedTotal} переводов. Полные количества неизвестны; отсутствие записи в этом списке не означает отсутствие перевода.</p>}
      {queue === null && !loadError && <Skeleton height={120} />}

      {queue && tab === 'unattributed' && (
        <section id="unattributed" data-deposit-section="unattributed">
          {lists.unattributed.length === 0 && <Empty partial={queue?.counts.truncated} text="Непривязанных переводов нет." />}
          {lists.unattributed.map((r) => <UnattributedRow key={r.id} row={r} onAttribute={attribute} onIgnore={() => setIgnoring(r)} />)}
        </section>
      )}
      {queue && (tab === 'topup' || tab === 'ready') && (
        <section data-deposit-section={tab} className="dep-cards">
          {(tab === 'topup' ? lists.topup : lists.ready).map((p) => <PackageCard key={p.key} pkg={p} onCredit={() => setCrediting(p)} />)}
          {(tab === 'topup' ? lists.topup : lists.ready).length === 0 && <Empty partial={queue?.counts.truncated} text={tab === 'topup' ? 'Нет пакетов, ожидающих доплаты.' : 'Нет пакетов, готовых к проверке.'} />}
        </section>
      )}
      {queue && tab === 'network' && (
        <section data-deposit-section="network">
          {lists.network.length === 0 && <Empty partial={queue?.counts.truncated} text="Нет переводов, ожидающих подтверждений сети." />}
          {lists.network.map((r) => <TransferRow key={r.id} row={r} />)}
        </section>
      )}
      {queue && tab === 'review' && (
        <section data-deposit-section="review" className="dep-stack">
          {lists.reviewPackages.map((p) => <PackageCard key={p.key} pkg={p} onCredit={() => setCrediting(p)} />)}
          {lists.review.map((r) => <TransferRow key={r.id} row={r} onAttribute={attribute} />)}
          {lists.review.length + lists.reviewPackages.length === 0 && <Empty partial={queue?.counts.truncated} text="Нет переводов, требующих уточнения." />}
        </section>
      )}
      {queue && tab === 'credited' && (
        <section data-deposit-section="credited" className="dep-stack">
          {lists.batches.length === 0 && lists.credited.length === 0 && <Empty partial={queue?.counts.truncated} text="Зачисленных пополнений пока нет." />}
          {lists.batches.length > 0 && <div className="dep-cards">
            {lists.batches.map((b) => <CreditedBatchCard key={b.id} batch={b} />)}
          </div>}
          {/* Transfers credited before packages existed (no batch). */}
          {lists.credited.filter((r) => !r.batchId).map((r) => <TransferRow key={r.id} row={r} />)}
        </section>
      )}
      {queue && tab === 'ignored' && (
        <section data-deposit-section="ignored">
          <p className="dep-muted" style={{ margin: '0 0 8px' }}>Не депозиты клиентов: в накопления и зачисления не входят. Записи сохранены.</p>
          {lists.ignored.length === 0 && <Empty partial={queue?.counts.truncated} text="Игнорированных переводов нет." />}
          {lists.ignored.map((r) => <IgnoredRow key={r.id} row={r} onRestore={() => restore(r)} />)}
        </section>
      )}
      {ignoring && (
        <IgnoreModal row={ignoring} onClose={() => setIgnoring(null)} onDone={async () => {
          setIgnoring(null); await changed(); setMessage('Перевод перенесён в «Игнорированные». Запись сохранена, баланс не изменён.');
        }} />
      )}
      </div>}

      {crediting && (
        <CreditDepositDrawer
          userId={crediting.userId}
          chain={crediting.chain}
          asset={crediting.asset}
          email={crediting.userEmail ?? crediting.userId}
          onClose={() => setCrediting(null)}
          onDone={(r) => { setCrediting(null); setMessage(`Зачислено ${r.totalAmount} ${r.asset}.`); void changed(); }}
        />
      )}
    </div>
  );
}

function Empty({ text, partial }: { text: string; partial?: boolean }) {
  return <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{partial ? 'В загруженной части очереди подходящих записей нет.' : text}</p>;
}

/** The accumulation card, exactly the fields the admin decides on: who, how much, how far from the
 * minimum, which transfers. Owner (2026-10-15): no «Пользователь / Статус / Зачислить» labels, the
 * status is a chip and «осталось» shows only while the minimum is not reached. */
function PackageCard({ pkg: p, onCredit }: { pkg: DepositPackage; onCredit: () => void }) {
  const ready = p.state === 'READY';
  const tone = ready ? 'ok' : p.state === 'NEEDS_REVIEW' ? 'bad' : 'wait';
  const share = p.usdValue !== null && Number(p.minDepositUsd) > 0 ? Number(p.usdValue) / Number(p.minDepositUsd) : NaN;
  return (
    <article data-package={p.key} data-package-state={p.state} className="dep-card">
      <div className="dep-card-head">
        <div className="dep-card-who"><strong className="admin-user-email">{p.userEmail ?? p.userId}</strong><span>{p.asset} / {network(p.chain)}</span></div>
        <span data-package-status className={`dep-chip dep-chip-${tone}`}>{STATE_LABEL[p.state]}</span>
      </div>
      <div className="dep-card-total"><span>Всего накоплено</span><strong className="mono" data-package-total>{p.total} {p.asset}</strong></div>
      {!ready && Number.isFinite(share) && <div className="dep-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }} /></div>}
      <div className="dep-card-min">
        <span>Минимум {p.minDepositUsd} USD</span>
        {!p.minimumReached && p.remaining !== null && <span>Осталось доплатить <b className="mono" data-package-remaining>{p.remaining} {p.asset}</b></span>}
        {!p.minimumReached && p.remaining === null && p.remainingUsd !== null && <span>Осталось доплатить <b className="mono">≈ {p.remainingUsd} USD</b></span>}
      </div>
      {p.unconfirmedCount > 0 && <p className="dep-card-note">Ещё не подтверждено сетью: <span className="mono">{p.unconfirmedTotal} {p.asset} ({p.unconfirmedCount})</span></p>}
      <div className="dep-card-parts">
        {p.transfers.length > 1 && <div className="dep-card-parts-head">Переводы: <span className="mono" data-package-parts>{p.transfers.map((t) => t.amount).join(' + ')} {p.asset}</span></div>}
        <ul data-package-transfer-list>
          {p.transfers.map((t) => (
            <li key={t.id} data-package-transfer={t.id}>
              <span className="dep-card-tx">
                <span className="mono" title={t.txHash}>{t.txHash.slice(0, 8)}…{t.txHash.slice(-6)}</span>
                <small>{t.blockTimestamp ? when(t.blockTimestamp) : 'время блока неизвестно'} · подтв. {t.confirmations}/{t.minConfirmations}{t.finalized ? ' ✓' : ''}</small>
              </span>
              <strong className="mono">{t.amount} {p.asset}</strong>
            </li>
          ))}
        </ul>
      </div>
      {ready
        ? <button type="button" data-open-package={p.key} onClick={onCredit} style={styles.approveBtn}>Проверить и зачислить {p.total} {p.asset}</button>
        : <p className="dep-card-locked" data-package-credit="unavailable">{p.state === 'AWAITING_TOPUP' ? 'Зачисление недоступно: сумма ниже минимума' : 'Зачисление недоступно'}</p>}
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

function ClientPicker({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  useEffect(() => {
    const hide = () => { if (document.hidden) setOpen(false); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  return <div style={{ display: 'grid', gap: 6 }}>
    <button type="button" data-client-picker aria-label={label} aria-expanded={open} disabled={disabled} style={styles.neutralBtn} onClick={() => setOpen(v => !v)}>
      {value ? email || value : 'Выбрать пользователя'}
    </button>
    {open && <ClientSearch onChoose={client => { onChange(client.id); setEmail(client.email); setOpen(false); }} />}
  </div>;
}

function ClientSearch({ onChoose }: { onChoose: (client: { id: string; email: string }) => void }) {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ search, page: String(page), pageSize: '20' }).toString();
  const read = useAdminRead(`deposit-clients:${query}`, signal => getAdminClientsPage(query, signal));
  return <div style={{ ...styles.card, padding: 10, display: 'grid', gap: 8 }}>
    <form onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setPage(1); }} style={{ display: 'flex', gap: 6 }}>
      <input aria-label="Поиск пользователя" placeholder="Email или ID" value={draft} onChange={event => setDraft(event.target.value)} style={{ ...styles.input, minWidth: 0 }} />
      <button type="submit" style={styles.neutralBtn}>Найти</button>
    </form>
    {read.loading && <span role="status">Загрузка пользователей…</span>}
    {read.error && <div role="alert">{read.error}<button type="button" style={styles.neutralBtn} onClick={read.reload}>Повторить</button></div>}
    {read.data && <>
      <AdminCompatibilityNotice compatibility={read.data.compatibility} />
      {!read.data.items.length && !read.error && <span>{adminPageEmpty(read.data, 'Пользователи не найдены.')}</span>}
      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 4 }}>
        {read.data.items.map(client => <button type="button" data-client-choice={client.id} key={client.id} style={{ ...styles.neutralBtn, textAlign: 'left', overflowWrap: 'anywhere' }} onClick={() => onChoose(client)}>{client.email}<small style={{ display: 'block' }}>{client.id}</small></button>)}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" aria-label="Предыдущая страница пользователей" style={styles.neutralBtn} disabled={read.loading || page <= 1} onClick={() => setPage(p => p - 1)}>Назад</button>
        <span>{read.data.page} / {Math.max(1, read.data.totalPages)} · {adminPageCount(read.data)}</span>
        <button type="button" aria-label="Следующая страница пользователей" style={styles.neutralBtn} disabled={read.loading || page >= read.data.totalPages} onClick={() => setPage(p => p + 1)}>Далее</button>
      </div>
    </>}
  </div>;
}

function UnattributedRow({ row, onAttribute, onIgnore }: { row: DepositQueueRow; onAttribute: (row: DepositQueueRow, userId: string | null, reassign: boolean) => Promise<void>; onIgnore: () => void }) {
  const [picked, setPicked] = useState(row.claims.length === 1 ? row.claims[0].userId : '');
  const [busy, setBusy] = useState(false);
  return (
    <div data-deposit-row={row.id} className="row-hover admin-history-grid admin-deposit-row" style={{ ...styles.tableRow, gridTemplateColumns: ROW_GRID, minWidth: 0 }}>
      <TransferFacts row={row} />
      <div style={{ display: 'grid', gap: 6 }}>
        <ClientPicker label={`Пользователь для ${row.txHash}`} value={picked} onChange={setPicked} disabled={busy} />
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
        style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 'min(440px, calc(100vw - 32px))', maxHeight: 'calc(var(--admin-viewport-height, 100dvh) - 32px)', overflowY: 'auto',
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
    <article data-credited-batch={b.id} className="dep-card">
      <div className="dep-card-head">
        <div className="dep-card-who"><strong className="admin-user-email">{b.userEmail ?? b.userId}</strong><span>{b.asset} / {network(b.chain)} · {when(b.createdAt)}</span></div>
        <span className="dep-chip dep-chip-ok">{STATE_LABEL.CREDITED}</span>
      </div>
      <div className="dep-card-total"><span>Зачислено</span><strong className="mono" style={{ color: 'var(--buy)' }}>{b.totalAmount} {b.asset}</strong></div>
      {b.transfers.length > 1 && <div className="dep-card-parts-head">Переводы: <span className="mono">{b.transfers.map((t) => t.amount).join(' + ')} {b.asset}</span></div>}
    </article>
  );
}

function TransferRow({ row, onAttribute }: { row: DepositQueueRow; onAttribute?: (row: DepositQueueRow, userId: string | null, reassign: boolean) => Promise<void> }) {
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div data-deposit-row={row.id} data-deposit-state={row.state} className="row-hover admin-history-grid admin-deposit-row" style={{ ...styles.tableRow, gridTemplateColumns: ROW_GRID, minWidth: 0 }}>
      <TransferFacts row={row} />
      <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
        <span>{row.userEmail ?? 'Не привязан'}</span>
        <span style={{ color: row.state === 'NEEDS_REVIEW' ? 'var(--sell)' : 'var(--text-tertiary)' }}>{STATE_LABEL[row.state]}{row.verifyError ? `: ${row.verifyError}` : ''}</span>
        <ClaimsHint row={row} />
        {onAttribute && row.state !== 'CREDITED' && (
          <>
            <ClientPicker label={`Перепривязать ${row.txHash}`} value={picked} onChange={setPicked} disabled={busy} />
            <button type="button" disabled={!picked || busy} style={styles.neutralBtn}
              onClick={async () => { if (window.confirm('Перепривязать перевод к другому пользователю? Действие записывается в журнал.')) { setBusy(true); try { await onAttribute(row, picked, true); } finally { setBusy(false); } } }}>
              Перепривязать
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Owner (2026-10-15): every way a transfer is found, in one card — the USDT / TRC20 watcher, then the
 * manual checks (one TXID, the other networks' feeds). Problems stay in sight; the schedule waits
 * behind «Расписание» and empty «—» lines are not shown. */
function DepositTools({ status, onChanged, onError }: { status: WatcherStatus | null; onChanged: () => Promise<void>; onError: (m: string | null) => void }) {
  const [manualOpen, setManualOpen] = useState(() => !(typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches));
  return (
    <section className="dep-tools" aria-label="Проверка поступлений">
      <WatcherPanel status={status} onChanged={onChanged} onError={onError} />
      {/* Open on a desktop; folded on a phone, where the TXID form would push the queue a screen down. */}
      <details className="dep-manual" open={manualOpen} onToggle={(e) => setManualOpen(e.currentTarget.open)}>
        <summary className="dep-tools-title">Проверить вручную</summary>
        <CheckTxForm onChecked={onChanged} />
        <OtherNetworksFeed onDone={onChanged} />
      </details>
    </section>
  );
}

function WatcherPanel({ status, onChanged, onError }: { status: WatcherStatus | null; onChanged: () => Promise<void>; onError: (m: string | null) => void }) {
  const [busy, setBusy] = useState<'run' | 'toggle' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  if (!status) return null;
  const provider = status.providerStatus?.startsWith('RATE_LIMITED') ? 'Лимит запросов провайдера' : status.providerStatus === 'UNAVAILABLE' ? 'Провайдер недоступен'
    : status.providerStatus === 'ERROR' ? 'Ошибка' : status.providerStatus === 'NOT_CONFIGURED' ? 'Сеть не настроена' : status.providerStatus === 'OK' ? 'В норме' : null;
  const lag = status.cursors.length ? Math.max(...status.cursors.map((c) => c.lagMs)) : null;
  const backlog = status.cursors.some((c) => c.windowInProgress) || !!status.lastRunSummary?.backlog;
  const schedule = `при первом открытии после ${status.policy.dayStart}, в ${status.policy.slots.join(', ')} (Киев)`;
  const scannedThrough = status.cursors.length ? status.cursors.reduce((m, c) => (c.scannedThrough < m ? c.scannedThrough : m), status.cursors[0].scannedThrough) : null;
  return (
    <div data-watcher className="dep-watcher">
      <div className="dep-watcher-head">
        <h2 className="dep-tools-title">Автопроверка USDT / TRC20</h2>
        <span data-watcher-enabled={status.enabled ? 'on' : 'off'} className={`dep-chip ${status.enabled ? 'dep-chip-ok' : 'dep-chip-off'}`}>{status.enabled ? 'Включена' : 'Выключена'}</span>
        {provider && provider !== 'В норме' && <span className="dep-chip dep-chip-bad">{provider}</span>}
      </div>
      <dl className="dep-facts">
        <div><dt>Последняя</dt><dd>{status.lastSuccessAt ? when(status.lastSuccessAt) : 'ещё не было'}</dd></div>
        {status.enabled && status.nextScheduledRunAt && <div><dt>Следующая</dt><dd>{when(status.nextScheduledRunAt)}</dd></div>}
        {scannedThrough && <div><dt>Проверено до</dt><dd>{when(scannedThrough)}{lag !== null ? ` · отставание ${lagLabel(lag)}` : ''}{backlog ? ' · есть очередь' : ''}</dd></div>}
        {!scannedThrough && backlog && <div><dt>Очередь</dt><dd>есть очередь</dd></div>}
        {status.unverifiedOrUnfinalized > 0 && <div><dt>Не проверено / не окончательно</dt><dd>{status.unverifiedOrUnfinalized}</dd></div>}
      </dl>
      {status.lastRunSummary?.error && <p role="alert" style={styles.errorBox}>Последняя проверка не завершена: {status.lastRunSummary.error}. Сохранённые переводы доступны.</p>}
      {result && <p role="status" className="dep-result">{result}</p>}
      <div className="dep-actions">
        <button type="button" data-watcher-run disabled={busy !== null || status.running} className="dep-btn-brand" onClick={async () => {
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
      <details className="dep-schedule">
        <summary>Расписание</summary>
        <p data-watcher-schedule>
          {status.enabled ? `Автоматически: ${schedule}. ` : 'Автоматическая проверка выключена. '}
          Ночью {status.policy.nightStart}–{status.policy.dayStart} автоматическая проверка не выполняется. Уведомлений нет — ручная проверка доступна всегда.
        </p>
      </details>
    </div>
  );
}

function CheckTxForm({ onChecked }: { onChecked: () => Promise<void> }) {
  const [chain, setChain] = useState('tron');
  const [asset, setAsset] = useState('USDT');
  const [txHash, setTxHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form data-check-tx className="dep-txid" onSubmit={async (e) => {
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
      <div className="dep-txid-fields">
        <select aria-label="Сеть" value={chain} onChange={(e) => setChain(e.target.value)} style={styles.input}>
          {['tron', 'ethereum', 'bsc', 'bitcoin', 'solana', 'ton'].map((c) => <option key={c} value={c}>{c === 'tron' ? 'TRON (TRC20)' : c}</option>)}
        </select>
        <input aria-label="Актив" value={asset} onChange={(e) => setAsset(e.target.value.toUpperCase())} style={styles.input} />
        <input aria-label="TXID" placeholder="TXID — хэш транзакции" value={txHash} onChange={(e) => setTxHash(e.target.value)} style={styles.input} />
        <button type="submit" disabled={busy || !txHash.trim()} style={styles.neutralBtn}>{busy ? 'Проверка…' : 'Проверить'}</button>
      </div>
      {result && <p role={result.ok ? 'status' : 'alert'} style={{ ...(result.ok ? styles.successBox : styles.errorBox), margin: 0 }}>{result.text}</p>}
    </form>
  );
}

/** Other configured networks have no watcher: their recent-transfer feed is
 * read only when an admin asks. Found transfers are stored, never credited. */
function OtherNetworksFeed({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="dep-other">
      <button type="button" data-other-networks disabled={busy} style={styles.neutralBtn}
        title="Читает последние переводы на адреса остальных сетей. Найденные переводы попадают в очередь без зачисления." onClick={async () => {
        setBusy(true); setNote(null);
        try {
          const r = await api.getAdminIncomingDepositFeed();
          setNote(r.failedChains.length ? `Ленты загружены не полностью (${r.failedChains.join(', ')}). Это не значит, что переводов нет.` : 'Ленты сетей проверены.');
        } catch (err) { setNote(err instanceof ApiError ? err.message : 'Не удалось загрузить ленты сетей.'); }
        finally { setBusy(false); await onDone(); }
      }}>{busy ? 'Загрузка…' : 'Проверить другие сети'}</button>
      {note && <p role="status" className="dep-result">{note}</p>}
    </div>
  );
}
