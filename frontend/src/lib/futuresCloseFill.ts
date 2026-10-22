import BigNumber from 'bignumber.js';

/**
 * What a market close actually filled: the summed quantity and its
 * volume-weighted average price, both as decimal strings.
 *
 * It is read from what the engine reported for THIS close — the real
 * engine's `trades` in the close response, the simulation engine's new
 * CLOSE fills in its journal — and never from a mark or last price, which
 * is what the position was worth, not what it was closed at.
 */
export interface FuturesCloseFill {
  quantity: string;
  averagePrice: string;
}

interface Fill { price: string | null | undefined; quantity: string | null | undefined }

/** `undefined` when nothing usable was filled; the card then omits the price. */
export function closeFillFromFills(fills: readonly Fill[] | null | undefined): FuturesCloseFill | undefined {
  if (!fills?.length) return undefined;
  let quantity = new BigNumber(0);
  let notional = new BigNumber(0);
  for (const fill of fills) {
    const price = new BigNumber(fill.price ?? NaN);
    const size = new BigNumber(fill.quantity ?? NaN).abs();
    if (!price.isFinite() || !size.isFinite() || price.lte(0) || size.lte(0)) continue;
    quantity = quantity.plus(size);
    notional = notional.plus(price.times(size));
  }
  if (quantity.lte(0)) return undefined;
  return { quantity: quantity.toFixed(), averagePrice: notional.div(quantity).toFixed() };
}

/** The real engine answers a close with `{ order, trades }`. */
export function closeFillFromResponse(response: unknown): FuturesCloseFill | undefined {
  const trades = (response as { trades?: Fill[] } | null | undefined)?.trades;
  return Array.isArray(trades) ? closeFillFromFills(trades) : undefined;
}

interface JournalEvent { id: string; kind: string; positionId: string | null; price: string | null; quantity: string }

/** Ids of the CLOSE fills a position already had before this close started. */
export function closeEventIds(events: readonly JournalEvent[] | null | undefined, positionId: string): Set<string> {
  return new Set((events ?? []).filter(e => e.positionId === positionId && e.kind === 'CLOSE').map(e => e.id));
}

/** The simulation engine's fills for this close: CLOSE events on the
 *  position that were not in the journal before it started. */
export function closeFillFromEvents(events: readonly JournalEvent[] | null | undefined, positionId: string, before: Set<string>): FuturesCloseFill | undefined {
  return closeFillFromFills((events ?? []).filter(e => e.positionId === positionId && e.kind === 'CLOSE' && !before.has(e.id)));
}
