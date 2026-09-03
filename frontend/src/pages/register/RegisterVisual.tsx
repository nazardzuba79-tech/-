import { useEffect, useState } from 'react';
import { CandlestickChartIcon, ShieldCheckIcon, WalletIcon } from 'lucide-react';
import { api } from '../../lib/api';
import { parseChangePercent } from '../../lib/priceChange';
import { CryptoIcon } from '../../components/CryptoIcon';
import { HomeCryptoCard } from '../home/HomeCryptoCard';
import { byVolume, formatPriceValue, HomeTicker } from '../home/useHomeMarket';
import { Key, useLanguage } from '../../lib/i18n';

/**
 * The supporting half of the registration page — deliberately quieter than
 * the form, which is the only thing on this screen the visitor has to act
 * on.
 *
 * Everything product-shaped here is the real thing rather than a second
 * copy of it: the approved card artwork via HomeCryptoCard, asset marks via
 * CryptoIcon, and live prices from the exchange's own ticker feed. The
 * prototype shipped a hardcoded `tickers` array and its own CandleChart;
 * neither is reproduced.
 */
const TRUST_POINTS: { key: string; Icon: typeof ShieldCheckIcon; labelKey: Key; frame: string; tint: string; shape: string }[] = [
  {
    key: 'security',
    Icon: ShieldCheckIcon,
    labelKey: 'register.trust.security',
    frame: 'border-up/35 bg-up/[0.08]',
    tint: 'text-up',
    shape: 'rounded-full',
  },
  {
    key: 'tools',
    Icon: CandlestickChartIcon,
    labelKey: 'register.trust.tools',
    frame: 'border-gold-500/40 bg-gold-500/[0.08]',
    tint: 'text-gold-400',
    shape: 'rounded-[8px]',
  },
  {
    key: 'infrastructure',
    Icon: WalletIcon,
    labelKey: 'register.trust.infrastructure',
    frame: 'border-[#4b7fd0]/40 bg-[#2f6fd0]/[0.12]',
    tint: 'text-[#8db4f0]',
    shape: 'rounded-[4px]',
  },
];

/** Only the ticker feed, polled at the same interval the homepage uses.
 *  Deliberately not useHomeMarket: that also fetches rankings, global stats
 *  and CFD quotes for panels this page does not have, and a registration
 *  screen should not spend four requests to draw four rows. */
const POLL_MS = 15_000;

function useRegisterTickers(): { rows: HomeTicker[]; status: 'loading' | 'ok' | 'error' } {
  const [rows, setRows] = useState<HomeTicker[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalTickers()
        .then((res) => {
          if (cancelled) return;
          setRows(
            res.tickers.map((t) => {
              const [base, quote] = t.pair.split('/');
              return {
                pair: t.pair,
                base,
                quote,
                price: parseFloat(t.lastPrice) || 0,
                change: parseChangePercent(t.changePercent24h, t.pair),
                quoteVolume: parseFloat(t.quoteVolume24h) || 0,
                high: parseFloat(t.high24h) || 0,
                low: parseFloat(t.low24h) || 0,
              };
            })
          );
          setStatus('ok');
        })
        .catch(() => {
          if (!cancelled) setStatus('error');
        });
    }
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return { rows, status };
}

export function RegisterVisual() {
  const { t } = useLanguage();
  const { rows, status } = useRegisterTickers();
  const lead = rows.find((r) => r.pair === 'BTC/USDT') ?? rows[0];
  const top = byVolume(rows, 4);

  return (
    <div className="relative hidden overflow-hidden border-r border-white/6 bg-ink-950 lg:block">
      {/* --- atmosphere: navy depth and two fine arcs, no neon, no rings --- */}
      <div
        aria-hidden="true"
        className="vx-breathe pointer-events-none absolute -left-[10%] -top-[16%] h-[700px] w-[780px] bg-[radial-gradient(50%_50%_at_50%_50%,rgba(30,62,116,0.38),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="vx-breathe-alt pointer-events-none absolute bottom-[-6%] left-[10%] h-[520px] w-[700px] rounded-[100%] border-t border-[#4d86d6]/40 bg-[radial-gradient(58%_82%_at_50%_0%,rgba(61,118,196,0.22),transparent_74%)]"
      />
      {/* Two asymmetric off-centre arcs — each shows one edge only, so they
          read as directional light rather than concentric target rings. */}
      <div
        aria-hidden="true"
        className="vx-arc pointer-events-none absolute left-[38%] top-[30%] h-[300px] w-[620px] -translate-x-1/2 -translate-y-1/2 rotate-[-13deg] rounded-[100%] border-t border-gold-500/20"
      />
      <div
        aria-hidden="true"
        className="vx-arc-slow pointer-events-none absolute left-[56%] top-[62%] h-[420px] w-[720px] -translate-x-1/2 -translate-y-1/2 rotate-[7deg] rounded-[100%] border-b border-gold-500/[0.12]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[16%] right-[4%] h-[300px] w-[340px] bg-[radial-gradient(50%_50%_at_50%_50%,rgba(224,169,63,0.16),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[180px] bg-[linear-gradient(to_bottom,transparent,#05070a)]"
      />

      <div className="relative flex h-full flex-col justify-center gap-9 px-10 py-10 xl:px-14 xl:py-12">
        <div>
          <span className="inline-flex items-center gap-2 rounded-[6px] border border-white/10 bg-white/[0.04] px-3 py-[5px] text-[9.5px] font-medium uppercase tracking-[0.11em] text-white/75">
            {t('register.badge')}
          </span>
          <h1 className="mt-6 max-w-[460px] text-[32px] font-bold leading-[1.1] tracking-[-0.022em] text-white xl:text-[36px]">
            {t('register.headlineTop')}
            <span className="block text-gold-500">{t('register.headlineBottom')}</span>
          </h1>
          <p className="mt-4 max-w-[420px] text-[13.5px] leading-relaxed text-home-muted">{t('register.visualCopy')}</p>

          <ul className="mt-7 space-y-3">
            {TRUST_POINTS.map(({ key, Icon, labelKey, frame, tint, shape }) => (
              <li key={key} className="flex items-center gap-3">
                <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center border ${shape} ${frame} ${tint}`}>
                  <Icon size={15} strokeWidth={1.75} />
                </span>
                <span className="text-[12.5px] text-white/80">{t(labelKey)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Restrained product fragment: the lead instrument and the four
            deepest markets, all live. */}
        <div className="relative">
          <div className="w-full max-w-[500px] overflow-hidden rounded-[8px] border border-white/8 bg-ink-900/90">
            <div className="flex items-center justify-between border-b border-white/6 px-3.5 py-2.5">
              <span className="text-[10px] font-medium text-white/75">{lead?.pair ?? 'BTC/USDT'}</span>
              {lead ? (
                <span className={`font-mono text-[10.5px] tabular-nums ${lead.change >= 0 ? 'text-up' : 'text-down'}`}>
                  {formatPriceValue(lead.price)} {lead.change >= 0 ? '+' : ''}
                  {lead.change.toFixed(2)}%
                </span>
              ) : (
                <span className="font-mono text-[10.5px] text-faint">—</span>
              )}
            </div>
            <div>
              {top.length === 0 ? (
                <div className="px-3.5 py-6 text-center text-[10.5px] text-faint">
                  {status === 'loading' ? t('register.marketsLoading') : t('home.marketDataUnavailable')}
                </div>
              ) : (
                top.map((row) => (
                  <div
                    key={row.pair}
                    className="flex items-center gap-2.5 border-b border-white/[0.04] px-3.5 py-[9px] last:border-b-0"
                  >
                    <CryptoIcon symbol={row.base} size={19} />
                    <span className="text-[10px] text-white/70">{row.pair}</span>
                    <span className="ml-auto font-mono text-[10px] tabular-nums text-white/80">
                      {formatPriceValue(row.price)}
                    </span>
                    <span
                      className={`w-12 text-right font-mono text-[9.5px] tabular-nums ${row.change >= 0 ? 'text-up' : 'text-down'}`}
                    >
                      {row.change >= 0 ? '+' : ''}
                      {row.change.toFixed(2)}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* The approved card artwork, untouched — no sweep here, the form
              is the only thing on this screen that should draw the eye. */}
          <div className="absolute -bottom-10 -right-7 hidden rotate-[-7deg] xl:block">
            <HomeCryptoCard width={176} />
          </div>
        </div>
      </div>
    </div>
  );
}
