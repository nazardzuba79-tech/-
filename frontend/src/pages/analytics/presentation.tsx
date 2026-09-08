import type { ReactNode } from 'react';
import { useLanguage, type Key } from '../../lib/i18n';

/**
 * The small vocabulary every Analytics module renders through.
 *
 * One idea runs through all of it: **there is no code path from "no data"
 * to a number.** `Metric` takes `string | null`, and `null` renders the
 * unavailable dash. A caller that wants to show a figure has to actually
 * have one. Formatting helpers return `null` rather than `0` for anything
 * unparseable, so a malformed payload degrades to a dash too.
 *
 * The inverse is equally deliberate: a real `0` formats as `0`. An
 * untraded contract's open interest is a fact about the market, and
 * scrubbing it away would be its own kind of dishonesty.
 */

/** The single unavailable glyph. Never "0", never "-", never blank. */
export const DASH = '—';

/** Compact USD. Returns null for anything that is not a finite number, so
 *  a bad value can never surface as "$0". */
export function formatUsd(value: number | string | null | undefined): string | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

export function formatPercent(value: number | string | null | undefined, digits = 2): string | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return `${n.toFixed(digits)}%`;
}

export function formatSignedPercent(value: number | string | null | undefined, digits = 2): string | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/** A price with enough significant digits for sub-dollar assets, and no
 *  rounding of a small real number down to "0.00". */
export function formatPrice(value: string | number | null | undefined): string | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A base-asset quantity. A real zero stays "0"; small quantities keep
 *  their significant digits rather than rounding away to nothing. */
export function formatQuantity(value: string | number | null | undefined): string | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  // Below 1, keep enough precision that a genuine 0.000000001 is visible
  // instead of collapsing to 0.
  return n.toFixed(Math.min(12, Math.max(4, Math.ceil(-Math.log10(abs)) + 3)));
}

/** A funding rate is stored as a fraction; it is displayed as a percentage
 *  with four decimals, the convention the futures header already uses. */
export function formatFundingRate(rate: string | null | undefined): string | null {
  if (rate === null || rate === undefined) return null;
  const n = Number(rate);
  if (!Number.isFinite(n)) return null;
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(4)}%`;
}

/** A countdown to an absolute epoch-ms boundary, as HH:MM:SS. Returns
 *  null once the boundary has passed or the input is not a real time. */
export function formatCountdown(targetMs: number | null | undefined, now: number): string | null {
  if (targetMs === null || targetMs === undefined || !Number.isFinite(targetMs)) return null;
  const remaining = targetMs - now;
  if (remaining <= 0) return null;
  const total = Math.floor(remaining / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Provider names are proper nouns and are shown verbatim rather than
 *  translated — "CoinGecko" is "CoinGecko" in every language. */
const SOURCE_LABEL: Record<string, string> = {
  coingecko: 'CoinGecko',
  'alternative.me': 'Alternative.me',
  kraken: 'Kraken',
  twelvedata: 'Twelve Data',
  binance: 'Binance',
  okx: 'OKX',
  voltex: 'VOLTEX',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

/**
 * The compact provenance line: `CoinGecko · updated 12s ago`.
 *
 * Deliberately small and secondary. §7 of the brief is explicit that every
 * metric must not carry a giant provider label — but the information has
 * to be reachable, so it sits once per module rather than once per number,
 * and a stale reading is visually distinct rather than silently identical
 * to a live one.
 */
export function SourceTag({
  source,
  fetchedAt,
  stale,
  live,
}: {
  source: string;
  fetchedAt?: number | null;
  stale?: boolean;
  /** VOLTEX's own state is read per request, so it is labelled "Live"
   *  rather than with an age that would only measure our own clock. */
  live?: boolean;
}) {
  const { t } = useLanguage();
  const now = Date.now();

  let age: string | null = null;
  if (live) {
    age = t('analytics.live');
  } else if (typeof fetchedAt === 'number' && Number.isFinite(fetchedAt)) {
    const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
    if (seconds < 5) age = t('analytics.updatedJustNow');
    else if (seconds < 90) age = t('analytics.updatedSecondsAgo').replace('{n}', String(seconds));
    else age = t('analytics.updatedMinutesAgo').replace('{n}', String(Math.round(seconds / 60)));
  }

  return (
    <span className={`vx-source${stale ? ' is-stale' : ''}`}>
      <span className="vx-source-dot" aria-hidden />
      {sourceLabel(source)}
      {age ? <span className="vx-source-age">· {stale ? t('analytics.stale') : age}</span> : null}
    </span>
  );
}

/**
 * One labelled figure.
 *
 * `value === null` is the ONLY way to get the unavailable dash, and a
 * dash is the only thing an absent value can render as. There is no
 * fallback parameter and no default — adding one would be the exact hole
 * this component exists to close.
 */
export function Metric({
  label,
  value,
  tone,
  hint,
  emphasis,
}: {
  label: string;
  value: string | null;
  tone?: 'positive' | 'negative' | 'neutral';
  hint?: string;
  emphasis?: boolean;
}) {
  const unavailable = value === null;
  return (
    <div className={`vx-metric${emphasis ? ' is-strong' : ''}`}>
      <span className="vx-metric-label">{label}</span>
      <span
        className={`vx-metric-value${unavailable ? ' is-unavailable' : ''}${tone && !unavailable ? ` is-${tone}` : ''}`}
      >
        {unavailable ? DASH : value}
      </span>
      {hint ? <small className="vx-metric-hint">{hint}</small> : null}
    </div>
  );
}

/** A module container: heading, optional provenance, body. */
export function Module({
  title,
  meta,
  note,
  children,
  className = '',
}: {
  title: string;
  meta?: ReactNode;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`vx-module ${className}`.trim()}>
      <header className="vx-module-head">
        <h2>{title}</h2>
        {meta}
      </header>
      {note ? <p className="vx-module-note">{note}</p> : null}
      {children}
    </section>
  );
}

/**
 * The compact "no source connected" state.
 *
 * §6 of the brief asks for clean slots for future providers without a page
 * of giant empty cards, so this is a single dense row rather than a card
 * body: it reserves the module's place in the information architecture and
 * states plainly why it is empty, without pretending to be a chart that
 * failed to load.
 */
export function UnavailableModule({ titleKey, detail }: { titleKey: Key; detail?: string }) {
  const { t } = useLanguage();
  return (
    <div className="vx-pending" role="status">
      <span className="vx-pending-title">{t(titleKey)}</span>
      <span className="vx-pending-state">{detail ?? t('analytics.noSource')}</span>
    </div>
  );
}

/**
 * The venue label for a multi-venue figure.
 *
 * Built from the venues that ACTUALLY contributed, never written by hand.
 * That is the whole point: when OKX is down, this returns "Binance", so
 * the page cannot keep claiming "Binance + OKX" over a figure OKX had no
 * part in. §26 of the brief is explicit about it and this is where it is
 * enforced for the UI.
 */
export function venuesLabel(venues: { venue: string }[] | undefined): string | null {
  if (!venues || venues.length === 0) return null;
  return venues.map((v) => sourceLabel(v.venue)).join(' + ');
}

/** A compact table row of one venue's figure, so every number on a
 *  multi-venue module carries the venue that produced it. */
export function VenueRow({
  venue,
  contract,
  value,
  tone,
  stale,
}: {
  venue: string;
  contract?: string;
  value: string | null;
  tone?: 'positive' | 'negative';
  stale?: boolean;
}) {
  return (
    <div className={`vx-venue-row${stale ? ' is-stale' : ''}`}>
      <span className="vx-venue-name">
        {sourceLabel(venue)}
        {contract ? <small className="vx-venue-contract">{contract}</small> : null}
      </span>
      <span className={`vx-venue-value${value === null ? ' is-unavailable' : tone ? ` is-${tone}` : ''}`}>
        {value ?? DASH}
      </span>
    </div>
  );
}

/**
 * A long/short split as a labelled bar plus its two proportions.
 *
 * Renders NOTHING when the proportions are missing — no half-and-half bar,
 * which would read as a balanced market rather than as absent data.
 */
export function LongShortBar({
  label,
  long,
  short,
  longLabel,
  shortLabel,
}: {
  label: string;
  long: number | null;
  short: number | null;
  longLabel: string;
  shortLabel: string;
}) {
  const usable = typeof long === 'number' && Number.isFinite(long) && typeof short === 'number' && Number.isFinite(short) && long + short > 0;
  return (
    <div className="vx-ls">
      <div className="vx-ls-head">
        <span className="vx-ls-label">{label}</span>
        <span className="vx-ls-figures">
          {usable ? (
            <>
              <b className="is-positive">{(long * 100).toFixed(1)}%</b>
              <i>/</i>
              <b className="is-negative">{(short * 100).toFixed(1)}%</b>
            </>
          ) : (
            <b className="is-unavailable">{DASH}</b>
          )}
        </span>
      </div>
      {usable ? (
        <div className="vx-ls-bar" role="img" aria-label={`${longLabel} ${(long * 100).toFixed(1)}% · ${shortLabel} ${(short * 100).toFixed(1)}%`}>
          <span className="vx-ls-long" style={{ width: `${(long / (long + short)) * 100}%` }} />
          <span className="vx-ls-short" style={{ width: `${(short / (long + short)) * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** A correlation cell, coloured by strength and signed. `null` is never
 *  reachable here — an unusable pair is omitted upstream rather than
 *  rendered as 0, which would claim "uncorrelated". */
export function correlationTone(r: number): 'positive' | 'negative' | 'neutral' {
  if (r >= 0.3) return 'positive';
  if (r <= -0.3) return 'negative';
  return 'neutral';
}
