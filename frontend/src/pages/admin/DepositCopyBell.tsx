import { useState, type CSSProperties } from 'react';

export interface DepositCopyNotice {
  id: string;
  asset: string;
  network: string;
  receivedAt: string;
  clientCopiedAt: string | null;
}
export interface DepositCopyUserFields {
  lastDepositCopy?: DepositCopyNotice | null;
  depositCopyLookupFailed?: boolean;
}

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

/** The users list already delivered this snapshot. Opening this bell is
 * purely local; it does not acknowledge a payment, fetch, write or credit.
 * The badge is not removed after 60 minutes: an older copy is still useful
 * for manual review. A fresh server snapshot comes with the existing users
 * read (re-open/reload), not a new polling loop.
 */
export function DepositCopyBell({ event, failed = false }: { event?: DepositCopyNotice | null; failed?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (failed) return <span data-deposit-copy-unknown title="Журнал копирований не загрузился. Откройте «Пополнения → Копировали адрес» или обновите страницу." aria-label="Данные о копировании адреса недоступны" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-tertiary)', fontWeight: 400 }}><Bell/>?</span>;
  if (!event) return null;
  const label = depositCopyLabel(event);
  const description = `Копировали адрес: ${event.asset} · ${event.network} · ${label.fullTime} (${label.zone}). Копирование не подтверждает оплату.`;
  return <span style={shell} data-deposit-copy-event={event.id} onClick={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setExpanded(false); }}>
    <button type="button" data-deposit-copy-bell aria-label={description} aria-expanded={expanded} title={description} style={button} onClick={() => setExpanded(value => !value)}>
      <Bell/><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{event.asset} · {label.time}</span>
    </button>
    {expanded && <span role="region" aria-label="Последнее копирование адреса" style={detail}>
      <strong style={{ fontSize: 11 }}>Копировали адрес</strong>
      <span>{event.asset} · {event.network}</span>
      <span>{label.fullTime}<br/>{label.zone} · время записи</span>
      {label.delayed && <span>Доставлено с задержкой. Время устройства: {label.clientTime} ({label.zone}, не подтверждено).</span>}
      <span>Копирование не подтверждает оплату.</span>
      <a href="/admin/deposits#copies" style={{ color: 'var(--admin-brand)', textDecoration: 'underline' }}>Открыть журнал</a>
      <a href="/admin/deposits#unattributed" style={{ color: 'var(--admin-brand)', textDecoration: 'underline' }}>Проверить поступления</a>
    </span>}
  </span>;
}

const shell: CSSProperties = { display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5, maxWidth: '100%', marginBottom: 4, fontFamily: 'inherit', fontWeight: 400 };
const button: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', minHeight: 32, padding: '4px 6px', border: '1px solid #e5c478', borderRadius: 6, color: '#78530d', background: '#fff8e6', fontSize: 11, fontFamily: 'inherit', lineHeight: 1.4, fontWeight: 600, textAlign: 'left', cursor: 'pointer' };
const detail: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '100%', fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere', paddingBottom: 4 };
