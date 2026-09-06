import { CardProduct, Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';

/** Only the real quote method is injected; never Wallet presentation holdings. */
export interface CardUsdPriceSource {
  pricesFor(assets: string[]): Promise<Map<string, number | null>>;
}

export interface CardEligibility {
  verificationApproved: boolean;
  depositEligible: boolean;
  tradingVolumeEligible: boolean;
  eligible: boolean;
  qualifyingDepositUsd: number;
  qualifyingTradingVolumeUsd: number;
  depositValuationComplete: boolean;
  tradingVolumeValuationComplete: boolean;
  valuation: {
    asOf: string;
    depositBasis: 'CUMULATIVE_CREDITED_DEPOSITS';
    tradingVolumeBasis: 'ALL_PERSISTED_EXECUTED_TRADES';
    conversion: 'CURRENT_USD_QUOTES';
  };
}

export interface CardApplicationSnapshot {
  eligibility: CardEligibility;
  application: null | {
    id: string;
    product: CardProduct;
    status: 'SUBMITTED';
    submittedAt: Date;
  };
}

export class CardApplicationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    public readonly snapshot?: CardApplicationSnapshot,
  ) { super(code); }
}

type CardDb = Pick<Prisma.TransactionClient, 'user' | 'deposit' | 'trade' | 'cardApplication'>;

/**
 * No existing VIP/volume period exists in this backend. Read the complete
 * CREDITED deposit history and actual Trade fills (both spot and futures
 * settlement persist there), never pending orders, DemoTrade, synthetic
 * performance, balances, referrals or operator presentation holdings.
 *
 * The ledger has asset amounts, not historical USD marks. Its value is
 * explicitly CURRENT USD valuation using the existing quote conventions.
 * Missing/invalid quotes contribute nothing and mark that route incomplete;
 * they never make an account qualify. Known amounts may independently qualify.
 */
export class CardApplicationService {
  constructor(private readonly prisma: PrismaClient, private readonly prices: CardUsdPriceSource) {}

  private async inputs(db: CardDb, userId: string) {
    if (typeof userId !== 'string' || !userId.trim()) throw new CardApplicationError(401, 'INVALID_ACCOUNT');
    const user = await db.user.findUnique({
      where: { id: userId }, select: { id: true, kycStatus: true, blockedAt: true },
    });
    if (!user) throw new CardApplicationError(404, 'USER_NOT_FOUND');
    if (user.blockedAt) throw new CardApplicationError(403, 'ACCOUNT_BLOCKED');
    const [deposits, trades, application] = await Promise.all([
      db.deposit.findMany({
        where: { userId, status: 'CREDITED' }, select: { asset: true, amount: true },
      }),
      db.trade.findMany({
        where: { OR: [
          { takerUserId: userId, makerUserId: { not: userId } },
          { makerUserId: userId, takerUserId: { not: userId } },
        ] },
        select: { pair: true, price: true, quantity: true, takerUserId: true, makerUserId: true },
      }),
      db.cardApplication.findUnique({ where: { userId } }),
    ]);
    return { user, deposits, trades, application };
  }

  private assets(inputs: Awaited<ReturnType<CardApplicationService['inputs']>>): string[] {
    return [...new Set([
      ...inputs.deposits.map((deposit) => deposit.asset.toUpperCase()),
      ...inputs.trades.map((trade) => trade.pair.split('/')[1]?.toUpperCase()).filter(Boolean),
    ])];
  }

  private snapshot(
    inputs: Awaited<ReturnType<CardApplicationService['inputs']>>,
    prices: Map<string, number | null>,
    asOf: string,
  ): CardApplicationSnapshot {
    const value = (amount: BigNumber, asset: string | undefined) => {
      if (!amount.isFinite() || amount.isNegative()) return null;
      if (amount.isZero()) return amount; // zero needs no FX quote
      const price = asset ? prices.get(asset.toUpperCase()) : null;
      if (price == null || !Number.isFinite(price) || price <= 0) return null;
      return amount.times(price);
    };
    let depositUsd = new BigNumber(0);
    let volumeUsd = new BigNumber(0);
    let depositValuationComplete = true;
    let tradingVolumeValuationComplete = true;
    for (const deposit of inputs.deposits) {
      const usd = value(new BigNumber(deposit.amount.toString()), deposit.asset);
      if (usd === null) depositValuationComplete = false;
      else depositUsd = depositUsd.plus(usd);
    }
    for (const trade of inputs.trades) {
      // Defence in depth: count a fill once for a participant, never twice
      // or for an account matching against itself (wash volume).
      if (trade.takerUserId === trade.makerUserId
        || (trade.takerUserId !== inputs.user.id && trade.makerUserId !== inputs.user.id)) continue;
      const quantity = new BigNumber(trade.quantity.toString());
      const price = new BigNumber(trade.price.toString());
      const pair = trade.pair.split('/');
      const usd = pair.length === 2 && quantity.isGreaterThan(0) && price.isGreaterThan(0)
        ? value(quantity.times(price), pair[1]) : null;
      if (usd === null) tradingVolumeValuationComplete = false;
      else volumeUsd = volumeUsd.plus(usd);
    }
    const verificationApproved = inputs.user.kycStatus === 'APPROVED';
    // Compare exact Decimal-derived values BEFORE UI rounding.
    const depositEligible = depositUsd.isGreaterThanOrEqualTo(5000);
    const tradingVolumeEligible = volumeUsd.isGreaterThanOrEqualTo(50000);
    return {
      eligibility: {
        verificationApproved, depositEligible, tradingVolumeEligible,
        eligible: verificationApproved && (depositEligible || tradingVolumeEligible),
        qualifyingDepositUsd: depositUsd.decimalPlaces(2, BigNumber.ROUND_DOWN).toNumber(),
        qualifyingTradingVolumeUsd: volumeUsd.decimalPlaces(2, BigNumber.ROUND_DOWN).toNumber(),
        depositValuationComplete, tradingVolumeValuationComplete,
        valuation: {
          asOf, depositBasis: 'CUMULATIVE_CREDITED_DEPOSITS',
          tradingVolumeBasis: 'ALL_PERSISTED_EXECUTED_TRADES', conversion: 'CURRENT_USD_QUOTES',
        },
      },
      application: inputs.application ? {
        id: inputs.application.id, product: inputs.application.product,
        status: inputs.application.status, submittedAt: inputs.application.submittedAt,
      } : null,
    };
  }

  private async quotes(assets: string[]) {
    try { return await this.prices.pricesFor(assets); }
    catch { return new Map<string, number | null>(); }
  }

  async getSnapshot(userId: string): Promise<CardApplicationSnapshot> {
    const inputs = await this.inputs(this.prisma, userId);
    const quotes = await this.quotes(this.assets(inputs));
    return this.snapshot(inputs, quotes, new Date().toISOString());
  }

  async submit(userId: string, product: CardProduct): Promise<CardApplicationSnapshot> {
    // Obtain external quotes before the DB transaction to avoid holding
    // locks across a network request. Re-read account/ledger/requests inside
    // the transaction. A newly appearing unquoted asset stays non-qualifying.
    const initial = await this.inputs(this.prisma, userId);
    const quotes = await this.quotes(this.assets(initial));
    const asOf = new Date().toISOString();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const snapshot = this.snapshot(await this.inputs(tx, userId), quotes, asOf);
          if (snapshot.application) {
            if (snapshot.application.product !== product) {
              throw new CardApplicationError(409, 'CARD_APPLICATION_ALREADY_EXISTS', snapshot);
            }
            return snapshot; // replay: preserve the original ID/time/evidence
          }
          if (!snapshot.eligibility.eligible) {
            const incomplete = !snapshot.eligibility.depositValuationComplete || !snapshot.eligibility.tradingVolumeValuationComplete;
            throw new CardApplicationError(
              incomplete && snapshot.eligibility.verificationApproved ? 503 : 403,
              incomplete && snapshot.eligibility.verificationApproved ? 'CARD_VALUATION_UNAVAILABLE' : 'CARD_NOT_ELIGIBLE',
              snapshot,
            );
          }
          const application = await tx.cardApplication.create({ data: {
            userId, product, status: 'SUBMITTED',
            eligibilitySnapshot: snapshot.eligibility as unknown as Prisma.InputJsonObject,
          } });
          await tx.auditLog.create({ data: {
            userId, action: 'CARD_APPLICATION_SUBMITTED',
            metadata: { applicationId: application.id, product, eligibility: snapshot.eligibility as unknown as Prisma.InputJsonObject },
          } });
          return { ...snapshot, application: {
            id: application.id, product: application.product,
            status: application.status, submittedAt: application.submittedAt,
          } };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const code = (error as { code?: string }).code;
        // Concurrent submissions either serialize or hit userId's unique
        // constraint. Retry the whole transaction, then return that request.
        if ((code === 'P2034' || code === 'P2002') && attempt < 2) continue;
        throw error;
      }
    }
    throw new CardApplicationError(503, 'CARD_APPLICATION_RETRY_REQUIRED');
  }
}
