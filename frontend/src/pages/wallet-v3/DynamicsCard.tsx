import { useEffect, useId, useMemo, useState } from 'react';
import { TrendingUpIcon, WifiOffIcon } from 'lucide-react';
import { Key, useLanguage } from '../../lib/i18n';
import { EM_DASH, MASK, formatPercent, formatSignedUsd, toneOf } from './format';
import { PerformancePeriod, WalletPerformance } from './useWalletData';

/**
 * Динамика активов, on the approved layout: the period switch in the head,
 * a "profit for the period" band, the gold equity curve with date labels,
 * and one row per period with its USD profit and percentage.
 *
 * Every figure is the server's own `periods[p]` — the same object the P&L
 * Analysis section plots — so this card can never disagree with it. A
 * window the account's history does not reach back far enough to cover is
 * `available: false`: its row shows dashes and its tab is disabled, never a
 * shorter return wearing the wrong label. Nothing is generated or shaped.
 */
const PERIODS: PerformancePeriod[] = ['7d', '30d', '90d', 'all'];
const SHORT: Record<PerformancePeriod, Key> = {
  '7d': 'wallet.period7d',
  '30d': 'wallet.period30d',
  '90d': 'wallet.period90d',
  '1y': 'wallet.period1y',
  all: 'wallet.periodAllShort',
};
const LONG: Record<PerformancePeriod, Key> = { ...SHORT, all: 'wallet.periodAll' };

const W = 340;
const H = 150;
const PAD = { t: 14, b: 22, l: 10, r: 12 };

/** "10.09 — 16.09.2026" from the period's own ISO dates. */
function rangeLabel(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const [sy, sm, sd] = start.split('-');
  const [ey, em, ed] = end.split('-');
  return sy === ey ? `${sd}.${sm} — ${ed}.${em}.${ey}` : `${sd}.${sm}.${sy} — ${ed}.${em}.${ey}`;
}

export function DynamicsCard({
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
  const usable = useMemo(() => PERIODS.filter((p) => periods?.[p]?.available), [periods]);

  // Open on the first window the account can answer, once; a later choice
  // by the reader is never overridden.
  useEffect(() => {
    if (pinned || usable.length === 0) return;
    setPeriod(usable[0]);
    setPinned(true);
  }, [usable, pinned]);

  const selected = periods?.[period] ?? null;
  const ok = Boolean(selected?.available) && !unavailable;
  const points = ok ? selected!.points : [];

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.equity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / (points.length - 1);
    const y = (v: number) => (span === 0 ? (H - PAD.b + PAD.t) / 2 : PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b));
    const pts = points.map((p, i) => [x(i), y(p.equity)] as const);
    const line = 'M' + pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' L');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - PAD.b} L${pts[0][0].toFixed(1)},${H - PAD.b} Z`;
    const labels = [0, 1, 2, 3, 4].map((k) => {
      const i = Math.round(((points.length - 1) * k) / 4);
      const [, m, d] = points[i].date.split('-');
      return { x: x(i), text: `${d}.${m}`, anchor: (k === 0 ? 'start' : k === 4 ? 'end' : 'middle') as 'start' | 'end' | 'middle' };
    });
    return { line, area, last: pts[pts.length - 1], labels };
  }, [points]);

  const percent = ok ? selected!.percent : null;
  const tone = toneOf(percent);
  const range = ok ? rangeLabel(selected!.startDate, selected!.endDate) : null;

  return (
    <section aria-label={t('wallet.equityChart')} className="wallet-dynamics wallet-card">
      <div className="wallet-card-head">
        <div>
          <h2 className="wallet-card-title">{t('wallet.equityChart')}</h2>
          <p className="wallet-card-sub">{t('wallet.dynamicsSub')}</p>
        </div>
        <div className="wallet-seg" role="group" aria-label={t('wallet.pnlPeriod')}>
          {PERIODS.map((p) => {
            const can = Boolean(periods?.[p]?.available);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={p === period}
                disabled={!can}
                title={can ? undefined : t('wallet.periodUnavailable')}
                onClick={() => {
                  setPeriod(p);
                  setPinned(true);
                }}
              >
                {t(SHORT[p])}
              </button>
            );
          })}
        </div>
      </div>

      <div className="wallet-dyn-profit">
        <span className="text-[12px] text-ink-3">{t('wallet.profitForPeriod')}</span>
        <span className="flex items-baseline gap-1.5">
          <b className={`wallet-dyn-usd num ${tone}`}>{hidden ? MASK : ok ? formatSignedUsd(selected!.absolutePnl, lang) : EM_DASH}</b>
          <span className={`wallet-pill num ${tone}`} data-available={ok ? 'true' : 'false'}>
            {hidden ? MASK : ok ? formatPercent(percent, lang) : EM_DASH}
          </span>
        </span>
      </div>

      <div className="wallet-dyn-chart relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[150px] w-full" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--w-gold)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--w-gold)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[1, 2, 3].map((g) => {
            const gy = PAD.t + ((H - PAD.t - PAD.b) * g) / 4;
            return <line key={g} x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke="var(--w-hair-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
          })}
          {geometry && !hidden && (
            <>
              <path d={geometry.area} fill={`url(#${gradientId})`} />
              <path d={geometry.line} fill="none" stroke="var(--w-gold)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <circle cx={geometry.last[0]} cy={geometry.last[1]} r="3.2" fill="var(--w-gold)" stroke="var(--w-panel)" strokeWidth="2" />
              {geometry.labels.map((l) => (
                <text key={l.text + l.x} x={l.x} y={H - 5} fontSize="9.5" fill="var(--w-ink-4)" textAnchor={l.anchor} fontFamily="inherit">
                  {l.text}
                </text>
              ))}
            </>
          )}
        </svg>
        {(loading || unavailable || !ok || hidden || !geometry) && (
          <div className="wallet-equity-empty absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
            {hidden ? (
              <span className="num text-[13px] text-ink-4">{MASK}</span>
            ) : loading ? (
              <span className="text-[12px] text-ink-4">{t('wallet.loading')}</span>
            ) : unavailable ? (
              <>
                <WifiOffIcon className="h-4 w-4 text-ink-4" strokeWidth={1.6} aria-hidden="true" />
                <span className="text-[12px] font-medium text-ink-3">{t('wallet.chartUnavailable')}</span>
              </>
            ) : usable.length > 0 ? (
              <span className="text-[12px] text-ink-4">{t('wallet.periodUnavailable')}</span>
            ) : (
              <>
                <TrendingUpIcon className="h-4 w-4 text-ink-4" strokeWidth={1.6} aria-hidden="true" />
                <span className="text-[12px] font-medium text-ink-3">{t('wallet.chartNoHistory')}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="wallet-dyn-meta">
        <span className="num">{range ?? EM_DASH}</span>
        <span className="num">{ok && selected!.endDate ? t('wallet.updatedOn', { date: selected!.endDate }) : ''}</span>
      </div>

      <div className="wallet-period-rows" role="group" aria-label={t('wallet.periodsTitle')}>
        {PERIODS.map((p) => {
          const row = periods?.[p] ?? null;
          const can = Boolean(row?.available) && !unavailable;
          const pct = can ? row!.percent : null;
          return (
            <button
              key={p}
              type="button"
              className="wallet-period-row"
              data-period={p}
              data-available={can ? 'true' : 'false'}
              aria-pressed={p === period}
              onClick={() => {
                setPeriod(p);
                setPinned(true);
              }}
            >
              <span className="wallet-period-row-label">
                {t(LONG[p])}
                <small className="num">{can ? rangeLabel(row!.startDate, row!.endDate) ?? '' : t('wallet.notEnoughHistory')}</small>
              </span>
              <span className={`wallet-period-row-usd num ${toneOf(pct)}`}>{hidden ? MASK : can ? formatSignedUsd(row!.absolutePnl, lang) : EM_DASH}</span>
              <span className={`wallet-period-row-pct num ${toneOf(pct)}`}>{hidden ? MASK : can ? formatPercent(pct, lang) : EM_DASH}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
