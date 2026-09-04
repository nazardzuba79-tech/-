import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeftIcon } from 'lucide-react';
import { Nav } from '../../components/Nav';
import { Key, localeOf, useLanguage } from '../../lib/i18n';
import { EM_DASH, formatPercent, formatSignedUsd, formatUsd, toneOf } from '../wallet-v3/format';
import { PERFORMANCE_PERIODS, PerformancePeriod, useWalletData } from '../wallet-v3/useWalletData';
import { bucketBreakdown, dailyPnlSeries, drawdown, granularityFor, performanceStats } from './analytics';
import { BarChart, DrawdownChart, EquityChart, TooltipRow } from './charts';
import '../wallet-v3/wallet.css';
import './performance.css';

/**
 * /wallet/performance — the detailed portfolio analytics workspace behind
 * the compact PnL card on /wallet.
 *
 * It adds no data of its own. Everything on the page is derived from the
 * one canonical adjusted-equity series `GET /wallet/performance` already
 * serves and the compact card already plots, so the two screens can never
 * report different numbers for the same window. See analytics.ts for the
 * arithmetic and PortfolioPerformanceEngine for where the curve comes from.
 *
 * One period drives the whole page. It lives in the query string, so the
 * card can hand its own selection over on the way in and the view is
 * linkable.
 */

const PERIOD_LABEL_KEY: Record<PerformancePeriod, Key> = {
  '7d': 'wallet.period7d',
  '30d': 'wallet.period30d',
  '90d': 'wallet.period90d',
  '1y': 'wallet.period1y',
  all: 'wallet.periodAll',
};

function isPeriod(v: string | null): v is PerformancePeriod {
  return v !== null && (PERFORMANCE_PERIODS as string[]).includes(v);
}

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-wlg border border-hair bg-panel shadow-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hair-soft px-4 py-3">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {aside}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

/** A metric that may legitimately have no value — never a filler number. */
function Stat({ label, value, tone }: { label: string; value: string | null; tone?: string }) {
  const { t } = useLanguage();
  return (
    <div className="min-w-0 border-b border-hair-soft py-2.5">
      <p className="truncate text-[11px] text-ink-3">{label}</p>
      <p className={`num mt-0.5 truncate text-[13.5px] font-semibold ${value === null ? 'text-ink-4' : tone ?? 'text-ink'}`}>
        {value ?? t('perf.insufficient')}
      </p>
    </div>
  );
}

function SummaryTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-wlg border border-hair bg-panel px-4 py-3 shadow-panel">
      {/* Wraps rather than truncates: on a 375px tile "СТОИМОСТЬ
          ПОРТФЕЛЯ" does not fit on one line, and a clipped label is
          worse than a two-line one. */}
      <p className="vx-perf-tile-label text-[10.5px] font-semibold uppercase leading-[1.3] tracking-[0.1em] text-ink-3">{label}</p>
      <p className={`num mt-1.5 truncate text-[18px] font-semibold tracking-[-0.02em] ${tone ?? 'text-ink'}`}>{value}</p>
      {sub && <p className="num mt-0.5 truncate text-[11.5px] text-ink-4">{sub}</p>}
    </div>
  );
}

export function WalletPerformancePage() {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const period: PerformancePeriod = isPeriod(params.get('period')) ? (params.get('period') as PerformancePeriod) : '7d';

  // The performance page shows no coin list, so it skips the rankings feed.
  const { overview, performance, performanceState } = useWalletData({ rankings: false });

  const selected = performance?.periods?.[period] ?? null;
  const available = Boolean(selected?.available);
  const points = useMemo(() => selected?.points ?? [], [selected]);

  // Every derived figure on the page, from that one window. Recomputed only
  // when the window itself changes.
  const daily = useMemo(() => dailyPnlSeries(points), [points]);
  const dd = useMemo(() => drawdown(points), [points]);
  const stats = useMemo(() => performanceStats(points), [points]);
  const granularity = granularityFor(period);
  const breakdown = useMemo(() => bucketBreakdown(points, granularity), [points, granularity]);

  const fmtDate = (iso: string) =>
    new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(localeOf(lang), {
      day: '2-digit',
      month: 'short',
      year: granularity === 'month' ? 'numeric' : undefined,
      timeZone: 'UTC',
    });
  const fmtBucket = (key: string) =>
    key.length === 7
      ? new Date(`${key}-01T00:00:00.000Z`).toLocaleDateString(localeOf(lang), { month: 'short', year: 'numeric', timeZone: 'UTC' })
      : fmtDate(key);

  const loading = performanceState === 'loading' && !performance;
  const num = (v: number | null | undefined, digits = 2) =>
    v === null || v === undefined || !Number.isFinite(v)
      ? null
      : v.toLocaleString(localeOf(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits });

  function setPeriod(p: PerformancePeriod) {
    const next = new URLSearchParams(params);
    next.set('period', p);
    setParams(next, { replace: true });
  }

  const periodSelector = (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('wallet.pnlPeriod')}>
      {PERFORMANCE_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setPeriod(p)}
          aria-pressed={p === period}
          className={`h-7 rounded-wsm border px-2.5 text-[11.5px] transition-colors duration-150 ease-exp ${
            p === period
              ? 'border-hair-strong bg-panel-3 font-semibold text-ink'
              : 'border-transparent font-medium text-ink-4 hover:bg-panel-2 hover:text-ink-3'
          }`}
        >
          {t(PERIOD_LABEL_KEY[p])}
        </button>
      ))}
    </div>
  );

  const noHistory = (
    <div className="flex min-h-[120px] flex-col items-center justify-center px-4 py-8 text-center">
      <p className="text-[13px] font-medium text-ink-2">{t('perf.noHistory')}</p>
      <p className="mt-1 max-w-[380px] text-[11.5px] text-ink-4">{t('perf.noHistoryBody')}</p>
    </div>
  );

  return (
    <div className="vx-wallet">
      <Nav active="/wallet" />

      <main className="mx-auto w-full max-w-[1600px] px-4 pb-12 pt-5 sm:px-6 lg:px-8">
        <nav className="mb-3 flex items-center gap-1.5 text-[12px]" aria-label="breadcrumb">
          <Link to="/wallet" className="inline-flex items-center gap-1 text-ink-3 transition-colors duration-150 hover:text-ink">
            <ChevronLeftIcon size={13} />
            {t('perf.backToWallet')}
          </Link>
          <span className="text-ink-4">/</span>
          <span className="text-ink-3">{t('perf.title')}</span>
        </nav>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[21px] font-semibold tracking-[-0.022em] text-ink">{t('perf.title')}</h1>
          {periodSelector}
        </div>

        {/* --- summary ------------------------------------------------ */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <SummaryTile
            label={t('perf.totalValue')}
            value={overview ? formatUsd(overview.displayTotalUsd, lang) : EM_DASH}
          />
          <SummaryTile
            label={t('wallet.pnl')}
            value={available ? formatSignedUsd(stats.totalPnl, lang) : EM_DASH}
            tone={toneOf(stats.totalPnl)}
          />
          <SummaryTile
            label={t('perf.roi')}
            value={available ? formatPercent(stats.roiPct, lang) : EM_DASH}
            tone={toneOf(stats.roiPct)}
          />
          <SummaryTile
            label={t('perf.startValue')}
            value={available ? formatUsd(stats.startEquity, lang) : EM_DASH}
            sub={available && selected?.startDate ? fmtDate(selected.startDate) : undefined}
          />
          <SummaryTile
            label={t('perf.currentValue')}
            value={available ? formatUsd(stats.endEquity, lang) : EM_DASH}
            sub={available && selected?.endDate ? fmtDate(selected.endDate) : undefined}
          />
        </div>

        {/* --- main curve --------------------------------------------- */}
        <div className="mt-5">
          <Card
            title={t('perf.equityCurve')}
            aside={
              available ? (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px]">
                  <span className="text-ink-3">
                    {t('perf.roi')}{' '}
                    <span className={`num font-semibold ${toneOf(stats.roiPct)}`}>{formatPercent(stats.roiPct, lang)}</span>
                  </span>
                  <span className="text-ink-3">
                    {t('wallet.pnl')}{' '}
                    <span className={`num font-semibold ${toneOf(stats.totalPnl)}`}>{formatSignedUsd(stats.totalPnl, lang)}</span>
                  </span>
                  <span className="text-ink-3">
                    {t('perf.colStart')} <span className="num font-medium text-ink">{formatUsd(stats.startEquity, lang)}</span>
                  </span>
                  <span className="text-ink-3">
                    {t('perf.colEnd')} <span className="num font-medium text-ink">{formatUsd(stats.endEquity, lang)}</span>
                  </span>
                </div>
              ) : undefined
            }
          >
            {loading ? (
              <div className="h-[260px] animate-pulse rounded-w bg-panel-3" />
            ) : available ? (
              <EquityChart
                points={points}
                renderTooltip={(i) => (
                  <>
                    <p className="mb-1 text-[10.5px] font-medium text-ink-3">{fmtDate(points[i].date)}</p>
                    <TooltipRow label={t('perf.chartValue')} value={formatUsd(points[i].equity, lang)} />
                    <TooltipRow
                      label={t('perf.cumulativePnl')}
                      value={formatSignedUsd(points[i].equity - points[0].equity, lang)}
                      tone={toneOf(points[i].equity - points[0].equity)}
                    />
                    <TooltipRow
                      label={t('perf.roi')}
                      value={
                        points[0].equity > 0
                          ? formatPercent((points[i].equity / points[0].equity - 1) * 100, lang)
                          : EM_DASH
                      }
                      tone={toneOf(points[0].equity > 0 ? points[i].equity / points[0].equity - 1 : null)}
                    />
                  </>
                )}
              />
            ) : (
              noHistory
            )}
          </Card>
        </div>

        {/* --- statistics + drawdown ---------------------------------- */}
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Card title={t('perf.statistics')}>
            {available ? (
              <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
                <Stat label={t('wallet.pnl')} value={formatSignedUsd(stats.totalPnl, lang)} tone={toneOf(stats.totalPnl)} />
                <Stat label={t('perf.roi')} value={formatPercent(stats.roiPct, lang)} tone={toneOf(stats.roiPct)} />
                <Stat label={t('perf.tradingDays')} value={String(stats.tradingDays)} />
                <Stat label={t('perf.profitableDays')} value={String(stats.profitableDays)} tone="text-pos" />
                <Stat label={t('perf.losingDays')} value={String(stats.losingDays)} tone="text-neg" />
                <Stat label={t('perf.winRate')} value={num(stats.winRatePct) === null ? null : `${num(stats.winRatePct)}%`} />
                <Stat
                  label={t('perf.avgDaily')}
                  value={stats.avgDailyPnl === null ? null : formatSignedUsd(stats.avgDailyPnl, lang)}
                  tone={toneOf(stats.avgDailyPnl)}
                />
                <Stat
                  label={t('perf.bestDay')}
                  value={stats.bestDay ? formatSignedUsd(stats.bestDay.pnl, lang) : null}
                  tone={toneOf(stats.bestDay?.pnl)}
                />
                <Stat
                  label={t('perf.worstDay')}
                  value={stats.worstDay ? formatSignedUsd(stats.worstDay.pnl, lang) : null}
                  tone={toneOf(stats.worstDay?.pnl)}
                />
                <Stat
                  label={t('perf.maxDrawdown')}
                  value={num(stats.maxDrawdownPct) === null ? null : `${num(stats.maxDrawdownPct)}%`}
                  tone={stats.maxDrawdownPct ? 'text-neg' : undefined}
                />
                <Stat
                  label={t('perf.volatility')}
                  value={num(stats.volatilityPct) === null ? null : `${num(stats.volatilityPct)}%`}
                />
                <Stat label={t('perf.sharpe')} value={num(stats.sharpe)} />
                <Stat label={t('perf.sortino')} value={num(stats.sortino)} />
                <Stat label={t('perf.plRatio')} value={num(stats.profitLossRatio)} />
              </div>
            ) : (
              noHistory
            )}
          </Card>

          <Card
            title={t('perf.drawdown')}
            aside={
              available && stats.maxDrawdownPct !== null ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
                  <span className="text-ink-3">
                    {t('perf.maxDrawdown')}{' '}
                    <span className="num font-semibold text-neg">{num(stats.maxDrawdownPct)}%</span>
                  </span>
                  {stats.maxDrawdownUsd !== null && stats.maxDrawdownUsd < 0 && (
                    <span className="num font-medium text-neg">{formatSignedUsd(stats.maxDrawdownUsd, lang)}</span>
                  )}
                </div>
              ) : undefined
            }
          >
            {available ? (
              <>
                <DrawdownChart
                  points={dd.series}
                  renderTooltip={(i) => (
                    <>
                      <p className="mb-1 text-[10.5px] font-medium text-ink-3">{fmtDate(dd.series[i].date)}</p>
                      <TooltipRow
                        label={t('perf.drawdown')}
                        value={`${num(dd.series[i].drawdownPct)}%`}
                        tone={dd.series[i].drawdownPct < 0 ? 'text-neg' : 'text-ink'}
                      />
                      <TooltipRow label={t('perf.peak')} value={formatUsd(dd.series[i].peak, lang)} />
                      <TooltipRow label={t('perf.chartValue')} value={formatUsd(dd.series[i].equity, lang)} />
                    </>
                  )}
                />
                {dd.peakDate && dd.troughDate && (
                  <p className="mt-2 text-[11px] text-ink-4">
                    {t('perf.peak')} {fmtDate(dd.peakDate)} → {t('perf.trough')} {fmtDate(dd.troughDate)}
                  </p>
                )}
              </>
            ) : (
              noHistory
            )}
          </Card>
        </div>

        {/* --- daily PnL ---------------------------------------------- */}
        <div className="mt-5">
          <Card title={t('perf.dailyPnl')}>
            {available && daily.length > 0 ? (
              <BarChart
                bars={daily.map((d) => ({ date: d.date, value: d.pnl }))}
                renderTooltip={(i) => (
                  <>
                    <p className="mb-1 text-[10.5px] font-medium text-ink-3">{fmtDate(daily[i].date)}</p>
                    <TooltipRow label={t('perf.dailyPnl')} value={formatSignedUsd(daily[i].pnl, lang)} tone={toneOf(daily[i].pnl)} />
                    <TooltipRow
                      label={t('perf.dailyReturn')}
                      value={formatPercent(daily[i].returnPct, lang)}
                      tone={toneOf(daily[i].returnPct)}
                    />
                    <TooltipRow label={t('perf.chartValue')} value={formatUsd(daily[i].equity, lang)} />
                  </>
                )}
              />
            ) : (
              noHistory
            )}
          </Card>
        </div>

        {/* --- period breakdown --------------------------------------- */}
        <div className="mt-5">
          <Card
            title={t('perf.breakdown')}
            aside={
              breakdown.truncated > 0 ? (
                <span className="text-[11px] text-ink-4">
                  {t('perf.truncated').replace('{n}', String(breakdown.buckets.length))}
                </span>
              ) : undefined
            }
          >
            {available && breakdown.buckets.length > 0 ? (
              <div className="vx-perf-scroll -mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr className="border-b border-hair text-left text-[10.5px] uppercase tracking-[0.07em] text-ink-3">
                      <th className="py-2 pr-3 font-semibold">{t('perf.colPeriod')}</th>
                      <th className="py-2 pr-3 text-right font-semibold">{t('perf.colStart')}</th>
                      <th className="py-2 pr-3 text-right font-semibold">{t('perf.colEnd')}</th>
                      <th className="py-2 pr-3 text-right font-semibold">{t('wallet.pnl')}</th>
                      <th className="py-2 pr-3 text-right font-semibold">{t('perf.roi')}</th>
                      <th className="py-2 pr-3 text-right font-semibold">{t('perf.colBest')}</th>
                      <th className="py-2 text-right font-semibold">{t('perf.colWorst')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...breakdown.buckets].reverse().map((b) => (
                      <tr key={b.key} className="border-b border-hair-soft text-[12px] last:border-b-0">
                        <td className="whitespace-nowrap py-2 pr-3 font-medium text-ink">{fmtBucket(b.key)}</td>
                        <td className="num whitespace-nowrap py-2 pr-3 text-right text-ink-2">{formatUsd(b.startEquity, lang)}</td>
                        <td className="num whitespace-nowrap py-2 pr-3 text-right text-ink-2">{formatUsd(b.endEquity, lang)}</td>
                        <td className={`num whitespace-nowrap py-2 pr-3 text-right font-medium ${toneOf(b.pnl)}`}>
                          {formatSignedUsd(b.pnl, lang)}
                        </td>
                        <td className={`num whitespace-nowrap py-2 pr-3 text-right font-medium ${toneOf(b.roiPct)}`}>
                          {formatPercent(b.roiPct, lang)}
                        </td>
                        <td className="num whitespace-nowrap py-2 pr-3 text-right text-pos">
                          {b.bestDay ? formatSignedUsd(b.bestDay.pnl, lang) : EM_DASH}
                        </td>
                        <td className="num whitespace-nowrap py-2 text-right text-neg">
                          {b.worstDay ? formatSignedUsd(b.worstDay.pnl, lang) : EM_DASH}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              noHistory
            )}
          </Card>
        </div>

        {/* The rule the whole page rests on, said once, where a reader who
            wonders why a deposit did not move the curve will look. */}
        <p className="mt-4 max-w-[900px] text-[11px] leading-relaxed text-ink-4">{t('perf.flowsNote')}</p>
      </main>
    </div>
  );
}
