export const CARD_HERO_SLOGAN = 'Трать крипту по всему миру';
export const WATCH_CARD_IMAGE = '/cards/crypto-card-final/voltex-watch-wrist-final.png';

/** The owner's wrist composition, with neutral CHF and no baked-in headline.
 * Trim only the unused surrounding background. Uniform SVG scaling preserves
 * the complete watch/card and all ten round badges at every viewport size. */
export function WatchCardVisual() {
  return <svg viewBox="480 80 960 925" preserveAspectRatio="xMidYMid meet"
    role="img" aria-label="VOLTEX Black Signature · RUB / USD / GBP / CHF / EUR · BTC / ETH / USDT / TON / USDC"
    data-card-cinematic="wrist-watch"
    style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 12 }}>
    <image href={WATCH_CARD_IMAGE} width="1448" height="1086" preserveAspectRatio="xMidYMid meet" />
  </svg>;
}
