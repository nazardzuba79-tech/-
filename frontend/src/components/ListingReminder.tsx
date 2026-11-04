import { useEffect, useId, useRef, useState } from 'react';
import { Bell, BellRing, CalendarPlus, Download } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import { cancelLocalReminder, googleCalendarUrl, hasLocalReminder, icsDataUrl, requestNotifyPermission, restoreLocalReminders, scheduleLocalReminder } from '../lib/listingReminder';
import './ListingReminder.css';

/**
 * The bell beside a listing that is still counting down: Google Calendar,
 * an .ics file, or a browser notification an hour before the opening
 * (which fires while the site is open; the hint says so).
 */
export function ListingReminder({ pair, name, openAt, compact = false }: { pair: string; name: string; openAt: number; compact?: boolean }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(() => hasLocalReminder(pair, openAt));
  const [denied, setDenied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const url = typeof window === 'undefined' ? `/trade?pair=${encodeURIComponent(pair)}` : `${window.location.origin}/trade?pair=${encodeURIComponent(pair)}`;
  const input = { pair, name, openAt, url, title: t('listings.remindTitle', { pair }), details: name };

  useEffect(() => { restoreLocalReminders(); }, []);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  async function toggleNotify() {
    if (armed) { cancelLocalReminder(pair, openAt); setArmed(false); return; }
    const answer = await requestNotifyPermission();
    if (answer !== 'granted') { setDenied(true); return; }
    scheduleLocalReminder(input);
    setArmed(true);
    setDenied(false);
  }

  const Icon = armed ? BellRing : Bell;
  return (
    <div className={`listing-reminder${compact ? ' is-compact' : ''}`} ref={root} data-listing-reminder={pair}>
      <button type="button" className={`listing-reminder-key${armed ? ' is-armed' : ''}`} aria-expanded={open} aria-controls={menuId}
        aria-label={`${t('listings.remind')}: ${pair}`} title={t('listings.remind')} onClick={() => setOpen(v => !v)}>
        <Icon size={16} aria-hidden="true" />
        {!compact && <span>{t('listings.remind')}</span>}
      </button>
      {open && (
        <div className="listing-reminder-menu" id={menuId} role="group" aria-label={`${t('listings.remind')}: ${pair}`}>
          <a href={googleCalendarUrl(input)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            <CalendarPlus size={15} aria-hidden="true" />{t('listings.remindGoogle')}
          </a>
          <a href={icsDataUrl(input)} download={`${pair.replace('/', '-')}-listing.ics`} onClick={() => setOpen(false)}>
            <Download size={15} aria-hidden="true" />{t('listings.remindIcs')}
          </a>
          <button type="button" onClick={toggleNotify} aria-pressed={armed}>
            <BellRing size={15} aria-hidden="true" />{t(armed ? 'listings.remindNotifyOn' : 'listings.remindNotify')}
          </button>
          <small>{denied ? t('listings.remindDenied') : t('listings.remindNotifyHint')}</small>
        </div>
      )}
    </div>
  );
}
