import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';

export class PurchaseError extends Error {}

/**
 * Handles "paying" for a product with a user's internal balance.
 *
 * Important distinction from the trading side of this app: this does NOT
 * move any real crypto. The real crypto already arrived at your MetaMask
 * when the user deposited (see DepositService) — what happens here is
 * purely an internal ledger entry: their available balance goes down,
 * a Purchase row records what they bought and for how much.
 *
 * You (the seller) then deliver the actual product/service manually and
 * mark the purchase FULFILLED — this system tracks who's owed what, it
 * doesn't automate delivery of arbitrary products/services.
 */
export class PurchaseService {
  constructor(private prisma: PrismaClient) {}

  async purchaseProduct(userId: string, productId: string) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product || !product.active) {
        throw new PurchaseError('Product not found or no longer available');
      }

      const price = new BigNumber(product.priceAmount.toString());
      const balance = await tx.balance.findUnique({
        where: { userId_asset: { userId, asset: product.priceAsset } },
      });
      const available = new BigNumber(balance?.available.toString() ?? '0');

      if (available.isLessThan(price)) {
        throw new PurchaseError(`Insufficient ${product.priceAsset} balance`);
      }

      await tx.balance.update({
        where: { userId_asset: { userId, asset: product.priceAsset } },
        data: { available: available.minus(price).toString() },
      });

      const purchase = await tx.purchase.create({
        data: {
          userId,
          productId,
          amount: price.toString(),
          asset: product.priceAsset,
          status: 'PENDING_FULFILLMENT',
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'PRODUCT_PURCHASED',
          metadata: { productId, productName: product.name, amount: price.toString(), asset: product.priceAsset },
        },
      });

      return purchase;
    });
  }
}
