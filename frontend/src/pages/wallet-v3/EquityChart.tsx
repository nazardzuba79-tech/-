import { useEffect, useId, useMemo, useState } from 'react';
import { TrendingUpIcon, WifiOffIcon } from 'lucide-react';
import { Key, useLanguage } from '../../lib/i18n';
import { EM_DASH, MASK, formatPercent, formatSignedUsd, formatUsd, toneOf } from './format';
import { PERFORMANCE_PERIODS, PerformancePeriod, WalletPerformance } from './useWalletData';

/**
 * THE ACCOUNT'S EQUITY CURVE.
 *
 * WHERE THE LINE COMES FROM. `/wallet/performance` only: the account's own
 * stored daily `PortfolioSnapshot` values, with that day's deposits and
 * withdrawals removed before the day counts as performance, chained into a
 * time-weighted index and rescaled to end at the account's real current
 * value. Every point on this chart is a day this account actually lived
 * through. Nothing is generated, interpolated between days, extrapolated
 * forward, or shaped by a return written into the source — a curve like
 * that used to stand in for one account's history here, and a generated
 * return is not a return.
 *
 * WHAT HAPPENS WITH NO HISTORY. The card stays. A series needs two daily
 * snapshots before any return exists, so a young account gets the plot
 * frame with an explanation inside it and its period tabs still visible —
 * never a deleted section, and never a flat line drawn through points that
 * do not exist.
 *
 * WHY A PERIOD CAN BE REFUSED. `available: false` means the series does not
 * reach back far enough to cover that window. Showing a 12-day return in
 * the 30D slot would be a different number wearing the wrong label, so the
 * tab is disabled and says why, and the card opens on the widest window the
 * account can actually answer.
 */

const PERIOD_LABEL_KEY: Record<PerformancePeriod, Key> = {
  '7d': 'wallet.period7d',
  '30d': 'wallet.period30d',
  '90d': 'wallet.period90d',
  '1y': 'wallet.period1y',
  all: 'wallet.periodAll',
};

/**
 * The period tab's three states, hoisted rather than built inline. A
 * multi-line template literal in `className` is also unreadable to the
 * build-output audit in `registerWalletTailwindOwnership`, which reads
 * quoted segments and would take a bare `usable` for a utility class.
 */
const PERIOD_BASE = 'h-7 rounded-wsm border px-2 text-[12px] transition-colors duration-150 ease-exp';
const PERIOD_ON = 'border-hair-strong bg-panel-3 font-semibold text-ink';
const PERIOD_IDLE = 'border-transparent font-medium text-ink-3 hover:bg-panel-2 hover:text-ink-2';
const PERIOD_OFF = 'wallet-equity-period-off cursor-not-allowed border-transparent font-medium text-ink-4';

const VIEW_W = 1000;
const VIEW_H = 260;
const PAD_Y = 18;

/** The plotted geometry, or null when there is nothing honest to draw. */
function usePath(points: { date: string; equity: number }[]) {
  return useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.equity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // A perfectly flat series still has to render as a line, not a divide
    // by zero: give it the middle of the band rather than the top edge.
    const span = max - min;
    const y = (v: number) =>
      span === 0 ? VIEW_H / 2 : PAD_Y + (1 - (v - min) / span) * (VIEW_H - PAD_Y * 2);
    const x = (i: number) => (i / (points.length - 1)) * VIEW_W;

    const line = points.map((p, i) => `${x(i).toFixed(2)},${y(p.equity).toFixed(2)}`).join(' L');
    return {
      line: `M${line}`,
      area: `M0,${VIEW_H} L${line} L${VIEW_W},${VIEW_H} Z`,
      min,
      max,
      first: points[0],
      last: points[points.length - 1],
    };
  }, [points]);
}

export function EquityChart({
  performance,
  loading,
  unavailable,
  hidden,
}: {
  performance: WalletPerformance | null;
  loading: boolean;
  unavailable: boolean;
  hidden: boolean;
}) {
  const { t, lang } = useLanguage();
  const gradientId = useId();
  const [period, setPeriod] = useState<PerformancePeriod>('7d');
  const [pinned, setPinned] = useState(false);

  const periods = performance?.periods ?? null;
  const availablePeriods = useMemo(
    () => PERFORMANCE_PERIODS.filter((p) => periods?.[p]?.available),
    [periods],
  );

  // Open on the widest window this account can actually answer, once, when
  // the series first arrives. A young account would otherwise land on 7D,
  // see "not enough history", and never discover that its all-time curve
  // exists. The user's own later choice is never overridden.
  useEffect(() => {
    if (pinned || availablePeriods.length === 0) return;
    setPeriod(availablePeriods[availablePeriods.length - 1]);
    setPinned(true);
  }, [availablePeriods, pinned]);

  const selected = periods?.[period] ?? null;
  const available = Boolean(selected?.available);
  const points = available ? selected!.points : [];
  const geometry = usePath(points);
  const percent = selected?.percent ?? null;
  const positive = (percent ?? 0) >= 0;
  const stroke = positive ? 'var(--w-pos)' : 'var(--w-neg)';

  const ageDays = performance?.ageDays ?? 0;
  const startedOn = performance?.startedOn ?? null;

  return (
    <section
      aria-label={t('wallet.equityChartAria')}
      className="wallet-equity-chart rounded-wlg border border-hair bg-panel shadow-panel"
    >
      <div className="flex flex-col gap-3 border-b border-hair-soft px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 className="text-[15px] font-semibold tracking-normal text-ink">{t('wallet.equityChart')}</h2>
            {ageDays > 0 && (
              // Real, and worth saying: it tells the reader how much of the
              // curve is history rather than how much is chart.
              <span className="wallet-equity-age num text-[12px] text-ink-4">
                {t('wallet.historyDays', { days: ageDays })}
                {startedOn ? ` · ${t('wallet.historyFrom', { date: startedOn })}` : ''}
              </span>
            )}
          </div>
          <p className={`num mt-1.5 text-[22px] font-semibold leading-7 ${toneOf(percent)}`}>
            {hidden ? MASK : available ? formatSignedUsd(selected!.absolutePnl, lang) : EM_DASH}
          </p>
          <p className={`num text-[13px] font-medium leading-5 ${toneOf(percent)}`}>
            {hidden ? MASK : available ? formatPercent(percent, lang) : EM_DASH}
          </p>
        </div>

        <div
          className="wallet-equity-periods flex flex-wrap items-center gap-1"
          role="group"
          aria-label={t('wallet.pnlPeriod')}
        >
          {PERFORMANCE_PERIODS.map((p) => {
            const usable = Boolean(periods?.[p]?.available);
            const state = p === period ? PERIOD_ON : usable ? PERIOD_IDLE : PERIOD_OFF;
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPeriod(p);
                  setPinned(true);
                }}
                disabled={!usable}
                aria-pressed={p === period}
                title={usable ? undefined : t('wallet.periodUnavailable')}
                className={PERIOD_BASE + ' ' + state}
              >
                {t(PERIOD_LABEL_KEY[p])}
              </button>
            );
          })}
        </div>
      </div>

      <div className="wallet-equity-plot relative px-2 pb-2 pt-3 sm:px-3">
        <div className="relative h-[200px] w-full sm:h-[232px]">
          {/* The frame is drawn whether or not there is a series, so the
              card keeps its shape and the page does not jump when history
              starts to exist. */}
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="0"
                x2={VIEW_W}
                y1={VIEW_H * f}
                y2={VIEW_H * f}
                stroke="var(--w-hair-soft)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {geometry && !hidden && (
              <>
                <path d={geometry.area} fill={`url(#${gradientId})`} />
                <path
                  d={geometry.line}
                  fill="none"
                  stroke={stroke}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
          </svg>

          {/* Empty and error states live INSIDE the plot frame — the section
              is never removed, only explained. */}
          {(unavailable || loading || !available || hidden) && (
            <div className="wallet-equity-empty absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-center">
              {hidden ? (
                <span className="num text-[13px] text-ink-4">{MASK}</span>
              ) : loading ? (
                <span className="text-[12.5px] text-ink-4">{t('wallet.loading')}</span>
              ) : unavailable ? (
                <>
                  <WifiOffIcon className="h-5 w-5 text-ink-4" strokeWidth={1.6} aria-hidden="true" />
                  <span className="text-[13px] font-medium text-ink-3">{t('wallet.chartUnavailable')}</span>
                </>
              ) : availablePeriods.length > 0 ? (
                // The account HAS history, just not enough of it for the
                // window the reader picked. Say which fact is missing.
                <span className="text-[12.5px] text-ink-4">{t('wallet.periodUnavailable')}</span>
              ) : (
                <>
                  <TrendingUpIcon className="h-5 w-5 text-ink-4" strokeWidth={1.6} aria-hidden="true" />
                  <span className="text-[13px] font-medium text-ink-3">{t('wallet.chartNoHistory')}</span>
                  <span className="max-w-[420px] text-[12px] leading-4 text-ink-4">
                    {t('wallet.chartNoHistoryBody')}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {geometry && !hidden && (
          <div className="wallet-equity-axis mt-1 flex items-center justify-between px-1 text-[11.5px] text-ink-4">
            <span className="num">{geometry.first.date}</span>
            <span className="num">
              {formatUsd(geometry.min, lang, 0)} … {formatUsd(geometry.max, lang, 0)}
            </span>
            <span className="num">{geometry.last.date}</span>
          </div>
        )}
      </div>
    </section>
  );
}
