import { createHash } from 'crypto';
import { Prisma, PrismaClient, OtcCashRequest } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { isSimulationOnlyUser } from '../private-trading/access';
import { mutateSpotBalance } from '../services/WalletMutation';
import { valueInUsd, PriceSourceWithMeta } from '../services/deposits/depositPolicy';
import { DEPOSIT_PRICE_MAX_AGE_MS } from '../config/limits';
import { confirmedTransaction } from './confirmedTransaction';
import { ACTIVE_OTC_STATUSES, CreateOtc, decimal, OtcAction, OtcError, OtcPolicy, OTC_ASSETS, OTC_POLICY, OTC_TIERS } from './policy';
import { cityFor } from './geography';
import { assertReserveCoverage } from './reserveCoverage';

type Tx = Prisma.TransactionClient;
export type OtcActor = { userId: string; sessionId?: string };
const hash = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const summary = (r: OtcCashRequest) => ({ id: r.id, number: `OTC-${r.number}`, country: r.country, cityId: r.cityId,
  asset: r.asset, quantity: r.quantity.toString(), fiat: r.fiat, tier: r.tier, status: r.status, version: r.version,
  offerVersion: r.offerVersion, acceptedOfferVersion: r.acceptedOfferVersion, acceptedAt: r.acceptedAt,
  cancelRequested: r.cancelRequested, pickupRevision: r.pickupRevision, completedAt: r.completedAt, createdAt: r.createdAt });

export class OtcCashService {
  constructor(private db: PrismaClient, private prices: PriceSourceWithMeta, readonly policy: OtcPolicy = OTC_POLICY) {}

  private async actor(tx: Tx, actor: OtcActor, admin = false) {
    if (!actor.sessionId) throw new OtcError('SESSION_REQUIRED', 401);
    // Same lock order as deletion: User before financial obligations. Session
    // revocation/role/block changes cannot race the financial commit silently.
    const [user] = await tx.$queryRaw<{ id: string; role: string; kycStatus: string; blockedAt: Date | null }[]>`
      SELECT id,role,"kycStatus","blockedAt" FROM "User" WHERE id=${actor.userId} FOR SHARE`;
    const [session] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Session" WHERE id=${actor.sessionId} AND "userId"=${actor.userId} AND "revokedAt" IS NULL FOR SHARE`;
    if (!user || !session) throw new OtcError('SESSION_REQUIRED', 401);
    if (user.blockedAt || (admin && user.role !== 'ADMIN')) throw new OtcError('ACCESS_DENIED', 403);
    return user;
  }

  private async owned(tx: Tx, actor: OtcActor, id: string, admin = false, lock = false) {
    await this.actor(tx, actor, admin);
    // An operator acts for a different user: hold that user's eligibility
    // stable too, before locking the request (same order as account deletion).
    if (admin && lock) await tx.$queryRaw`
      SELECT u.id FROM "User" u JOIN "OtcCashRequest" r ON r."userId"=u.id
      WHERE r.id=${id} FOR SHARE OF u`;
    if (lock) await tx.$queryRaw`SELECT id FROM "OtcCashRequest" WHERE id=${id} FOR UPDATE`;
    const row = await tx.otcCashRequest.findUnique({ where: { id } });
    if (!row || (!admin && row.userId !== actor.userId)) throw new OtcError('NOT_FOUND', 404);
    return row;
  }

  private async ledger(tx: Tx, row: OtcCashRequest, kind: 'RESERVE' | 'RELEASE' | 'CONSUME', actorId: string) {
    const balance = await tx.balance.findUniqueOrThrow({ where: { userId_asset: { userId: row.userId, asset: row.asset } } });
    await tx.otcCashLedger.create({ data: { requestId: row.id, kind, asset: row.asset, quantity: row.quantity,
      availableAfter: balance.available, lockedAfter: balance.locked } });
    await tx.auditLog.create({ data: { userId: row.userId, action: `OTC_${kind}`, metadata: {
      requestId: row.id, actorId, asset: row.asset, quantity: row.quantity.toString(),
    } } });
  }

  async create(actor: OtcActor, input: CreateOtc) {
    const quantity = decimal(input.quantity, OTC_ASSETS[input.asset]);
    if (!cityFor(input.country, input.cityId)) throw new OtcError('INVALID_CITY', 400);
    const fingerprint = hash([input.country, input.cityId, input.asset, quantity.toFixed(), input.fiat, input.tier]);
    // A replay does not depend on a new quote. All access and payload checks are
    // repeated in the transaction below; this lookup never returns private data.
    const previous = await this.db.otcCashRequest.findUnique({ where: { userId_idempotencyKey: { userId: actor.userId, idempotencyKey: input.idempotencyKey } }, select: { id: true } });
    const valuation = previous ? null : await valueInUsd(input.asset, quantity, this.prices);
    return confirmedTransaction(this.db, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`otc-create:${actor.userId}`},0))::text`;
      const user = await this.actor(tx, actor);
      const existing = await tx.otcCashRequest.findUnique({ where: { userId_idempotencyKey: { userId: actor.userId, idempotencyKey: input.idempotencyKey } } });
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new OtcError('IDEMPOTENCY_MISMATCH');
        return summary(existing);
      }
      const route = this.policy.routes.find(r => r.country === input.country && r.cityId === input.cityId && r.asset === input.asset && r.fiat === input.fiat);
      if (!this.policy.enabled || !route) throw new OtcError('DIRECTION_NOT_APPROVED', 403);
      if (user.role !== 'USER' || user.kycStatus !== 'APPROVED' || isSimulationOnlyUser(actor.userId)
        || !this.policy.approvedUserIds.includes(actor.userId)) throw new OtcError('CUSTOMER_REVIEW_REQUIRED', 403);
      if (!valuation?.usd || !valuation.usd.isFinite() || (valuation.pricedAt && Date.now() - valuation.pricedAt.getTime() > DEPOSIT_PRICE_MAX_AGE_MS))
        throw new OtcError('PRICE_UNAVAILABLE', 503);
      if (valuation.usd.lt(OTC_TIERS[input.tier])) throw new OtcError('BELOW_OTC_MINIMUM', 400);
      if (await tx.otcCashRequest.count({ where: { userId: actor.userId, status: { in: ACTIVE_OTC_STATUSES } } }) >= this.policy.maxActive)
        throw new OtcError('ACTIVE_REQUEST_LIMIT', 409);
      await assertReserveCoverage(tx, actor.userId, input.asset);
      await mutateSpotBalance(tx, actor.userId, input.asset, { available: quantity.negated(), locked: quantity });
      const row = await tx.otcCashRequest.create({ data: { userId: actor.userId, ...input, quantity: quantity.toFixed(), fingerprint,
        policyVersion: this.policy.version, reservation: { create: { asset: input.asset, quantity: quantity.toFixed() } } } });
      await this.ledger(tx, row, 'RESERVE', actor.userId);
      if (valuation.pricedAt && Date.now() - valuation.pricedAt.getTime() > DEPOSIT_PRICE_MAX_AGE_MS)
        throw new OtcError('PRICE_UNAVAILABLE', 503);
      return summary(row);
    });
  }

  async byKey(actor: OtcActor, key: string) {
    return this.db.$transaction(async tx => {
      await this.actor(tx, actor);
      const row = await tx.otcCashRequest.findUnique({ where: { userId_idempotencyKey: { userId: actor.userId, idempotencyKey: key } } });
      return row ? summary(row) : null;
    });
  }

  async list(actor: OtcActor, admin = false, page = 0, status?: string) {
    return this.db.$transaction(async tx => {
      await this.actor(tx, actor, admin);
      const rows = await tx.otcCashRequest.findMany({ where: { ...(!admin ? { userId: actor.userId } : {}), ...(status ? { status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: page * 25, take: 26,
        include: { user: { select: { id: true, email: true } }, reservation: { select: { status: true, quantity: true } } } });
      return { rows: rows.slice(0,25).map(r => ({ ...summary(r), reserveStatus: r.reservation?.status,
        reservedQuantity: r.reservation?.status === 'HELD' ? r.reservation.quantity.toString() : '0', ...(admin ? { user: r.user } : {}) })), hasMore: rows.length > 25 };
    });
  }

  async detail(actor: OtcActor, id: string, admin = false) {
    return this.db.$transaction(async tx => {
      const row = await this.owned(tx, actor, id, admin);
      const offers = await tx.otcCashOffer.findMany({ where: { requestId: id }, orderBy: { version: 'desc' }, take: 20 });
      const reservation = await tx.otcCashReservation.findUniqueOrThrow({ where: { requestId: id } });
      return { ...summary(row), reservation: { asset: reservation.asset, quantity: reservation.quantity.toString(), status: reservation.status },
        completion: row.status === 'COMPLETED' ? { reference: row.payoutReference, completedAt: row.completedAt } : null,
        offers: offers.map(o => ({ version: o.version, asset: o.asset, quantity: o.quantity.toString(), fiat: o.fiat,
          rate: o.rate.toString(), gross: o.gross.toString(), fee: o.fee.toString(), net: o.net.toString(),
          cashPrecision: o.cashPrecision, expiresAt: o.expiresAt, acceptedAt: o.acceptedAt, createdAt: o.createdAt })),
        ...(admin ? { user: await tx.user.findUnique({ where: { id: row.userId }, select: { id: true, email: true } }) } : {}),
      };
    });
  }

  async balances(actor: OtcActor) {
    return this.db.$transaction(async tx => {
      const user = await this.actor(tx, actor);
      const eligible = user.role === 'USER' && user.kycStatus === 'APPROVED' && !isSimulationOnlyUser(actor.userId)
        && this.policy.approvedUserIds.includes(actor.userId);
      const rows = eligible ? await tx.balance.findMany({ where: { userId: actor.userId, asset: { in: Object.keys(OTC_ASSETS) } },
        select: { asset: true, available: true } }) : [];
      return { eligible, balances: rows.map(b => ({ asset: b.asset, available: b.available.toString() })) };
    });
  }

  async act(actor: OtcActor, id: string, input: OtcAction, admin = false) {
    const fingerprint = hash([actor.userId, input]);
    return confirmedTransaction(this.db, async tx => {
      const row = await this.owned(tx, actor, id, admin, true);
      const old = await tx.otcCashCommand.findUnique({ where: { requestId_idempotencyKey: { requestId: id, idempotencyKey: input.idempotencyKey } } });
      if (old) {
        if (old.fingerprint !== fingerprint || old.actorId !== actor.userId) throw new OtcError('IDEMPOTENCY_MISMATCH');
        return old.result;
      }
      if (row.version !== input.version) throw new OtcError('VERSION_CHANGED');
      const requireState = (...states: string[]) => { if (!states.includes(row.status)) throw new OtcError('INVALID_STATE'); };
      const requireAdmin = () => { if (!admin) throw new OtcError('ADMIN_REQUIRED', 403); };
      const requireOwner = () => { if (admin || row.userId !== actor.userId) throw new OtcError('OWNER_REQUIRED', 403); };
      if (['offer','accept','begin-payout'].includes(input.action)) {
        const customer = await tx.user.findUnique({ where: { id: row.userId }, select: { role: true, kycStatus: true, blockedAt: true } });
        if (!customer || customer.role !== 'USER' || customer.kycStatus !== 'APPROVED' || customer.blockedAt
          || isSimulationOnlyUser(row.userId) || !this.policy.approvedUserIds.includes(row.userId)) throw new OtcError('CUSTOMER_REVIEW_REQUIRED',403);
      }
      const data: Prisma.OtcCashRequestUpdateInput = { version: { increment: 1 } };
      let settle: 'RELEASE' | 'CONSUME' | undefined;
      if (input.action === 'offer') {
        requireAdmin(); requireState('RESERVED','OFFERED','ACCEPTED');
        if (row.offerVersion >= 20) throw new OtcError('OFFER_VERSION_LIMIT');
        const route = this.policy.routes.find(r => r.country === row.country && r.cityId === row.cityId && r.asset === row.asset && r.fiat === row.fiat);
        if (!route) throw new OtcError('DIRECTION_NOT_APPROVED',403);
        const rate = decimal(input.rate, 18), fee = decimal(input.fee, route.cashPrecision, true);
        const gross = new BigNumber(row.quantity.toString()).times(rate).decimalPlaces(route.cashPrecision, BigNumber.ROUND_DOWN);
        const net = gross.minus(fee);
        decimal(gross.toFixed(), route.cashPrecision); decimal(net.toFixed(), route.cashPrecision);
        const expiresAt = new Date(input.expiresAt);
        if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new OtcError('OFFER_EXPIRED');
        await tx.otcCashOffer.create({ data: { requestId: id, version: row.offerVersion + 1, asset: row.asset, quantity: row.quantity,
          fiat: row.fiat, rate: rate.toFixed(), gross: gross.toFixed(), fee: fee.toFixed(), net: net.toFixed(),
          cashPrecision: route.cashPrecision, expiresAt, createdBy: actor.userId } });
        Object.assign(data, { status: 'OFFERED', offerVersion: row.offerVersion + 1, acceptedOfferVersion: null, acceptedAt: null });
      } else if (input.action === 'accept') {
        requireOwner(); requireState('OFFERED');
        if (input.offerVersion !== row.offerVersion) throw new OtcError('OFFER_CHANGED');
        const offer = await tx.otcCashOffer.findUniqueOrThrow({ where: { requestId_version: { requestId: id, version: input.offerVersion } } });
        if (offer.expiresAt.getTime() <= Date.now()) throw new OtcError('OFFER_EXPIRED');
        const acceptedAt = new Date();
        await tx.otcCashOffer.update({ where: { id: offer.id }, data: { acceptedAt } });
        Object.assign(data, { status: 'ACCEPTED', acceptedOfferVersion: offer.version, acceptedAt });
      } else if (input.action === 'pickup') {
        requireAdmin(); requireState('ACCEPTED', 'PICKUP_READY');
        if (row.cancelRequested) throw new OtcError('CANCELLATION_PENDING');
        const city = cityFor(row.country, row.cityId);
        if (!city || input.timezone !== city.timezone || new Date(input.appointment).getTime() <= Date.now()) throw new OtcError('INVALID_APPOINTMENT',400);
        const local = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: city.timezone }).format(new Date(input.appointment));
        const text = `${row.pickupRevision ? 'Адрес/время выдачи изменены. Используйте новое сообщение.' : 'Выдача подготовлена.'}\nАдрес: ${input.address}\nВремя: ${local} (${city.timezone})`;
        await tx.otcCashMessage.create({ data: { requestId: id, authorId: actor.userId, sender: 'ADMIN', kind: 'PICKUP', text,
          idempotencyKey: input.idempotencyKey, fingerprint: hash(text) } });
        Object.assign(data, { status: 'PICKUP_READY', pickupRevision: row.pickupRevision + 1 });
      } else if (input.action === 'begin-payout') {
        requireAdmin(); requireState('PICKUP_READY');
        if (row.cancelRequested || row.acceptedOfferVersion !== row.offerVersion) throw new OtcError('PAYOUT_BLOCKED');
        data.status = 'PAYOUT_IN_PROGRESS';
      } else if (input.action === 'complete') {
        requireAdmin(); requireState('PAYOUT_IN_PROGRESS');
        Object.assign(data, { status: 'COMPLETED', completedAt: new Date(), completedBy: actor.userId, payoutReference: input.reference });
        settle = 'CONSUME';
      } else if (input.action === 'cancel') {
        requireOwner(); requireState('RESERVED','OFFERED','ACCEPTED','PICKUP_READY');
        if (row.status === 'PICKUP_READY') data.cancelRequested = true;
        else { data.status = 'CANCELLED'; settle = 'RELEASE'; }
      } else if (input.action === 'reject') {
        requireAdmin(); requireState('RESERVED','OFFERED','ACCEPTED');
        data.status = 'REJECTED'; settle = 'RELEASE';
      } else if (input.action === 'confirm-cancel') {
        requireAdmin(); requireState('PICKUP_READY');
        if (!row.cancelRequested || input.cashDeskConfirmed !== true) throw new OtcError('CANCELLATION_NOT_CONFIRMED');
        data.status = 'CANCELLED'; settle = 'RELEASE';
      } else throw new OtcError('INVALID_ACTION', 400);
      if (settle) {
        const claimed = await tx.otcCashReservation.updateMany({ where: { requestId: id, status: 'HELD', asset: row.asset, quantity: row.quantity },
          data: { status: settle === 'RELEASE' ? 'RELEASED' : 'CONSUMED', settledAt: new Date() } });
        if (claimed.count !== 1) throw new OtcError('RESERVE_RECONCILIATION_REQUIRED');
        const q = new BigNumber(row.quantity.toString());
        await mutateSpotBalance(tx, row.userId, row.asset, { available: settle === 'RELEASE' ? q : new BigNumber(0), locked: q.negated() });
        await this.ledger(tx, row, settle, actor.userId);
      }
      const updated = await tx.otcCashRequest.update({ where: { id }, data });
      await tx.auditLog.create({ data: { userId: row.userId, action: 'OTC_STATE_CHANGED', metadata: {
        requestId: id, actorId: actor.userId, action: input.action, from: row.status, to: updated.status, version: updated.version,
      } } });
      const result = { id, status: updated.status, version: updated.version };
      await tx.otcCashCommand.create({ data: { requestId: id, idempotencyKey: input.idempotencyKey, actorId: actor.userId, fingerprint, result } });
      return result;
    });
  }

  async messages(actor: OtcActor, id: string, admin = false, page = 0) {
    return this.db.$transaction(async tx => {
      await this.owned(tx, actor, id, admin);
      const messages = await tx.otcCashMessage.findMany({ where: { requestId: id }, orderBy: [{ createdAt: 'desc' },{ id: 'desc' }], skip: page * 25, take: 26,
        select: { id: true, sender: true, kind: true, text: true, createdAt: true } });
      return { rows: messages.slice(0,25).reverse(), hasMore: messages.length > 25 };
    });
  }

  async command(actor: OtcActor, id: string, key: string, admin = false) {
    return this.db.$transaction(async tx => {
      await this.owned(tx, actor, id, admin);
      const command = await tx.otcCashCommand.findUnique({ where: { requestId_idempotencyKey: { requestId: id, idempotencyKey: key } } });
      return command?.actorId === actor.userId ? command.result : null;
    });
  }

  async message(actor: OtcActor, id: string, text: string, key: string, admin = false) {
    if (!text.trim() || text.length > 3000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new OtcError('INVALID_MESSAGE',400);
    const fingerprint = hash(text);
    return confirmedTransaction(this.db, async tx => {
      await this.owned(tx, actor, id, admin, true);
      const old = await tx.otcCashMessage.findUnique({ where: { requestId_authorId_idempotencyKey: { requestId: id, authorId: actor.userId, idempotencyKey: key } } });
      if (old) {
        if (old.fingerprint !== fingerprint) throw new OtcError('IDEMPOTENCY_MISMATCH');
        return { id: old.id, createdAt: old.createdAt };
      }
      const row = await tx.otcCashMessage.create({ data: { requestId: id, authorId: actor.userId, sender: admin ? 'ADMIN' : 'USER', text, idempotencyKey: key, fingerprint } });
      return { id: row.id, createdAt: row.createdAt };
    });
  }
}
