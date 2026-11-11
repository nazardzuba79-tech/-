/**
 * BestChange direction pages the page may link to WITHOUT server data
 * (the "links" mode of /exchangers, Issue #694).
 *
 * With an API key the server builds direction links from the official
 * `currencies` directory. Without one, a link built from catalogue urlnames
 * is only a guess until it is checked, so the page offers exactly the
 * directions listed here and nothing else.
 *
 * Each entry was confirmed by a HEAD request to
 * `https://www.bestchange.ru/{from}-to-{to}.html` answering 200 (an unknown
 * direction answers 301 to the home page). Status only: no page content is
 * read or parsed. Re-check with `node scripts/qa-exchangers-links.cjs`.
 */
export const VERIFIED_DIRECTIONS_CHECKED_ON = '2026-11-11';

/** from-urlname → to-urlnames. */
export const VERIFIED_DIRECTIONS: Readonly<Record<string, readonly string[]>> = {
  sbp: ['tether-trc20', 'tether-erc20', 'tether-bep20', 'tether-ton', 'bitcoin', 'ethereum', 'tron', 'ton', 'usd-coin-sol', 'litecoin', 'solana'],
  sberbank: ['tether-trc20', 'tether-erc20', 'tether-bep20', 'tether-ton', 'bitcoin', 'ethereum', 'tron', 'ton', 'usd-coin-sol', 'litecoin', 'solana'],
  tinkoff: ['tether-trc20', 'tether-erc20', 'tether-bep20', 'tether-ton', 'bitcoin', 'ethereum', 'tron', 'ton', 'usd-coin-sol', 'litecoin', 'solana'],
  alfaclick: ['tether-trc20', 'tether-erc20', 'tether-bep20', 'tether-ton', 'bitcoin', 'ethereum', 'tron', 'ton', 'usd-coin-sol', 'litecoin', 'solana'],
  vtb: ['tether-trc20', 'tether-erc20', 'tether-bep20', 'tether-ton', 'bitcoin', 'ethereum', 'tron', 'ton', 'usd-coin-sol', 'litecoin', 'solana'],
  'visa-mastercard-rub': ['tether-trc20', 'tether-erc20', 'tether-bep20', 'tether-ton', 'bitcoin', 'ethereum', 'tron', 'ton', 'usd-coin-sol', 'litecoin', 'solana'],
};

export function isVerifiedDirection(fromUrlname: string, toUrlname: string): boolean {
  return Object.prototype.hasOwnProperty.call(VERIFIED_DIRECTIONS, fromUrlname) && VERIFIED_DIRECTIONS[fromUrlname].includes(toUrlname);
}
