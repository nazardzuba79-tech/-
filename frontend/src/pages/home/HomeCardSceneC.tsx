import { CSSProperties, useId } from 'react';
import { WatchCardVisual, WATCH_CARD_IMAGE } from '../crypto-card-final/components/WatchCardVisual';

// Crop coordinates only: every visible pixel comes from the approved artwork.
// CHF reuses the approved renderer, including its existing face treatment.
const COINS = [
  { name: 'USD', x: 718, y: 196, r: 82 }, { name: 'EUR', x: 630, y: 324, r: 79 },
  { name: 'CHF', x: 600, y: 464, r: 83 }, { name: 'GBP', x: 637, y: 609, r: 85 },
  { name: 'RUB', x: 729, y: 737, r: 87 }, { name: 'BTC', x: 1189, y: 204, r: 74 },
  { name: 'ETH', x: 1282, y: 335, r: 85 }, { name: 'USDT', x: 1334, y: 482, r: 85 },
  { name: 'TON', x: 1297, y: 626, r: 85 }, { name: 'USDC', x: 1226, y: 756, r: 86 },
] as const;
const percent = (n: number, size: number) => `${(n / size * 100).toFixed(4)}%`;
const coinMask = (coin: typeof COINS[number], hole = false) =>
  `radial-gradient(ellipse ${percent(coin.r, 932)} ${percent(coin.r, 1006)} at ${percent(coin.x - 516, 932)} ${percent(coin.y - 80, 1006)}, ${hole ? 'transparent 78%, #000 100%' : '#000 84%, transparent 100%'})`;
const baseMask = [
  'linear-gradient(90deg, transparent, #000 14%, #000 75%, transparent)',
  'linear-gradient(180deg, transparent, #000 17%, #000 65%, transparent)',
  'radial-gradient(ellipse 56% 53% at 49% 43%, #000 47%, #000e 66%, transparent 100%)',
  ...COINS.map(coin => coinMask(coin, true)),
].join(', ');

/** Separate opacity/depth layers, never regenerated or retouched source assets.
 * The arm moves only with the complete rigid scene; badges drift a few pixels.
 * A same-position crop adds a local case shadow without blurring the product. */
export function HomeCardSceneC() {
  const clip = `vx-card-c-case-${useId().replace(/:/g, '')}`;
  return (
    <div className="vx-card-c-visual">
      <div className="vx-card-c-ambient" aria-hidden="true" />
      <div className="vx-card-c-plane">
        <div className="vx-card-c-float">
          <div className="vx-card-c-base" style={{
            maskImage: baseMask,
            maskComposite: Array(COINS.length + 2).fill('intersect').join(', '),
          }}>
            <WatchCardVisual framing="homepage" />
          </div>
          <svg className="vx-card-c-product" viewBox="516 80 932 1006" aria-hidden="true">
            <defs>
              <clipPath id={clip}>
                <path d="M956 274 C1020 257 1081 279 1105 342 L1120 346 C1134 350 1144 373 1141 399 L1183 561 C1207 630 1170 686 1107 709 L964 754 C898 775 852 737 830 675 L751 442 C726 370 760 327 822 305 Z" />
              </clipPath>
            </defs>
            <image href={WATCH_CARD_IMAGE} width="1448" height="1086" clipPath={`url(#${clip})`} />
          </svg>
          {COINS.map((coin, i) => (
            <div key={coin.name} className="vx-card-c-coin" aria-hidden="true" data-currency={coin.name}
              style={{
                maskImage: coinMask(coin),
                '--vx-coin-x': `${i % 2 ? 1.5 : -1.5}px`,
                '--vx-coin-y': `${i % 2 ? -3 : 3}px`,
                animationDuration: `${14 + i * 1.3}s`,
                animationDelay: `-${i * 1.7}s`,
              } as CSSProperties}>
              {coin.name === 'CHF' ? <WatchCardVisual framing="homepage" /> : (
                <svg viewBox="516 80 932 1006">
                  <image href={WATCH_CARD_IMAGE} width="1448" height="1086" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
