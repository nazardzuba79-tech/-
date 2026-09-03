import { CryptoIcon } from '../../components/CryptoIcon';
import { HomeMarket, byVolume, formatPriceValue } from './useHomeMarket';
import { useLanguage } from '../../lib/i18n';

/**
 * The mobile overlay in the hero composition. Secondary to the desktop
 * terminal by design: small, dark, and carrying only a watchlist so it
 * never competes with the terminal's own numbers.
 *
 * Prices here are the same live feed the rest of the page uses — this is a
 * scaled-down view of real markets, not a drawing of one.
 */
export function PhonePreview({ market }: { market: HomeMarket }) {
  const { t } = useLanguage();
  const rows = byVolume(market.tickers, 5);

  return (
    <div className="w-[152px] overflow-hidden rounded-[18px] border border-white/12 bg-ink-900 p-[5px] shadow-[0_30px_60px_-18px_rgba(0,0,0,0.95)]">
      <div className="overflow-hidden rounded-[13px] bg-ink-880">
        {/* status strip */}
        <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
          <span className="text-[5.5px] text-white/45">9:41</span>
          <span className="h-[7px] w-[34px] rounded-full bg-ink-950" />
          <span className="flex gap-[2px]">
            <span className="h-[4px] w-[4px] rounded-[1px] bg-white/35" />
            <span className="h-[4px] w-[6px] rounded-[1px] bg-white/35" />
          </span>
        </div>

        <div className="px-2.5 pb-2.5">
          <div className="text-[6px] text-faint">{t('nav.markets')}</div>
          <div className="mt-2 space-y-[7px]">
            {rows.map((r) => {
              const up = r.change >= 0;
              return (
                <div key={r.pair} className="flex items-center gap-1.5">
                  <CryptoIcon symbol={r.base} size={13} imageUrl={market.logoOf(r.base)} />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[6.5px] font-medium text-white/85">{r.base}</div>
                    <div className="text-[5.5px] text-faint">{r.quote}</div>
                  </div>
                  <div className="text-right leading-tight tabular-nums">
                    <div className="font-mono text-[6.5px] text-white">{formatPriceValue(r.price)}</div>
                    <div className={`font-mono text-[5.5px] ${up ? 'text-up' : 'text-down'}`}>
                      {up ? '+' : ''}
                      {r.change.toFixed(2)}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <span className="rounded-[4px] bg-up py-[4px] text-center text-[6px] font-semibold text-ink-950">
              {t('trade.buy')}
            </span>
            <span className="rounded-[4px] border border-white/12 py-[4px] text-center text-[6px] font-medium text-white/70">
              {t('trade.sell')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
