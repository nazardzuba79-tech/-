import { ArrowRightIcon, CheckIcon, ShieldCheckIcon, UsersIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Key, localeOf, useLanguage } from '../../lib/i18n';
import {
  formatAccountSize,
  formatPercent,
  getChartData,
  getCopierProfit,
  RiskLevel,
  Trader,
} from '../copy-trading-bolt/traders';
import { HOME_COPY_TRADERS } from './homeContent';

const AVATAR_TONES: Record<string, string> = {
  blue: 'from-[#375b8d] to-[#17253a] text-[#d8e8ff]',
  rose: 'from-[#825263] to-[#2b1920] text-[#ffe1ea]',
  green: 'from-[#326a59] to-[#142923] text-[#d8fff2]',
  slate: 'from-[#596575] to-[#202732] text-[#eef3fa]',
  orange: 'from-[#966747] to-[#322117] text-[#ffe8d5]',
  gold: 'from-[#9a762f] to-[#30230e] text-[#fff0bf]',
};

function riskKey(risk: RiskLevel): Key {
  if (risk === 'Low') return 'copyTrading.risk.low';
  if (risk === 'Moderate') return 'copyTrading.risk.medium';
  return 'copyTrading.risk.high';
}

function PerformanceLine({ trader }: { trader: Trader }) {
  const chart = getChartData(trader, 'ALL');
  const gradientId = `home-copy-${trader.id.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg
      className="vx-copy-chart"
      viewBox="0 0 900 280"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${trader.name} performance illustration`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2ebd85" stopOpacity=".28" />
          <stop offset="100%" stopColor="#2ebd85" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={chart.areaPath} fill={`url(#${gradientId})`} />
      <path className="vx-copy-chart-line" d={chart.linePath} />
    </svg>
  );
}

function TraderSpotlight({ trader }: { trader: Trader }) {
  const { lang, t } = useLanguage();
  const locale = localeOf(lang);
  const pnl = getCopierProfit(trader, 'ALL');

  return (
    <article className="vx-copy-card">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br text-[12px] font-semibold tracking-[0.04em] ${AVATAR_TONES[trader.tone] ?? AVATAR_TONES.slate}`}
            aria-hidden="true"
          >
            {trader.initials}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <strong className="truncate text-[14px] font-semibold text-white">{trader.name}</strong>
              {trader.verified && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-up text-[#07130f]" title="Verified strategy">
                  <CheckIcon size={10} strokeWidth={2.5} />
                </span>
              )}
            </span>
            <span className="mt-1 block truncate text-[11px] text-home-muted">{trader.strategy}</span>
          </span>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/55">
          ALL
        </span>
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,0.85fr)_minmax(92px,1.15fr)] items-end gap-3">
        <div>
          <span className="text-[10px] uppercase tracking-[0.12em] text-white/45">ROI</span>
          <strong className="mt-1 block whitespace-nowrap text-[28px] font-semibold leading-none tracking-[-0.035em] text-up">
            {formatPercent(trader.roiAll)}
          </strong>
        </div>
        <PerformanceLine trader={trader} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 border-t border-white/[0.07] pt-4">
        <div>
          <span className="block text-[10px] text-white/40">PnL</span>
          <strong className="mt-1 block truncate text-[12.5px] font-medium tabular-nums text-white">{formatAccountSize(pnl)}</strong>
        </div>
        <div>
          <span className="block text-[10px] text-white/40">{t('copyTrading.winRate')}</span>
          <strong className="mt-1 block text-[12.5px] font-medium tabular-nums text-white">{trader.winRate.toFixed(1)}%</strong>
        </div>
        <div>
          <span className="block text-[10px] text-white/40">{t('copyTrading.copiers')}</span>
          <strong className="mt-1 flex items-center gap-1.5 text-[12.5px] font-medium tabular-nums text-white">
            <UsersIcon size={12} className="text-white/40" />
            {trader.copiers.toLocaleString(locale)}
          </strong>
        </div>
        <div>
          <span className="block text-[10px] text-white/40">{t('copyTrading.risk')}</span>
          <strong className="mt-1 flex items-center gap-1.5 text-[12.5px] font-medium text-white">
            <ShieldCheckIcon size={12} className="text-gold-400" />
            {t(riskKey(trader.risk))}
          </strong>
        </div>
      </div>
    </article>
  );
}

export function HomeCopyTrading() {
  const { t } = useLanguage();

  return (
    <section id="copy-trading" className="mx-auto w-full max-w-[1460px] px-6" aria-labelledby="home-copy-title">
      <div className="vx-copy-shell relative overflow-hidden rounded-[10px] border border-white/[0.075] bg-[#090d13] px-5 py-7 sm:px-7 sm:py-9 lg:px-9 lg:py-10">
        <div className="vx-copy-depth" aria-hidden="true" />
        <div className="relative">
          <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-400">{t('home.copy.eyebrow')}</span>
              <h2 id="home-copy-title" className="mt-3 max-w-[720px] text-[27px] font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-[34px] lg:text-[39px]">
                {t('home.copy.title')}
              </h2>
              <p className="mt-4 max-w-[660px] text-[13px] leading-relaxed text-home-muted sm:text-[14px]">
                {t('home.copy.subtitle')}
              </p>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-5 lg:justify-end">
              <div className="lg:text-right">
                <strong className="block text-[27px] font-semibold tracking-[-0.035em] text-white sm:text-[31px]">{t('home.copy.scale')}</strong>
                <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-white/40">{t('home.copy.scaleCaption')}</span>
              </div>
              <Link to="/copy-trading" className="vx-home-cta inline-flex min-h-10 items-center gap-2 rounded-[6px] bg-gold-500 px-5 py-2.5 text-[13px] font-semibold text-ink-950">
                {t('home.copy.cta')}
                <ArrowRightIcon size={14} />
              </Link>
            </div>
          </div>

          <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {HOME_COPY_TRADERS.map((trader) => <TraderSpotlight key={trader.id} trader={trader} />)}
          </div>

          <p className="mt-4 text-[10.5px] leading-relaxed text-white/35">{t('home.copy.disclaimer')}</p>
        </div>
      </div>
    </section>
  );
}

