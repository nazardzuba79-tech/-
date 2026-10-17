import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { mutateFuturesBalance } from '../services/WalletMutation';
import { MarkPriceService } from './MarkPriceService';
import { CORE_FUTURES_SYMBOLS, FUNDING_INTERVAL_HOURS } from '../config/futuresConfig';
import { VOLTEX_FUNDING, voltexFundingRate, type VoltexFundingTerms } from '../config/voltexFunding';

type TxClient = Prisma.TransactionClient;

/** Every UTC multiple of FUNDING_INTERVAL_HOURS lands exactly on a real
 * funding boundary (00:00/08:00/16:00) because the Unix epoch itself
 * (1970-01-01T00:00:00Z) is a boundary and 24 divides evenly by 8. */
export function msUntilNextFundingBoundary(now = new Date(), intervalHours = FUNDING_INTERVAL_HOURS): number {
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const nextBoundaryMs = Math.ceil(now.getTime() / intervalMs) * intervalMs;
  return nextBoundaryMs <= now.getTime() ? intervalMs : nextBoundaryMs - now.getTime();
}

/** The settlement boundary a run at `now` belongs to: the latest boundary at or before it. */
export function fundingBoundaryAt(now = new Date(), intervalHours = FUNDING_INTERVAL_HOURS): Date {
  const intervalMs = intervalHours * 60 * 60 * 1000;
  return new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);
}

/**
 * Settles funding for real perpetual futures positions every 8 hours at
 * VOLTEX's own fixed rates (config/voltexFunding.ts): each open position
 * settles quantity × mark × its side's rate — a LONG pays 0.01%, a SHORT
 * receives 0.04% per settlement. Applied straight to the holder's futures
 * wallet balance, recorded as one FundingPayment per position.
 *
 * EACH BOUNDARY SETTLES ONCE PER SYMBOL. The run takes a transaction-scoped
 * advisory lock on (symbol, boundary) and settles nothing if a settlement
 * record for that symbol already exists inside the boundary's interval, so a
 * second instance (a deploy overlap), a restart or an early timer at the
 * same boundary can never charge or credit a position twice. Settlements
 * already made are never touched: the rate a payment was made at stays on
 * its FundingPayment row.
 */
export class FundingRateService {
  private timer?: NodeJS.Timeout;

  /** `listSymbols` is the live futures listing (FuturesMarketRegistry.list).
   *  Funding has to settle for whatever is actually listed, which is no
   *  longer a compile-time constant. Defaults to the core contracts so a
   *  caller that only needs the funding maths — the unit tests do — can
   *  construct this without a registry. */
  constructor(
    private prisma: PrismaClient,
    private markPriceService: MarkPriceService,
    private listSymbols: () => string[] = () => CORE_FUTURES_SYMBOLS,
    private terms: VoltexFundingTerms = VOLTEX_FUNDING,
    private now: () => Date = () => new Date()
  ) {}

  /** The signed cash-flow one position settles: positive credited, negative debited. Never multiplied by leverage. */
  fundingAmount(side: 'LONG' | 'SHORT', size: BigNumber, markPrice: BigNumber): BigNumber {
    return size.times(markPrice).times(voltexFundingRate(this.terms, side));
  }

  /** Settles one symbol's funding for the boundary the run belongs to.
   * Returns null — settling nothing, never a guessed price — when the mark
   * or index price is unavailable, or when this boundary is already settled. */
  async settleFundingForSymbol(symbol: string) {
    const markPrice = await this.markPriceService.getMarkPrice(symbol);
    const indexPrice = await this.markPriceService.getIndexPrice(symbol);
    if (!markPrice || !indexPrice || indexPrice.isZero()) return null;

    const [, quote] = symbol.split('/');
    const boundary = fundingBoundaryAt(this.now());
    const intervalEnd = new Date(boundary.getTime() + FUNDING_INTERVAL_HOURS * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx: TxClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`futures-funding:${symbol}:${boundary.getTime()}`}, 0))::text`;
      const settled = await tx.fundingRateRecord.findFirst({ where: { symbol, appliedAt: { gte: boundary, lt: intervalEnd } } });
      if (settled) return null;

      // `rate` is the LONG side's signed rate; each FundingPayment carries the rate its own side settled at.
      const record = await tx.fundingRateRecord.create({
        data: { symbol, rate: this.terms.longCashflow, markPrice: markPrice.toString(), indexPrice: indexPrice.toString(), appliedAt: boundary },
      });

      const positions = await tx.futuresPosition.findMany({ where: { symbol, status: 'OPEN' } });
      for (const position of positions) {
        const side = position.side === 'LONG' ? 'LONG' : 'SHORT';
        const amount = this.fundingAmount(side, new BigNumber(position.size.toString()), markPrice);

        await tx.fundingPayment.create({
          data: { positionId: position.id, userId: position.userId, symbol, amount: amount.toString(), rate: voltexFundingRate(this.terms, side) },
        });

        await mutateFuturesBalance(tx, position.userId, quote, { available: amount });
      }

      return record;
    });
  }

  async settleFundingForAllSymbols() {
    const results = [];
    for (const symbol of this.listSymbols()) {
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
