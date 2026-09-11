/** Indicative regional weekday activity windows, not exchange opening hours,
 * holiday calendars, liquidity measurements or a restriction on crypto 24/7. */
export type TradingSessionId = 'asia' | 'europe' | 'usa';
export type TradingSessionStatus = 'ACTIVE' | 'UPCOMING' | 'CLOSED';
export interface TradingSessionHub { readonly name: string; readonly zone: string }
export interface TradingSessionConfig {
  readonly id: TradingSessionId;
  readonly label: string;
  readonly zone: string;
  readonly localHours: string;
  readonly openHour: number;
  readonly closeHour: number;
  readonly hubs: readonly TradingSessionHub[];
}

/** One configuration owns the representative windows and all city timezones. */
export const TRADING_SESSIONS: readonly TradingSessionConfig[] = [
  {
    id: 'asia', label: 'ASIA', zone: 'Asia/Tokyo', localHours: '09:00–18:00', openHour: 9, closeHour: 18,
    hubs: [{ name: 'Tokyo', zone: 'Asia/Tokyo' }, { name: 'Hong Kong', zone: 'Asia/Hong_Kong' }, { name: 'Singapore', zone: 'Asia/Singapore' }],
  },
  {
    id: 'europe', label: 'EUROPE', zone: 'Europe/London', localHours: '08:00–17:00', openHour: 8, closeHour: 17,
    hubs: [{ name: 'London', zone: 'Europe/London' }, { name: 'Frankfurt', zone: 'Europe/Berlin' }, { name: 'Zürich', zone: 'Europe/Zurich' }],
  },
  {
    id: 'usa', label: 'USA', zone: 'America/New_York', localHours: '08:00–17:00', openHour: 8, closeHour: 17,
    hubs: [{ name: 'New York', zone: 'America/New_York' }],
  },
];

/** All instants are epoch milliseconds. Windows include start and exclude end. */
export interface TradingSessionWindow { start: number; end: number }
export interface TradingSessionState extends TradingSessionConfig {
  hubs: (TradingSessionHub & { localTime: string })[];
  localDate: string;
  localTime: string;
  status: TradingSessionStatus;
  /** Today's local weekday window, including before/after it; null on weekends. */
  window: TradingSessionWindow | null;
  /** Strictly future opening, even while this session is active. */
  nextOpen: number;
  /** Elapsed share of today's time window, never an activity/liquidity percentage. */
  progress: number;
  elapsedMs: number;
  opensInMs: number | null;
  closesInMs: number | null;
}
export interface TradingSessionOverlap extends TradingSessionWindow {
  sessionIds: TradingSessionId[];
  label: string;
  progress: number;
  startsInMs: number;
  endsInMs: number;
}
export interface TradingSessionsState {
  now: number;
  sessions: TradingSessionState[];
  activeSessions: TradingSessionState[];
  /** The region with the earliest strictly future opening. */
  nextSession: TradingSessionState;
  overlaps: TradingSessionOverlap[];
  nextOverlap: TradingSessionOverlap | null;
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
function partsAt(instant: number, zone: string): LocalParts {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    formatters.set(zone, formatter);
  }
  const values: Partial<LocalParts> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day'
      || part.type === 'hour' || part.type === 'minute' || part.type === 'second') values[part.type] = Number(part.value);
  }
  return values as LocalParts;
}
const pad = (value: number) => String(value).padStart(2, '0');
const localClock = (parts: LocalParts) => `${pad(parts.hour)}:${pad(parts.minute)}`;
const localDayKey = (parts: Pick<LocalParts, 'year' | 'month' | 'day'>) => `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
const asUtcCalendar = (parts: LocalParts) => Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

/** Resolve a local wall-clock boundary through Intl's IANA rules. The configured
 * daytime boundaries are outside DST's missing/repeated early-morning hours.
 * Each date is resolved independently: adding 24h to a UTC opening is unsafe. */
function boundaryAt(day: Pick<LocalParts, 'year' | 'month' | 'day'>, hour: number, zone: string): number {
  const desired = Date.UTC(day.year, day.month - 1, day.day, hour);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt++) {
    const difference = desired - asUtcCalendar(partsAt(candidate, zone));
    if (difference === 0) return candidate;
    candidate += difference;
  }
  throw new RangeError(`Cannot resolve configured trading-session boundary in ${zone}`);
}

type DatedWindow = TradingSessionWindow & { localDate: string };
function windowsNear(now: number, config: TradingSessionConfig): DatedWindow[] {
  const local = partsAt(now, config.zone);
  // This is calendar-date arithmetic only, not a timezone-offset assumption.
  const anchor = Date.UTC(local.year, local.month - 1, local.day);
  const windows: DatedWindow[] = [];
  for (let offset = -1; offset <= 8; offset++) {
    const date = new Date(anchor + offset * DAY_MS);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    const day = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    windows.push({ localDate: localDayKey(day), start: boundaryAt(day, config.openHour, config.zone), end: boundaryAt(day, config.closeHour, config.zone) });
  }
  return windows;
}

const progressAt = (now: number, window: TradingSessionWindow) => Math.min(1, Math.max(0, (now - window.start) / (window.end - window.start)));

/** Pure clock projection: no timers, requests, current-time reads or user state.
 * Caller supplies one shared Date. Intl applies the runtime's IANA/DST rules. */
export function buildTradingSessionState(now: Date): TradingSessionsState {
  const instant = now.getTime();
  if (!Number.isFinite(instant)) throw new RangeError('Trading sessions require a valid Date');
  const timelines = TRADING_SESSIONS.map(config => ({ config, windows: windowsNear(instant, config) }));
  const sessions: TradingSessionState[] = timelines.map(({ config, windows }) => {
    const local = partsAt(instant, config.zone);
    const localDate = localDayKey(local);
    const today = windows.find(window => window.localDate === localDate);
    const window = today ? { start: today.start, end: today.end } : null;
    const nextOpen = windows.find(candidate => candidate.start > instant)!.start;
    const status: TradingSessionStatus = window && instant >= window.start && instant < window.end ? 'ACTIVE'
      : window && instant < window.start ? 'UPCOMING' : 'CLOSED';
    const elapsedMs = window ? Math.min(window.end - window.start, Math.max(0, instant - window.start)) : 0;
    return {
      ...config, hubs: config.hubs.map(hub => ({ ...hub, localTime: localClock(partsAt(instant, hub.zone)) })),
      localDate, localTime: localClock(local), status, window, nextOpen,
      progress: window ? progressAt(instant, window) : 0, elapsedMs,
      opensInMs: status === 'ACTIVE' ? null : nextOpen - instant,
      closesInMs: status === 'ACTIVE' ? window!.end - instant : null,
    };
  });
  const allOverlaps: TradingSessionOverlap[] = [];
  timelines.forEach((left, index) => {
    timelines.slice(index + 1).forEach(right => {
      left.windows.forEach(a => right.windows.forEach(b => {
        const start = Math.max(a.start, b.start), end = Math.min(a.end, b.end);
        if (start >= end || end <= instant) return;
        allOverlaps.push({
          sessionIds: [left.config.id, right.config.id], label: `${left.config.label} + ${right.config.label}`,
          start, end, progress: progressAt(instant, { start, end }),
          startsInMs: Math.max(0, start - instant), endsInMs: end - instant,
        });
      }));
    });
  });
  allOverlaps.sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    now: instant, sessions, activeSessions: sessions.filter(session => session.status === 'ACTIVE'),
    nextSession: [...sessions].sort((a, b) => a.nextOpen - b.nextOpen)[0],
    overlaps: allOverlaps.filter(overlap => overlap.start <= instant),
    nextOverlap: allOverlaps.find(overlap => overlap.start > instant) ?? null,
  };
}
