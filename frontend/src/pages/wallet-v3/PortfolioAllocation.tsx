import { useMemo } from 'react';
import { PieChartIcon } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { useLanguage } from '../../lib/i18n';
import { EmptyState } from './ui';
import { MASK, formatUsdCompact } from './format';
import { LedgerRow } from './useWalletData';

/**
 * Portfolio allocation, on the approved V3 ring.
 *
 * The palette is the design's own — gold, institutional blue, emerald,
 * graphite — extended in the same register for the assets it did not cover.
 * Nothing neon; this is a financial workspace.
 *
 * Percentages are computed from the account's actual valuations, never
 * from the prototype's fixed 63.2 / 18.4 / 9.3 / 9.1.
 */
const SLICE_COLOR: Record<string, string> = {
  BTC: '#d99a22',
  ETH: '#4f6fd8',
  USDT: '#159a78',
  SOL: '#70839f',
  XRP: '#5b7fa6',
  USDC: '#2775b6',
  EUR: '#8a7bb8',
  BNB: '#c8952f',
  TON: '#3f8fc4',
  TRX: '#b5535d',
};
const FALLBACK_COLORS = ['#70839f', '#98a2b3', '#7d8ea3', '#b0b8c4', '#8d99a8'];

function colorFor(symbol: string, index: number): string {
  return SLICE_COLOR[symbol] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/** Anything under this share is folded into one "other" slice. */
const MIN_SHARE = 0.015;

export function PortfolioAllocation({
  rows,
  hidden,
  unavailable,
  loading,
}: {
  rows: LedgerRow[];
  hidden: boolean;
  unavailable: boolean;
  loading: boolean;
}) {
  const { t, lang } = useLanguage();

  const slices = useMemo(() => {
    const held = rows
      .filter((r) => (r.valueUsd ?? 0) > 0)
      .map((r) => ({ symbol: r.symbol, value: r.valueUsd! }))
      .sort((a, b) => b.value - a.value);
    const total = held.reduce((s, x) => s + x.value, 0);
    if (total <= 0) return { list: [] as { symbol: string; value: number; percent: number; color: string }[], total: 0 };

    const main = held.filter((x) => x.value / total >= MIN_SHARE);
    const restValue = held.filter((x) => x.value / total < MIN_SHARE).reduce((s, x) => s + x.value, 0);
    const list = main.map((x, i) => ({
      symbol: x.symbol,
      value: x.value,
      percent: (x.value / total) * 100,
      color: colorFor(x.symbol, i),
    }));
    if (restValue > 0) {
      list.push({ symbol: t('wallet.other'), value: restValue, percent: (restValue / total) * 100, color: '#d0d5dd' });
    }
    return { list, total };
  }, [rows, t]);

  const size = 132;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = 3;
  let offset = 0;

  const showRing = !unavailable && !loading && slices.list.length > 0;

  return (
    <section aria-label={t('wallet.allocation')} className="min-w-0 rounded-wlg border border-hair bg-panel shadow-panel">
      <div className="flex items-center justify-between border-b border-hair-soft px-4 py-3">
        <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-ink">{t('wallet.allocation')}</h2>
        {showRing && <span className="num text-[11px] text-ink-4">{slices.list.length}</span>}
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
          <div className="flex justify-center px-4 pb-1 pt-5">
            <div className="relative" style={{ width: size, height: size }}>
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eff1f5" strokeWidth={stroke} />
                {slices.list.map((s) => {
                  const len = (s.percent / 100) * c;
                  const visible = Math.max(len - gap, 1);
                  const el = (
                    <circle
                      key={s.symbol}
                      cx={size / 2}
                      cy={size / 2}
                      r={r}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={stroke}
                      strokeLinecap="round"
                      strokeDasharray={`${visible} ${c - visible}`}
                      strokeDashoffset={-(offset + gap / 2)}
                    />
                  );
                  offset += len;
                  return el;
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center px-3">
                <span className="text-[9.5px] font-medium uppercase tracking-[0.1em] text-ink-4">{t('wallet.allocationTotal')}</span>
                <span className="num mt-1 w-full truncate text-center text-[13px] font-semibold tracking-[-0.02em] text-ink">
                  {hidden ? MASK : formatUsdCompact(slices.total, lang)}
                </span>
              </div>
            </div>
          </div>

          <ul className="px-2.5 pb-3 pt-4">
            {slices.list.map((s) => (
              <li key={s.symbol} className="flex items-center gap-2 px-1.5 py-[7px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                <CryptoIcon symbol={s.symbol} size={18} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{s.symbol}</span>
                <span className="num w-[46px] shrink-0 text-right text-[12.5px] font-medium text-ink-2">{s.percent.toFixed(1)}%</span>
                <span className="num min-w-0 max-w-[86px] shrink-0 truncate text-right text-[12px] text-ink-3">
                  {hidden ? MASK : formatUsdCompact(s.value, lang)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
