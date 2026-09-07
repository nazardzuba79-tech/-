export const CARD_HERO_SLOGAN = 'Трать крипту по всему миру';
export const WATCH_CARD_IMAGE = '/cards/crypto-card-final/voltex-watch-wrist-original.png';

/** Owner's exact original pixels, without AI edits. The viewport excludes the
 * old baked-in left headline while retaining the complete watch and ten badges.
 * Uniform scaling preserves all original proportions. */
export function WatchCardVisual() {
  return <svg viewBox="516 80 928 925" preserveAspectRatio="xMidYMid meet"
    role="img" aria-label="VOLTEX Black Signature · RUB / USD / GBP / CHF / EUR · BTC / ETH / USDT / TON / USDC"
    data-card-cinematic="wrist-watch"
    style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 12 }}>
    <image href={WATCH_CARD_IMAGE} width="1448" height="1086" preserveAspectRatio="xMidYMid meet" />
  </svg>;
}
