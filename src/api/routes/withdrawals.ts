import { asyncRoute } from '../asyncRoute';
import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { DemoFundsNotWithdrawableError, WithdrawalService, WithdrawalRequestError } from '../../services/WithdrawalService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { isSimulationOnlyUser } from '../../private-trading/access';
import { PrivateTradingError, type OwnerSession } from '../../private-trading/serviceTypes';
import { isTestAssetPairOrSymbol } from '../../services/testMarkets/testAssetConfig';

const requestSchema = z.object({
  asset: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,20}$/),
  network: z.string().trim().min(1).max(32),
  // Checked for shape by the client per network; here only for being one
  // printable token of a sane length, since the admin pays it by hand.
  toAddress: z.string().trim().min(1).max(128).regex(/^\S+$/),
  amount: z.string().trim().regex(/^\d{1,18}(\.\d{1,18})?$/).refine((v) => new BigNumber(v).isGreaterThan(0), 'amount must be > 0'),
});

/**
 * A Cross trading account's own valuation (the same rows the Wallet prints).
 * `null` when the caller has no such account yet — they then withdraw from
 * the spot ledger like everyone else. A Cross account is valued from
 * DemoBalance (or a preview fixture), so a non-null result means nothing is
 * withdrawable at all (Issue #617).
 */
export type TradingWalletReader = (actor: OwnerSession) => Promise<{ asset: string; available: string }[] | null>;

export interface WithdrawalsRouterOptions {
  tradingWallet?: TradingWalletReader;
}

const TRADING_UNAVAILABLE = 'Trading account balance is temporarily unavailable';

export function withdrawalsRouter(prisma: PrismaClient, options: WithdrawalsRouterOptions = {}): Router {
  const router = Router();
  const service = new WithdrawalService(prisma);

  /**
   * The caller's Cross trading account rows, or `null` for an account that
   * withdraws from spot. Only the owner and the configured test accounts
   * have one; everyone else never reaches the reader.
   */
  async function tradingRows(req: AuthedRequest) {
    if (!options.tradingWallet || !isSimulationOnlyUser(req.userId)) return null;
    // requireAuth has verified this bearer token; decode only its expiry.
    const claims = jwt.decode(req.headers.authorization!.slice(7)) as jwt.JwtPayload | null;
    const actor: OwnerSession = {
      userId: req.userId!,
      sessionId: req.sessionId ?? '',
      expiresAt: typeof claims?.exp === 'number' ? claims.exp * 1000 : 0,
    };
    return options.tradingWallet(actor);
  }

  function tradingFailure(res: import('express').Response, err: unknown) {
    if (err instanceof PrivateTradingError && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error('[withdrawals] trading wallet read failed', err);
    return res.status(503).json({ error: TRADING_UNAVAILABLE });
  }

  // The account's own withdrawal-request history, scoped to the caller —
  // same pattern as GET /deposits/me.
  router.get('/withdrawals/me', requireAuth(prisma), asyncRoute(async (req: AuthedRequest, res) => {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(
      withdrawals.map((w) => ({
        id: w.id,
        asset: w.asset,
        network: w.network,
        toAddress: w.toAddress,
        amount: w.amount.toString(),
        status: w.status,
        rejectionReason: w.rejectionReason,
        createdAt: w.createdAt,
      }))
    );
  }));

  /**
   * What the caller can withdraw, per asset, as the server will check it.
   *
   * TRADING: a Cross trading account — nothing, ever: its rows are valued
   * from demo funds, whatever the demo switches (Issue #617). SPOT: the spot ledger's
   * `available`; `futures` then lists what sits on the futures ledger and
   * would have to be transferred first. Assets with nothing withdrawable are
   * left out; test-market assets never appear.
   */
  router.get('/withdrawals/options', requireAuth(prisma), asyncRoute(async (req: AuthedRequest, res) => {
    let rows: { asset: string; available: string }[] | null;
    try {
      rows = await tradingRows(req);
    } catch (err) {
      return tradingFailure(res, err);
    }
    const positive = (list: { asset: string; available: string }[]) =>
      list.filter((b) => !isTestAssetPairOrSymbol(b.asset) && new BigNumber(b.available).isGreaterThan(0));

    if (rows) return res.json({
      source: 'TRADING', assets: [], futures: [],
      // Review-only amounts from the account's own displayed holdings.
      // Never interpret these as withdrawable funds or offer an ordinary payout.
      reviewAssets: positive(rows),
    });

    const [spot, futures] = await Promise.all([
      prisma.balance.findMany({ where: { userId: req.userId } }),
      prisma.futuresBalance.findMany({ where: { userId: req.userId } }),
    ]);
    res.json({
      source: 'SPOT',
      assets: positive(spot.map((b) => ({ asset: b.asset, available: b.available.toString() }))),
      futures: positive(futures.map((b) => ({ asset: b.asset, available: b.available.toString() }))),
    });
  }));

  /**
   * An informational request from a Cross trading account. It is deliberately NOT
   * a Withdrawal, never locks Balance, and has no approve/mark-sent API.
   * It lets the owner see the account email and requested amount in a separate
   * admin queue without weakening the permanent #617 no-cash-out fence.
   */
  router.post('/withdrawals/review-request', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const parsed = requestSchema.strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid review request' });
    const fields = parsed.data;
    if (isTestAssetPairOrSymbol(fields.asset)) return res.status(400).json({ error: 'Unsupported asset' });

    let rows: { asset: string; available: string }[] | null;
    try { rows = await tradingRows(req); }
    catch (err) { return tradingFailure(res, err); }
    if (!rows) return res.status(403).json({ error: 'Review request is not available for this account' });

    const holding = rows.find(r => r.asset === fields.asset);
    if (!holding || !new BigNumber(holding.available).isFinite()
      || new BigNumber(fields.amount).isGreaterThan(holding.available))
      return res.status(400).json({ error: 'Requested amount exceeds the account balance' });

    try {
      const log = await prisma.$transaction(async tx => {
        // One durable user lock serializes clicks and multi-instance requests.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.userId!} FOR UPDATE`;
        const recent = await tx.auditLog.findFirst({
          where: {
            userId: req.userId!, action: 'WITHDRAWAL_REVIEW_REQUESTED',
            createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
          },
          orderBy: { createdAt: 'desc' },
        });
        // Identical HTTP retries return the existing record; different requests
        // are rate-limited, not falsely acknowledged as if newly submitted.
        if (recent) {
          const prior = recent.metadata && typeof recent.metadata === 'object' && !Array.isArray(recent.metadata)
            ? recent.metadata as Record<string, unknown> : {};
          if (prior.asset === fields.asset && prior.network === fields.network
            && prior.toAddress === fields.toAddress && prior.amount === fields.amount)
            return { id: recent.id, createdAt: recent.createdAt, duplicate: true };
          return null;
        }
        const created = await tx.auditLog.create({
          data: {
            userId: req.userId!, action: 'WITHDRAWAL_REVIEW_REQUESTED',
            metadata: {
              asset: fields.asset, amount: fields.amount, network: fields.network,
              toAddress: fields.toAddress, reviewOnly: true, payable: false,
            },
          },
        });
        return { id: created.id, createdAt: created.createdAt, duplicate: false };
      });
      res.set('Cache-Control', 'no-store');
      if (log === null) return res.status(429).json({ error: 'A review request already exists. Try again later.' });
      return res.status(log.duplicate ? 200 : 201).json({
        ...log, status: 'REVIEW_ONLY', balanceHeld: false, payable: false,
      });
    } catch (err) {
      console.error('[withdrawals] review request unavailable');
      return res.status(503).json({ error: 'Could not record review request' });
    }
  });

  router.post('/withdrawals', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let rows: { asset: string; available: string }[] | null;
    try {
      rows = await tradingRows(req);
    } catch (err) {
      return tradingFailure(res, err);
    }

    // A Cross trading account is demo-valued: it files no request, whatever the demo switches; nothing is written.
    if (rows) {
      const refused = new DemoFundsNotWithdrawableError();
      return res.status(403).json({ error: refused.message, code: refused.code });
    }

    try {
      const result = await service.requestWithdrawal({ userId: req.userId!, ...parsed.data });
      res.json(result);
    } catch (err) {
      if (err instanceof WithdrawalRequestError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to submit withdrawal request' });
    }
  });

  return router;
}
