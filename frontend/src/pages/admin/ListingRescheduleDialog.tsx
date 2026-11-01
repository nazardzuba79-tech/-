import { useEffect, useRef, useState } from 'react';
import { adminListingsApi, newPublishKey, shiftListingDate, type AdminListing } from './adminListingsApi';

export function canRescheduleListing(listing: AdminListing, serverNow: number): boolean {
  const config = listing.active ?? listing.draft;
  return !config.tradable && Number(config.ownerAllocation) === 0 && !config.privateTest && config.symbol !== 'AITH'
    && Date.parse(config.listingAt) > serverNow + 60_000
    && (!listing.active || JSON.stringify(listing.active) === JSON.stringify(listing.draft));
}

/** Same operation key after an unknown response; no second shift on double click/retry. */
export function ListingRescheduleDialog({ listing, onClose, onSaved }: {
  listing: AdminListing; onClose(): void; onSaved(listingAt: string): Promise<void>;
}) {
  const [days, setDays] = useState<1 | 2 | 3>(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const request = useRef<{ days: 1 | 2 | 3; operationKey: string } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const config = listing.active ?? listing.draft;
  const next = shiftListingDate(config.listingAt, config.displayTimeZone, days);
  const format = (iso: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: config.displayTimeZone, dateStyle: 'medium', timeStyle: 'short' }).format(Date.parse(iso));
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !inFlight.current) onClose(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous instanceof HTMLElement) previous.focus(); };
  }, [onClose]);
  async function confirm() {
    if (inFlight.current || !next) return;
    inFlight.current = true; setPending(true); setError(null);
    request.current ??= { days, operationKey: newPublishKey() };
    try {
      const result = await adminListingsApi.reschedule(listing, request.current.days, request.current.operationKey);
      await onSaved(result.listingAt);
    } catch {
      setError('Дата не подтверждена. Повторите тот же запрос или закройте окно и обновите список. При конфликте версий проверьте актуальную дату.');
    } finally { inFlight.current = false; setPending(false); }
  }
  return <div className="listing-dialog-backdrop" role="presentation">
    <div className="listing-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Перенести дату" data-reschedule-dialog>
      <h2>Перенести дату {listing.symbol}/USDT</h2>
      <p>Часовой пояс: {config.displayTimeZone}</p>
      <p data-reschedule-current>Текущая дата: {format(config.listingAt)}</p>
      <div className="listing-buttons">{([1, 2, 3] as const).map(value => <button key={value} type="button"
        disabled={pending || request.current !== null} aria-pressed={days === value} data-reschedule-days={value}
        className={days === value ? 'listing-primary' : undefined} onClick={() => setDays(value)}>+{value} {value === 1 ? 'день' : 'дня'}</button>)}</div>
      <p data-reschedule-next>Новая дата: {next ? format(next) : 'Это время неоднозначно или не существует из-за перевода часов.'}</p>
      <p>Меняется только дата. Настройки DEMO-сценария сохраняются; запущенный таймер продолжит отсчёт.</p>
      {error && <p role="alert">{error}</p>}
      <div className="listing-buttons">
        <button type="button" className="listing-primary" disabled={pending || !next} onClick={() => void confirm()} data-confirm-reschedule>Подтвердить</button>
        <button type="button" disabled={pending} onClick={onClose}>Отмена</button>
      </div>
    </div>
  </div>;
}
