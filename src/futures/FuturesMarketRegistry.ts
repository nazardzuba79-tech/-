import { PrismaClient } from '@prisma/client';
import { KrakenMarketDataService } from '../services/KrakenMarketDataService';
import {
  CORE_FUTURES_SYMBOLS,
  PERP_QUOTE_ASSET,
  MIN_PERP_24H_QUOTE_VOLUME,
  MAX_PERP_MARKETS,
  FUTURES_MARKET_REFRESH_MS,
} from '../config/futuresConfig';

/**
 * Which perpetual contracts exist.
 *
 * This used to be a three-entry constant, which is why the futures terminal
 * could only ever show BTC, ETH and SOL. The universe is derived now, but
 * derived under listing rules rather than "whatever the exchange quotes":
 * a market is listed only if it settles in USDT, has a live index price
 * right now, and clears a 24h volume floor. Those are the same three things
 * the futures stack actually needs — mark price, funding and liquidation
 * all read the index, and a leveraged position on a market too thin to exit
 * is the failure mode the old curated list was guarding against. Expressing
 * the guard as a rule keeps that protection while letting the list be as
 * large as the data supports.
 *
 * Two invariants matter more than freshness:
 *
 *  - A symbol carrying an open position or a resting order is never
 *    delisted. Volume dipping under the floor must not strand someone's
 *    position behind a symbol the API would then reject.
 *  - A failed refresh changes nothing. The previous good set stays, so an
 *    upstream outage cannot silently shrink the exchange.
 *
 * The set is recomputed slowly (FUTURES_MARKET_REFRESH_MS) on purpose: the
 * market panel should not reshuffle under a trader's cursor.
 */
export class FuturesMarketRegistry {
  private symbols: string[] = [...CORE_FUTURES_SYMBOLS];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private marketData: KrakenMarketDataService,
    private prisma: PrismaClient
  ) {}

  /** The currently listed contracts, ranked by 24h volume descending. */
  list(): string[] {
    return this.symbols;
  }

  /** Whether orders may be placed on this contract. */
  has(symbol: string): boolean {
    return this.symbols.includes(symbol);
  }

  /**
   * Symbols that must stay listed regardless of market data, because a user
   * would otherwise be unable to act on something they already hold.
   */
  private async symbolsInFlight(): Promise<string[]> {
    try {
      const [positions, orders] = await Promise.all([
        this.prisma.futuresPosition.findMany({
          where: { status: 'OPEN' },
          select: { symbol: true },
          distinct: ['symbol'],
        }),
        this.prisma.futuresOrder.findMany({
          where: { status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
          select: { symbol: true },
          distinct: ['symbol'],
        }),
      ]);
      return [...positions.map((p) => p.symbol), ...orders.map((o) => o.symbol)];
    } catch (err) {
      // A database hiccup must not be able to delist anything either, so
      // treat "unknown" as "keep what we have" upstream.
      console.error('[FuturesMarketRegistry] Could not read in-flight symbols:', err);
      return this.symbols;
    }
  }

  async refresh(): Promise<string[]> {
    let tickers;
    try {
      tickers = await this.marketData.getTickers();
    } catch (err) {
      // Keeps the previous set. Never falls back to "no markets".
      console.error('[FuturesMarketRegistry] Ticker refresh failed, keeping previous listing:', err);
      return this.symbols;
    }

    const volumeBySymbol = new Map<string, number>();
    for (const t of tickers) {
      const [, quote] = t.pair.split('/');
      if (quote !== PERP_QUOTE_ASSET) continue;
      // A live index price is non-negotiable: without it mark price,
      // funding and the liquidation engine have nothing to read.
      const price = Number(t.lastPrice);
      if (!Number.isFinite(price) || price <= 0) continue;
      const volume = Number(t.quoteVolume24h);
      if (!Number.isFinite(volume)) continue;
      volumeBySymbol.set(t.pair, volume);
    }

    if (volumeBySymbol.size === 0) {
      console.error('[FuturesMarketRegistry] Ticker feed returned no usable pairs, keeping previous listing');
      return this.symbols;
    }

    const eligible = [...volumeBySymbol.entries()]
      .filter(([, volume]) => volume >= MIN_PERP_24H_QUOTE_VOLUME)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PERP_MARKETS)
      .map(([pair]) => pair);

    const inFlight = await this.symbolsInFlight();

    // Core first so the majors keep a stable place at the top of the panel,
    // then everything else by volume. Symbols only kept for an open
    // position may have no live quote at all, hence the fallback ordering.
    const listed = [...new Set([...CORE_FUTURES_SYMBOLS, ...eligible, ...inFlight])];
    listed.sort((a, b) => {
      const coreA = CORE_FUTURES_SYMBOLS.indexOf(a);
      const coreB = CORE_FUTURES_SYMBOLS.indexOf(b);
      if (coreA !== -1 || coreB !== -1) {
        if (coreA === -1) return 1;
        if (coreB === -1) return -1;
        return coreA - coreB;
      }
      return (volumeBySymbol.get(b) ?? 0) - (volumeBySymbol.get(a) ?? 0);
    });

    this.symbols = listed;
    return listed;
  }

  /** Refreshes once now, then on the slow cadence. */
  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), FUTURES_MARKET_REFRESH_MS);
    // Never hold the process open for a listing refresh.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
