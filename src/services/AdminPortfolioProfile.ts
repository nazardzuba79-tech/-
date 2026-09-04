import { PerformancePoint, dayKeyToDate, utcDayKey } from './PortfolioPerformanceEngine';

/**
 * A private Wallet *presentation* profile for one operator account.
 *
 * ────────────────────────────────────────────────────────────────────────
 *  READ THIS BEFORE TOUCHING ANYTHING HERE.
 *
 *  The holdings and the equity curve in this file are NOT real money and
 *  NOT a real track record. They are a display layer for a single account's
 *  own Wallet page, and nothing else in the exchange may read them:
 *
 *   - they are never written to Balance or FuturesBalance;
 *   - they never reach the matching engine, margin, liquidation, order
 *     validation, withdrawal eligibility, deposit accounting, treasury,
 *     proof of reserves, or any liability figure;
 *   - they are never exposed to another account, including other admins,
 *     and never to an anonymous caller;
 *   - Copy Trading, Analytics and the admin user list do not consume them.
 *
 *  Every real financial operation continues to read the real ledger. If a
 *  future change makes any of the above untrue, that change is a bug —
 *  see src/services/__tests__/AdminPortfolioProfile.test.ts, which exists
 *  to fail loudly if the isolation is broken.
 *
 *  The figures here are also not suitable for representing performance to
 *  anyone else. They describe no real trading.
 * ────────────────────────────────────────────────────────────────────────
 */

/**
 * Authorization is the existing role model — `role === 'ADMIN'`, checked by
 * requireAdmin/requireAuth as everywhere else. The email is an *additional*
 * narrowing on top of it, never a substitute: an account with this address
 * but without the ADMIN role gets nothing, and so does every other admin.
 */
export const ADMIN_PROFILE_EMAIL = 'voltex.crypto@gmail.com';

export interface ProfileUser {
  role: string;
  email: string;
}

/** Both conditions, in that order. Neither alone is sufficient. */
export function hasAdminPortfolioProfile(user: ProfileUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role !== 'ADMIN') return false;
  return user.email.trim().toLowerCase() === ADMIN_PROFILE_EMAIL;
}

export interface ProfileHolding {
  asset: string;
  /** Units held, as a decimal string so no precision is lost in transit. */
  quantity: string;
}

/**
 * The presentation holdings. Quantities only — never a price. Valuation is
 * done at request time from the exchange's own live market data (Kraken
 * mirror for crypto, the existing CFD provider for EUR/USD), so this file
 * contains no invented prices and no invented USD total.
 */
export const ADMIN_PROFILE_HOLDINGS: ProfileHolding[] = [
  { asset: 'BTC', quantity: '271' },
  { asset: 'ETH', quantity: '561' },
  { asset: 'XRP', quantity: '1200000' },
  { asset: 'USDT', quantity: '32726245' },
  { asset: 'USDC', quantity: '1200000' },
  { asset: 'EUR', quantity: '700000' },
];

// ── The performance series ────────────────────────────────────────────────

/** Day zero of the profile's history. */
export const PROFILE_START_DAY = '2025-07-04';

/**
 * The date the anchor returns below describe. The curve is pinned to these
 * exactly on this day; before it the shape is interpolated, after it the
 * series keeps growing day by day (see `futureStep`), so the numbers move
 * with the calendar instead of freezing.
 */
export const PROFILE_REFERENCE_DAY = '2026-09-04';

/**
 * Cumulative return, as a growth multiple, looking back from the reference
 * day. `days` is how far back the window reaches.
 *
 * These are anchors for ONE curve, not five numbers handed to the UI. Every
 * period the Wallet shows is measured off the generated series by the same
 * `computePeriod` a normal account uses, which is what keeps 30D from being
 * four 7Ds added together.
 */
const ANCHORS: { days: number; multiple: number }[] = [
  { days: 0, multiple: 1 },
  { days: 7, multiple: 1.28 }, // +28%
  { days: 30, multiple: 2.32 }, // +132%
  { days: 90, multiple: 4.17 }, // +317%
  { days: 365, multiple: 20.26 }, // +1926%
];

const MS_PER_DAY = 86_400_000;

/**
 * Deterministic 32-bit hash — the same day always yields the same value.
 *
 * Every step ends in `>>> 0`, the final XOR included: JavaScript's bitwise
 * operators return *signed* 32-bit integers, so without that last coercion
 * the division below lands in [-0.5, 0.5) instead of [0, 1) and the whole
 * series inherits a negative drift.
 */
function hash01(n: number, salt: number): number {
  let x = (n + salt * 0x9e3779b9) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x21f0aaad) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 0x100000000;
}

/** Deterministic value in [-1, 1). */
function noise(n: number, salt: number): number {
  return hash01(n, salt) * 2 - 1;
}

function dayIndex(dayKey: string, originKey: string): number {
  return Math.round((dayKeyToDate(dayKey).getTime() - dayKeyToDate(originKey).getTime()) / MS_PER_DAY);
}

/**
 * Log-equity on the historical stretch, measured backwards from the
 * reference day. `back` is days before the reference day (0 = reference).
 *
 * Straight-line in log space between anchors — which is what makes returns
 * compound rather than add — plus a seeded wobble that is exactly zero at
 * every anchor, so the anchor mathematics survives the texture. The wobble
 * is tapered with sin(pi*u), which vanishes at both ends of each segment.
 */
function historicalLog(back: number): number {
  const total = dayIndex(PROFILE_REFERENCE_DAY, PROFILE_START_DAY);
  const anchors = [...ANCHORS, { days: total, multiple: 22.15 }] // +2115% all-time
    .filter((a, i, arr) => arr.findIndex((b) => b.days === a.days) === i)
    .sort((a, b) => a.days - b.days);

  const clamped = Math.max(0, Math.min(back, total));
  let lo = anchors[0];
  let hi = anchors[anchors.length - 1];
  for (let i = 0; i < anchors.length - 1; i++) {
    if (clamped >= anchors[i].days && clamped <= anchors[i + 1].days) {
      lo = anchors[i];
      hi = anchors[i + 1];
      break;
    }
  }

  const loLog = -Math.log(lo.multiple);
  const hiLog = -Math.log(hi.multiple);
  if (hi.days === lo.days) return loLog;

  const u = (clamped - lo.days) / (hi.days - lo.days);
  const base = loLog + (hiLog - loLog) * u;

  // Texture: pullbacks and surges inside the segment, never at its ends.
  // Amplitude scales with the segment's own log span so a short segment
  // wobbles less in absolute terms than a year-long one.
  const span = Math.abs(hiLog - loLog);
  const amplitude = Math.min(0.09, span * 0.11);
  const taper = Math.sin(Math.PI * u);
  const wobble =
    noise(Math.round(clamped), 17) * 0.7 + noise(Math.round(clamped / 3), 91) * 0.3;

  return base + amplitude * taper * wobble;
}

/**
 * One day's log step *after* the reference day.
 *
 * Weekly regimes rather than a constant drift: most weeks grow strongly,
 * some are flat, a few are negative, and individual days inside a good week
 * still close red. That is what stops next week's 7D from being this week's
 * number again, while 30D/90D/1Y keep moving because their windows now
 * contain different days of this same series.
 */
function futureStep(day: number): number {
  const week = Math.floor((day - 1) / 7);
  // Weekly drift between roughly -0.6% and +2.6% per day, seeded per week.
  const regime = hash01(week, 3571);
  const weeklyDrift = -0.006 + regime * regime * 0.032;
  const daily = noise(day, 6113) * 0.021;
  return weeklyDrift + daily;
}

/**
 * The canonical daily series, in normalized index units (reference day = 1).
 *
 * Pure function of the calendar: refreshing the browser, restarting the
 * process or scaling to another instance all reproduce the identical past.
 * Nothing is persisted and nothing is randomised at runtime.
 */
export function adminEquityIndex(now: Date = new Date()): { date: string; index: number }[] {
  const todayKey = utcDayKey(now);
  const totalDays = dayIndex(todayKey, PROFILE_START_DAY);
  if (totalDays < 1) return [];

  const refBack = dayIndex(PROFILE_REFERENCE_DAY, PROFILE_START_DAY);
  const out: { date: string; index: number }[] = [];

  // Future steps are cumulative from the reference day, so they must be
  // summed in order — the same order every time, from the same origin.
  let futureCumulative = 0;
  const startMs = dayKeyToDate(PROFILE_START_DAY).getTime();

  for (let i = 0; i <= totalDays; i++) {
    const date = utcDayKey(new Date(startMs + i * MS_PER_DAY));
    let log: number;
    if (i <= refBack) {
      log = historicalLog(refBack - i);
    } else {
      futureCumulative += futureStep(i - refBack);
      log = futureCumulative;
    }
    out.push({ date, index: Math.exp(log) });
  }
  return out;
}

/**
 * The series the Wallet plots: the index rescaled so the final point equals
 * the account's real current presentation valuation. Same shape as a normal
 * account's adjusted-equity curve, so `computePeriod` treats both the same
 * way and there is only one code path for period mathematics.
 */
export function adminPerformanceSeries(currentValueUsd: number, now: Date = new Date()): PerformancePoint[] {
  const index = adminEquityIndex(now);
  if (index.length === 0) return [];
  const last = index[index.length - 1].index;
  const scale = last > 0 ? currentValueUsd / last : 0;
  return index.map((p) => ({ date: p.date, equity: p.index * scale }));
}
