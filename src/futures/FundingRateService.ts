import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { MarkPriceService } from './MarkPriceService';
import { FUTURES_SYMBOLS, FUNDING_INTERVAL_HOURS } from '../config/futuresConfig';

type TxClient = Prisma.TransactionClient;

// Standard perpetual-futures funding formula (same shape Binance/Bybit
// publish): rate = premium_index + clamp(interest_rate - premium_index,
// ±clamp_band), then the whole thing is capped so a single interval can
// never charge an extreme rate even during a mark/index dislocation.
const INTEREST_RATE = new BigNumber(0.0001); // 0.01% per 8h — conventional perpetual default (quote/base funding-rate differential)
const CLAMP_BAND = new BigNumber(0.0005); // ±0.05%
const RATE_CAP = new BigNumber(0.0075); // ±0.75% absolute cap

/** Every UTC multiple of FUNDING_INTERVAL_HOURS lands exactly on a real
 * funding boundary (00:00/08:00/16:00) because the Unix epoch itself
 * (1970-01-01T00:00:00Z) is a boundary and 24 divides evenly by 8. */
export function msUntilNextFundingBoundary(now = new Date(), intervalHours = FUNDING_INTERVAL_HOURS): number {
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const nextBoundaryMs = Math.ceil(now.getTime() / intervalMs) * intervalMs;
  return nextBoundaryMs <= now.getTime() ? intervalMs : nextBoundaryMs - now.getTime();
}

/**
 * Computes and settles funding for perpetual futures positions every 8
 * hours, based on the premium between our own mark price and the real
 * index price (see MarkPriceService). Positive rate: longs pay shorts.
 * Negative rate: shorts pay longs. Applied straight to each position
 * holder's futures wallet balance — the same instant-cash-flow treatment
 * real exchanges use (funding is not something that "rests" anywhere).
 */
export class FundingRateService {
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaClient, private markPriceService: MarkPriceService) {}

  computeFundingRate(markPrice: BigNumber, indexPrice: BigNumber): BigNumber {
    const premiumIndex = markPrice.minus(indexPrice).dividedBy(indexPrice);
    const interestAdjustment = BigNumber.minimum(
      BigNumber.maximum(INTEREST_RATE.minus(premiumIndex), CLAMP_BAND.negated()),
      CLAMP_BAND
    );
    const rate = premiumIndex.plus(interestAdjustment);
    return BigNumber.minimum(BigNumber.maximum(rate, RATE_CAP.negated()), RATE_CAP);
  }

  /** Settles one symbol's funding interval. Returns null (a no-op, not a
   * fabricated rate) when we don't have a real index price to compute
   * from — e.g. the upstream market-data feed is down. */
  async settleFundingForSymbol(symbol: string) {
    const markPrice = await this.markPriceService.getMarkPrice(symbol);
    const indexPrice = await this.markPriceService.getIndexPrice(symbol);
    if (!markPrice || !indexPrice || indexPrice.isZero()) return null;

    const rate = this.computeFundingRate(markPrice, indexPrice);
    const [, quote] = symbol.split('/');

    return this.prisma.$transaction(async (tx: TxClient) => {
      const record = await tx.fundingRateRecord.create({
        data: { symbol, rate: rate.toString(), markPrice: markPrice.toString(), indexPrice: indexPrice.toString() },
      });

      const positions = await tx.futuresPosition.findMany({ where: { symbol, status: 'OPEN' } });
      for (const position of positions) {
        const size = new BigNumber(position.size.toString());
        const notional = size.times(markPrice);
        // Long pays when rate is positive (amount negative = debited);
        // short receives (amount positive = credited). And vice versa
        // when rate is negative.
        const amount = position.side === 'LONG' ? notional.times(rate).negated() : notional.times(rate);

        await tx.fundingPayment.create({
          data: { positionId: position.id, userId: position.userId, symbol, amount: amount.toString(), rate: rate.toString() },
        });

        const balance = await tx.futuresBalance.upsert({
          where: { userId_asset: { userId: position.userId, asset: quote } },
          create: { userId: position.userId, asset: quote, available: '0', locked: '0' },
          update: {},
        });
        const nextAvailable = new BigNumber(balance.available.toString()).plus(amount);
        await tx.futuresBalance.update({
          where: { userId_asset: { userId: position.userId, asset: quote } },
          data: { available: nextAvailable.toString() },
        });
      }

      return record;
    });
  }

  async settleFundingForAllSymbols() {
    const results = [];
    for (const symbol of FUTURES_SYMBOLS) {
      results.push(await this.settleFundingForSymbol(symbol));
    }
    return results;
  }

  /** Starts the recurring funding loop, self-scheduling to the next real
   * 00:00/08:00/16:00 UTC boundary rather than a naive fixed interval
   * (which would drift and never land on the boundary real exchanges use). */
  startScheduler(): void {
    const scheduleNext = () => {
      this.timer = setTimeout(async () => {
        try {
          await this.settleFundingForAllSymbols();
        } catch (err) {
          console.error('Funding settlement failed', err);
        }
        scheduleNext();
      }, msUntilNextFundingBoundary());
    };
    scheduleNext();
  }

  stopScheduler(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
