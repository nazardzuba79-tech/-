/**
 * The order the deposit window offers destinations in (owner, 2026-09-29:
 * «Першим повинен бути USDT в мережі TRC20»).
 *
 * USDT on TRON (TRC-20) first — the window opens on it and it heads the
 * asset list — then USDT's other networks, then everything else in the
 * catalogue's own order. Only the ORDER changes: no destination is added,
 * removed or altered, and an asset asked for by the page (a Wallet row)
 * still wins over this default.
 */
export interface OrderableDestination { chain: string; assets: string[]; standard?: string }

const isTron = (destination: OrderableDestination) =>
  destination.standard === 'TRC-20' || /(^|:)tron$/.test(destination.chain);

export function orderDepositDestinations<T extends OrderableDestination>(destinations: T[]): T[] {
  const rank = (destination: T) => destination.assets.includes('USDT') ? (isTron(destination) ? 0 : 1) : 2;
  return destinations
    .map((destination, index) => ({ destination, index }))
    .sort((a, b) => rank(a.destination) - rank(b.destination) || a.index - b.index)
    .map(item => item.destination);
}
