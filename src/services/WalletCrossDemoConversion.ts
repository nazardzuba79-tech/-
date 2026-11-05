/**
 * Opt-in, owner/tester-only Cross DEMO re-denomination. No real Balance,
 * FuturesBalance, withdrawal, venue order or new minted inventory.
 *
 * NativeDemoAccount is the source of the Cross USDT already moved from
 * DemoBalance at initialization. It must NEVER be debited by directly editing
 * DemoBalance. Its journal and immutable revision must move atomically with
 * the opposite, inventory-backed DemoBalance legs, so replay cannot resurrect
 * USDT or double count collateral.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { applyNativeWalletConversion, migrateDemoState } from '../private-trading/native/engine';
import { compact, inflate, commandHash, revisionPayload, type NativeAccount } from '../private-trading/native/store';
import { instructionDigest, nextInstructionSeq, type NativeInstruction } from '../private-trading/native/replay';
import { deriveNativeLiveProjection, projectionDigest } from '../private-trading/native/liveProjection';
import { assertNativeTrader } from '../private-trading/native/testAccess';
import type { OwnerSession } from '../private-trading/serviceTypes';
import type { ConversionQuote } from './WalletConversionService';

type Db = PrismaClient | Prisma.TransactionClient;
const ACTIVE_ORDER = new Set(['OPEN', 'PARTIALLY_FILLED']);

/** No public role, client claim or user-chosen id can enable this. */
export function crossDemoConversionEnabled(userId: string, env: NodeJS.ProcessEnv): boolean {
  const owner = env.PRIVATE_TRADING_OWNER_ID?.trim() ?? '';
  return env.WALLET_CROSS_DEMO_CONVERSION_ENABLED === 'true'
    && env.PRIVATE_TRADING_ENABLED === 'true'
    && !!owner
    && (userId === owner || (env.PRIVATE_TRADING_TEST_USER_IDS ?? '').split(',').map(v => v.trim()).filter(Boolean).includes(userId));
}

export function nativeCrossFreeUSDT(account: NativeAccount): string | null {
  const state = migrateDemoState(account.snapshot);
  if (state.positions.some(p => p.status === 'OPEN') || state.orders.some(o => ACTIVE_ORDER.has(o.status))) return null;
  const available = new BigNumber(state.walletBalance);
  return available.isFinite() && available.gte(0) ? available.toFixed() : null;
}

export async function nativeCrossAccount(db: Db, userId: string, env: NodeJS.ProcessEnv): Promise<NativeAccount | null> {
  if (!crossDemoConversionEnabled(userId, env)) return null;
  const row = await db.nativeDemoAccount.findUnique({ where: { userId }, select: { payload: true } });
  return row ? inflate(row.payload as unknown as NativeAccount) : null;
}

/**
 * Called ONLY after the session, quote, book depth, and liquidity-account
 * guards succeeded and after BOTH the per-user and demo-book advisory locks.
 * Caller must also check the aggregate receipt's idempotency and live flag.
 *
 * Flat native accounts only in v1; opening-position margin or a working order
 * makes the conversion unavailable until the account is flat. This prevents
 * exporting cash required by a live position before the model can revalue the
 * newly received non-USDT collateral. Normal Futures commands are unchanged.
 */
export async function settleCrossDemoUSDT(
  tx: Prisma.TransactionClient, actor: OwnerSession, quote: ConversionQuote,
  liquidityAccountId: string, now: number,
): Promise<void> {
  if (quote.ledger !== 'cross' || quote.fromAsset !== 'USDT' || quote.toAsset === 'USDT') throw new Error('CROSS_DEMO_INVALID_PAIR');
  await tx.$queryRaw`SELECT "userId" FROM "NativeDemoAccount" WHERE "userId" = ${actor.userId} FOR UPDATE`;
  await assertNativeTrader(tx, actor);
  const row = await tx.nativeDemoAccount.findUnique({ where: { userId: actor.userId } });
  if (!row) throw new Error('CROSS_DEMO_ACCOUNT_MISSING');
  const account = inflate(row.payload as unknown as NativeAccount);
  const available = nativeCrossFreeUSDT(account);
  if (available === null) throw new Error('CROSS_DEMO_ACTIVE_EXPOSURE');
  const amount = new BigNumber(quote.fromAmount);
  if (!amount.isFinite() || !amount.gt(0) || amount.gt(available)) throw new Error('CROSS_DEMO_INSUFFICIENT_BALANCE');
  if (!Number.isSafeInteger(now) || now < account.snapshot.time) throw new Error('CROSS_DEMO_CLOCK');

  // The liquidator uses only its existing verified DemoBalance inventory.
  const debited = await tx.demoBalance.updateMany({
    where: { userId: liquidityAccountId, asset: quote.toAsset, available: { gte: quote.toAmount } },
    data: { available: { decrement: quote.toAmount } },
  });
  if (debited.count !== 1) throw new Error('CROSS_DEMO_LIQUIDITY_SHORT');
  await tx.demoBalance.upsert({
    where: { userId_asset: { userId: actor.userId, asset: quote.toAsset } },
    create: { userId: actor.userId, asset: quote.toAsset, available: quote.toAmount },
    update: { available: { increment: quote.toAmount } },
  });
  await tx.demoBalance.upsert({
    where: { userId_asset: { userId: liquidityAccountId, asset: quote.fromAsset } },
    create: { userId: liquidityAccountId, asset: quote.fromAsset, available: quote.fromAmount },
    update: { available: { increment: quote.fromAmount } },
  });

  const id = `cross-conversion:${quote.quoteId}`;
  const command: NativeInstruction = {
    id, kind: 'WALLET_CONVERSION', at: now,
    seq: nextInstructionSeq(account.commands), quoteId: quote.quoteId,
    fromAmount: quote.fromAmount, toAsset: quote.toAsset, toAmount: quote.toAmount,
  };
  const snapshot = structuredClone(migrateDemoState(account.snapshot));
  applyNativeWalletConversion(snapshot, id, quote.fromAmount, now);
  const commands = [...account.commands, command];
  const next: NativeAccount = {
    ...account, revision: account.revision + 1, snapshot, commands,
    checkpoint: { time: now, digest: instructionDigest(commands, Infinity),
      commandCount: commands.length, state: structuredClone(snapshot) },
  };
  const projection = deriveNativeLiveProjection(next);
  if (!projection.ledger.reconciled) throw new Error('CROSS_DEMO_LEDGER_MISMATCH');
  const updated = await tx.nativeDemoAccount.updateMany({
    where: { userId: actor.userId, revision: account.revision },
    data: { revision: next.revision, payload: compact(next) as unknown as Prisma.InputJsonValue },
  });
  if (updated.count !== 1) throw new Error('CROSS_DEMO_REVISION_CHANGED');
  await tx.nativeDemoRevision.create({
    data: { userId: actor.userId, revision: next.revision,
      requestKey: id,
      requestHash: commandHash({ kind: 'WALLET_CONVERSION', quoteId: quote.quoteId,
        fromAmount: quote.fromAmount, toAmount: quote.toAmount, toAsset: quote.toAsset }),
      payload: compact(revisionPayload(next)) as unknown as Prisma.InputJsonValue },
  });
  const projectionRow = {
    revision: next.revision,
    payload: projection as unknown as Prisma.InputJsonValue,
    digest: projectionDigest(projection),
  };
  await tx.nativeDemoLiveProjection.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId, ...projectionRow },
    update: projectionRow,
  });
  await assertNativeTrader(tx, actor);
}
