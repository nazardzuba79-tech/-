/**
 * «Напомнить» for a listing still counting down (owner, 2026-11-04).
 *
 * Three honest options, none of which needs a server: a Google Calendar
 * link, a downloadable .ics file (Apple / Outlook / any calendar), and a
 * browser notification one hour before the opening that fires while the
 * site is open in a tab. No push service exists here yet, so the third
 * option says so in its hint rather than promising a phone alert.
 */
const ONE_HOUR_MS = 3_600_000;
const STORE_KEY = 'voltex.listingReminders';
/** setTimeout overflows past this and fires at once; a later visit re-arms. */
const MAX_TIMER_MS = 2_147_483_647;

export interface ListingReminderInput {
  pair: string;
  name: string;
  /** Opening time, epoch ms (UTC). */
  openAt: number;
  /** Where the reminder points back to. */
  url: string;
  title: string;
  details: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 20261106T110000Z */
export function icsStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function googleCalendarUrl(input: ListingReminderInput): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${icsStamp(input.openAt)}/${icsStamp(input.openAt + ONE_HOUR_MS)}`,
    details: `${input.details}\n${input.url}`,
    location: input.url,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

export function icsFile(input: ListingReminderInput, now = Date.now()): string {
  const uid = `${input.pair.replace('/', '-').toLowerCase()}-${input.openAt}@voltextech.net`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VOLTEX//Listings//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(input.openAt)}`,
    `DTEND:${icsStamp(input.openAt + ONE_HOUR_MS)}`,
    `SUMMARY:${icsText(input.title)}`,
    `DESCRIPTION:${icsText(`${input.details}\n${input.url}`)}`,
    `URL:${input.url}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(input.title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export function icsDataUrl(input: ListingReminderInput, now = Date.now()): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(icsFile(input, now))}`;
}

interface StoredReminder { pair: string; openAt: number; title: string; url: string; }

function readStore(): StoredReminder[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((r): r is StoredReminder => r && typeof r.pair === 'string' && Number.isFinite(r.openAt)) : [];
  } catch { return []; }
}
function writeStore(list: StoredReminder[]) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* private mode: the timer still runs for this tab */ }
}

export function hasLocalReminder(pair: string, openAt: number): boolean {
  return readStore().some(r => r.pair === pair && r.openAt === openAt);
}

export type NotifyPermission = 'granted' | 'denied' | 'unsupported';

/** Asks once; the answer is the browser's, not ours. */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const answer = await Notification.requestPermission();
    return answer === 'granted' ? 'granted' : 'denied';
  } catch { return 'denied'; }
}

const timers = new Map<string, number>();

function arm(r: StoredReminder, now = Date.now()) {
  const key = `${r.pair}@${r.openAt}`;
  if (timers.has(key)) return;
  const fireAt = r.openAt - ONE_HOUR_MS;
  const delay = fireAt - now;
  if (delay > MAX_TIMER_MS) return; // too far: a later visit arms it
  if (now > r.openAt) return; // already opened: nothing to say
  const id = window.setTimeout(() => {
    timers.delete(key);
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const n = new Notification(r.title, { body: new Date(r.openAt).toLocaleString(), tag: key });
        n.onclick = () => { window.focus(); window.location.href = r.url; };
      }
    } catch { /* a browser that refuses the constructor: nothing else to do */ }
    writeStore(readStore().filter(x => !(x.pair === r.pair && x.openAt === r.openAt)));
  }, Math.max(0, delay));
  timers.set(key, id);
}

/** Stores the reminder and arms its timer for this tab. */
export function scheduleLocalReminder(input: Pick<ListingReminderInput, 'pair' | 'openAt' | 'title' | 'url'>) {
  const entry: StoredReminder = { pair: input.pair, openAt: input.openAt, title: input.title, url: input.url };
  const list = readStore().filter(r => !(r.pair === entry.pair && r.openAt === entry.openAt));
  writeStore([...list, entry]);
  arm(entry);
}

export function cancelLocalReminder(pair: string, openAt: number) {
  const key = `${pair}@${openAt}`;
  const id = timers.get(key);
  if (id !== undefined) { window.clearTimeout(id); timers.delete(key); }
  writeStore(readStore().filter(r => !(r.pair === pair && r.openAt === openAt)));
}

/** Re-arms every stored reminder; call once when a page that lists listings mounts. */
export function restoreLocalReminders(now = Date.now()) {
  if (typeof window === 'undefined') return;
  const kept = readStore().filter(r => r.openAt > now);
  writeStore(kept);
  for (const r of kept) arm(r, now);
}
