import { useEffect, useRef, useState, type CSSProperties } from 'react';

export interface DepositCopyNotice {
  id: string;
  asset: string;
  network: string;
  receivedAt: string;
  clientCopiedAt: string | null;
}
export interface DepositCopyUserFields {
  /** Latest unresolved copy, not the latest historical journal entry. */
  lastDepositCopy?: DepositCopyNotice | null;
  depositCopyLookupFailed?: boolean;
}
export const hasPendingCopy = (user: DepositCopyUserFields) => !user.depositCopyLookupFailed && !!user.lastDepositCopy;

const TIME_ZONE = (() => {
  for (const zone of ['Europe/Kyiv', 'Europe/Kiev']) {
    try { new Intl.DateTimeFormat('ru-RU', { timeZone: zone }); return zone; } catch { /* older ICU */ }
  }
  return 'UTC';
})();
const ZONE_LABEL = TIME_ZONE === 'UTC' ? 'UTC' : 'Киев';
const timeFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function depositCopyLabel(event: DepositCopyNotice) {
  const received = new Date(event.receivedAt);
  const valid = Number.isFinite(received.getTime());
  const clientMs = event.clientCopiedAt ? Date.parse(event.clientCopiedAt) : NaN;
  return {
    time: valid ? timeFormat.format(received) : '—',
    fullTime: valid ? dateFormat.format(received) : 'Время недоступно',
    zone: ZONE_LABEL,
    delayed: valid && Number.isFinite(clientMs) && received.getTime() - clientMs > 120_000,
    clientTime: Number.isFinite(clientMs) ? dateFormat.format(new Date(clientMs)) : null,
  };
}

function Bell() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>;
}
export function DepositCopyTabBell() {
  return <span data-copy-tab-bell aria-label="Есть необработанные копирования адреса" title="Копировали адрес — требуется ручная проверка" style={{ display: 'inline-flex', color: '#94600e', marginRight: 4, verticalAlign: 'middle' }}><Bell/></span>;
}

/** Expand/collapse is local and never acknowledges anything. Only the explicit
 * Ignore callback sends a request. The parent replaces data after server success;
 * rejected/lost replies leave the signal visible and safe to retry. */
export function DepositCopyBell({ event, failed = false, onIgnore, userId }: {
  event?: DepositCopyNotice | null; failed?: boolean; onIgnore?: () => Promise<void>; userId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function ignore() {
    if (!onIgnore || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await onIgnore(); }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Не удалось скрыть сигнал. Повторите.'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  if (failed) return <span data-deposit-copy-unknown title="Журнал копирований не загрузился. Откройте «Пополнения → Копировали адрес» или обновите страницу." aria-label="Данные о копировании адреса недоступны" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-tertiary)', fontWeight: 400 }}><Bell/>?</span>;
  if (!event) return null;
  const label = depositCopyLabel(event);
  const description = `Копировали адрес: ${event.asset} · ${event.network} · ${label.fullTime} (${label.zone}). Копирование не подтверждает оплату.`;
  return <span style={shell} data-deposit-copy-event={event.id} onClick={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setExpanded(false); }}>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', flexWrap: 'wrap' }}>
      <button type="button" data-deposit-copy-bell aria-label={description} aria-expanded={expanded} title={description} style={button} onClick={() => setExpanded(value => !value)}>
        <Bell/><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{event.asset} · {label.time}</span>
      </button>
      {onIgnore && <button type="button" data-ignore-deposit-copy={event.id} style={processedButton} disabled={busy} onClick={() => void ignore()} title="Отметить этот сигнал обработанным. Баланс и история перевода не изменятся.">{busy ? 'Сохраняем…' : 'Обработано'}</button>}
    </span>
    {error && <span role="alert" style={{ color: 'var(--sell)' }}>{error}</span>}
    {expanded && <span role="region" aria-label="Последнее копирование адреса" style={detail}>
      <strong style={{ fontSize: 11 }}>Копировали адрес</strong>
      <span>{event.asset} · {event.network}</span>
      <span>{label.fullTime}<br/>{label.zone} · время записи</span>
      {label.delayed && <span>Доставлено с задержкой. Время устройства: {label.clientTime} ({label.zone}, не подтверждено).</span>}
      <span>Копирование не подтверждает оплату.</span>
      <a href="/admin/deposits#copies" style={{ color: 'var(--admin-brand)', textDecoration: 'underline' }}>Открыть журнал</a>
      <a href={`/admin/deposits${userId ? `?userId=${encodeURIComponent(userId)}` : ''}#unattributed`} style={{ color: 'var(--admin-brand)', textDecoration: 'underline' }}>Проверить поступления</a>
      {userId && <a href={`/admin/users/${encodeURIComponent(userId)}?tab=deposits`} style={{ color: 'var(--admin-brand)', textDecoration: 'underline' }}>Открыть пользователя</a>}
    </span>}
  </span>;
}

const shell: CSSProperties = { display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5, maxWidth: '100%', marginBottom: 4, fontFamily: 'inherit', fontWeight: 400 };
const button: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', minHeight: 32, padding: '4px 6px', border: '1px solid #e5c478', borderRadius: 6, color: '#78530d', background: '#fff8e6', fontSize: 11, fontFamily: 'inherit', lineHeight: 1.4, fontWeight: 600, textAlign: 'left', cursor: 'pointer' };
const processedButton: CSSProperties = { ...button, minHeight: 32, background: 'var(--surface, #fff)', color: 'var(--text-secondary)', borderColor: 'var(--border)', whiteSpace: 'nowrap' };
const detail: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '100%', fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere', paddingBottom: 4 };
