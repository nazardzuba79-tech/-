import { useMemo, useState } from 'react';
import { PieChartIcon } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { Lang, useLanguage } from '../../lib/i18n';
import { EmptyState } from './ui';
import { MASK, formatUsd } from './format';

/**
 * Распределение портфеля, on the approved layout: the donut on the left, a
 * legend of icon · symbol · bar · % · USD on the right, and a footer with
 * the account subtotals and the valuation status.
 *
 * Two cuts of the same real figures: by ASSET (every valued holding across
 * both accounts) and by ACCOUNT (the two accounts' own values). Shares are
 * computed from the server's valuations, never from a fixed set of shares.
 * An asset the server could not price is left out of the ring and named in
 * the footer, so the ring is not read as the whole portfolio when it is not.
 */
export interface AllocationHolding {
  symbol: string;
  valueUsd: number;
}
export interface AllocationAccount {
  label: string;
  valueUsd: number | null;
}

const SLICE_COLOR: Record<string, string> = {
  BTC: '#f7931a',
  ETH: '#627eea',
  USDT: '#26a17b',
  USDC: '#2775ca',
  EUR: '#1d4ed8',
  SOL: '#9945ff',
  XRP: '#23292f',
  BNB: '#f3ba2f',
  TON: '#0098ea',
  TRX: '#ef0027',
};
const ACCOUNT_COLORS = ['#f2b400', '#3b4351'];
const FALLBACK_COLORS = ['#70839f', '#98a2b3', '#7d8ea3', '#b0b8c4', '#8d99a8'];

/** "22,06M" — the donut centre only; every other figure keeps its digits. */
function compact(value: number, lang: Lang): string {
  const abs = Math.abs(value);
  const opts = (d: number) => ({ minimumFractionDigits: d, maximumFractionDigits: d });
  if (abs >= 1e6) return `${(value / 1e6).toLocaleString(lang, opts(2))}M`;
  if (abs >= 1e3) return `${(value / 1e3).toLocaleString(lang, opts(1))}K`;
  return value.toLocaleString(lang, opts(2));
}

export function AllocationCard({
  holdings,
  accounts,
  hidden,
  unavailable,
  loading,
  unpricedAssets = [],
  footer,
}: {
  holdings: AllocationHolding[];
  accounts: AllocationAccount[];
  hidden: boolean;
  unavailable: boolean;
  loading: boolean;
  unpricedAssets?: string[];
  /** The left footer line — the account subtotals, already formatted. */
  footer?: string;
}) {
  const { t, lang } = useLanguage();
  const [cut, setCut] = useState<'assets' | 'accounts'>('assets');

  const slices = useMemo(() => {
    const source =
      cut === 'assets'
        ? holdings.filter((h) => h.valueUsd > 0).map((h) => ({ key: h.symbol, value: h.valueUsd, icon: true }))
        : accounts.filter((a) => a.valueUsd !== null && a.valueUsd > 0).map((a) => ({ key: a.label, value: a.valueUsd!, icon: false }));
    const sorted = [...source].sort((a, b) => b.value - a.value);
    const total = sorted.reduce((s, x) => s + x.value, 0);
    if (total <= 0) return { list: [] as { key: string; value: number; percent: number; color: string; icon: boolean }[], total: 0 };
    return {
      total,
      list: sorted.map((x, i) => ({
        ...x,
        percent: (x.value / total) * 100,
        color: cut === 'assets' ? SLICE_COLOR[x.key] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] : ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
      })),
    };
  }, [holdings, accounts, cut]);

  const size = 200;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = 2.2;
  let offset = 0;
  const showRing = !unavailable && !loading && slices.list.length > 0;

  return (
    <section aria-label={t('wallet.allocation')} className="wallet-allocation wallet-card">
      <div className="wallet-card-head">
        <div>
          <h2 className="wallet-card-title">{t('wallet.allocation')}</h2>
          <p className="wallet-card-sub">{t('wallet.allocationSub')}</p>
        </div>
        <div className="wallet-seg" role="group" aria-label={t('wallet.allocation')}>
          <button type="button" aria-pressed={cut === 'assets'} onClick={() => setCut('assets')}>
            {t('wallet.assets')}
          </button>
          <button type="button" aria-pressed={cut === 'accounts'} onClick={() => setCut('accounts')}>
            {t('wallet.accountsTitle')}
          </button>
        </div>
      </div>

      {!showRing ? (
        <EmptyState
          icon={PieChartIcon}
          title={unavailable ? t('wallet.dataUnavailable') : t('wallet.noAllocation')}
          description={unavailable ? t('wallet.allocationUnavailableBody') : t('wallet.noAllocationBody')}
          compact
        />
      ) : (
        <>
          <div className="wallet-dist">
            <div className="wallet-donut" style={{ width: size, height: size }}>
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--w-panel-3)" strokeWidth={stroke} />
                {slices.list.map((s) => {
                  const len = (s.percent / 100) * c;
                  const visible = Math.max(len - gap, 0.5);
                  const el = (
                    <circle
                      key={s.key}
                      cx={size / 2}
                      cy={size / 2}
                      r={r}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={stroke}
                      strokeDasharray={`${visible.toFixed(2)} ${(c - visible).toFixed(2)}`}
                      strokeDashoffset={(-offset).toFixed(2)}
                      transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    />
                  );
                  offset += len;
                  return el;
                })}
              </svg>
              <div className="wallet-donut-center">
                <small>{t('wallet.allocationTotal')}</small>
                <strong className="num">{hidden ? MASK : compact(slices.total, lang)}</strong>
                <em>{cut === 'assets' ? `USD · ${t('wallet.assetsCount', { count: slices.list.length })}` : 'USD'}</em>
              </div>
            </div>

            <ul className="wallet-legend">
              {slices.list.map((s) => (
                <li key={s.key} className="wallet-legend-row" data-slice={s.key}>
                  <span className="flex h-[18px] w-[18px] items-center justify-center">
                    {s.icon ? <CryptoIcon symbol={s.key} size={18} /> : <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden="true" />}
                  </span>
                  <span className="truncate text-[13px] font-semibold text-ink">{s.key}</span>
                  <span className="wallet-legend-bar" aria-hidden="true">
                    <i style={{ width: `${s.percent.toFixed(1)}%`, background: s.color }} />
                  </span>
                  <span className="wallet-legend-pct num">{s.percent.toFixed(1)}%</span>
                  <span className="wallet-legend-usd num">{hidden ? MASK : `${formatUsd(s.value, lang).replace('$', '')} USD`}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="wallet-dist-foot">
            <span>{hidden ? MASK : footer}</span>
            <span className="wallet-dist-status">
              {unpricedAssets.length > 0 ? t('wallet.allocationIncomplete', { assets: unpricedAssets.join(', ') }) : t('wallet.valuationFullShort')}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
