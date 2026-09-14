import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { createHash, randomUUID } from 'crypto';
import { assertOwner, privateTradingConfig, PrivateTradingConfig } from './access';
import { AccountState, emptyState, OwnerSession, PrivateTradingError } from './serviceTypes';

export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const money = (value: BigNumber.Value): string => new BigNumber(value).toFixed(18, BigNumber.ROUND_HALF_EVEN);
export const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item)).digest('hex');
export interface AccountTx {
  db: Prisma.TransactionClient; state: AccountState;
  available: BigNumber; reserved: BigNumber; principal: BigNumber; realized: BigNumber;
  entry: (kind: string, amount: string, suffix: string, effectiveAt?: number, scenarioId?: string, metadata?: unknown) => Promise<void>;
}

/** A row lock serializes all owner finances, including repeat commands and background fills. */
export class PrivateTradingStore {
  constructor(readonly db: PrismaClient, readonly config: () => PrivateTradingConfig = privateTradingConfig) {}
  async authorized(actor: OwnerSession) { await assertOwner(this.db, actor, this.config); }
  async read(actor: OwnerSession) {
    await this.authorized(actor);
    const row = await this.db.privateTradingAccount.findUnique({ where: { userId: actor.userId } });
    return row ? { ...row, state: row.state as unknown as AccountState } : {
      userId: actor.userId, available: new Prisma.Decimal(0), reserved: new Prisma.Decimal(0),
      principal: new Prisma.Decimal(0), realized: new Prisma.Decimal(0), state: emptyState(), updatedAt: new Date(),
    };
  }
  async transact<T>(actor: OwnerSession, key: string | null, input: unknown, run: (tx: AccountTx) => Promise<T>, finalCheck?: () => void): Promise<T> {
    await this.authorized(actor);
    return this.db.$transaction(async db => {
      await db.privateTradingAccount.upsert({ where: { userId: actor.userId }, create: { userId: actor.userId, state: json(emptyState()) }, update: {} });
      await db.$queryRaw`SELECT "userId" FROM "PrivateTradingAccount" WHERE "userId" = ${actor.userId} FOR UPDATE`;
      await assertOwner(db, actor, this.config);
      if (key) {
        const prior = await db.privateTradingCommand.findUnique({ where: { userId_key: { userId: actor.userId, key } } });
        if (prior) {
          if (prior.requestHash !== hash(input)) throw new PrivateTradingError('idempotency_conflict', 'Повторный запрос содержит другие параметры', 409);
          return prior.response as T;
        }
      }
      const row = await db.privateTradingAccount.findUniqueOrThrow({ where: { userId: actor.userId } });
      const commandId = key ?? randomUUID();
      const tx: AccountTx = {
        db, state: row.state as unknown as AccountState,
        available: new BigNumber(row.available.toString()), reserved: new BigNumber(row.reserved.toString()),
        principal: new BigNumber(row.principal.toString()), realized: new BigNumber(row.realized.toString()),
        entry: async (kind, amount, suffix, effectiveAt = Date.now(), scenarioId, metadata = {}) => {
          await db.privateTradingLedger.create({ data: {
            userId: actor.userId, eventId: `${commandId}:${suffix}`, kind, amount: money(amount),
            scenarioId: scenarioId ?? null, effectiveAt: new Date(effectiveAt), metadata: json(metadata),
          } });
        },
      };
      const result = await run(tx);
      for (const value of [tx.available, tx.reserved, tx.principal]) {
        if (!value.isFinite() || value.lt(0)) throw new PrivateTradingError('account_invariant', 'Недостаточно демо-средств', 409);
      }
      await assertOwner(db, actor, this.config);
      finalCheck?.();
      await db.privateTradingAccount.update({ where: { userId: actor.userId }, data: {
        available: money(tx.available), reserved: money(tx.reserved), principal: money(tx.principal),
        realized: money(tx.realized), state: json(tx.state),
      } });
      if (key) await db.privateTradingCommand.create({ data: { userId: actor.userId, key, requestHash: hash(input), response: json(result) } });
      // A slow persistence query must not turn a fresh check into a stale fill.
      // Throwing here still rolls back every write in this transaction.
      await assertOwner(db, actor, this.config);
      finalCheck?.();
      return result;
    }, { maxWait: 5_000, timeout: 12_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async allocate(actor: OwnerSession, amount: string, key: string) {
    const value = new BigNumber(amount);
    if (!value.isFinite() || !value.gt(0) || value.decimalPlaces()! > 18 || value.gte('1000000000000000000')) throw new PrivateTradingError('invalid_amount', 'Укажите положительную сумму с точностью до 18 знаков');
    return this.transact(actor, `allocate:${key}`, { amount }, async tx => {
      // Compare-and-decrement is atomic even with the independent legacy demo service.
      const taken = await tx.db.demoBalance.updateMany({ where: { userId: actor.userId, asset: 'USDT', available: { gte: money(value) } }, data: { available: { decrement: money(value) } } });
      if (taken.count !== 1) throw new PrivateTradingError('insufficient_demo_balance', 'Недостаточно средств на демо-депозите', 409);
      tx.available = tx.available.plus(value); tx.principal = tx.principal.plus(value); tx.state.session = actor;
      await tx.entry('CAPITAL_ALLOCATED', amount, 'allocation', undefined, undefined, { source: 'DemoBalance:USDT' });
      return { available: money(tx.available), allocatedCapital: money(tx.principal) };
    });
  }
}
