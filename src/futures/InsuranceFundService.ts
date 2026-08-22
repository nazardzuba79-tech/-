import { Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';

type TxClient = Prisma.TransactionClient;

/**
 * The insurance fund is what stands between "a liquidation went badly"
 * and "other traders' profits get auto-deleveraged to cover it" — the
 * mechanism every real derivatives exchange uses. It only ever moves
 * inside a liquidation's own DB transaction, and every movement is
 * ledgered (see InsuranceFundLedger) so the balance can always be
 * reconstructed from history, not just trusted as a mutable number.
 */
export class InsuranceFundService {
  /** Records a contribution (liquidation surplus) or payout (shortfall
   * coverage) against the fund for `asset`, creating the fund row on
   * first use. `amount` is signed: positive = contribution, negative =
   * payout. */
  async record(
    tx: TxClient,
    asset: string,
    amount: BigNumber,
    reason: 'LIQUIDATION_SURPLUS' | 'LIQUIDATION_SHORTFALL',
    positionId: string
  ) {
    const fund = await tx.insuranceFund.upsert({
      where: { asset },
      create: { asset, balance: '0' },
      update: {},
    });
    const nextBalance = new BigNumber(fund.balance.toString()).plus(amount);
    await tx.insuranceFund.update({
      where: { asset },
      data: { balance: nextBalance.toString() },
    });
    await tx.insuranceFundLedger.create({
      data: { asset, amount: amount.toString(), reason, positionId },
    });
    return nextBalance;
  }

  async getBalance(tx: TxClient, asset: string): Promise<BigNumber> {
    const fund = await tx.insuranceFund.findUnique({ where: { asset } });
    return fund ? new BigNumber(fund.balance.toString()) : new BigNumber(0);
  }
}
