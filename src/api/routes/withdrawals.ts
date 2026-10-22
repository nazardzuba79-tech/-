import { asyncRoute } from '../asyncRoute';
import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { WithdrawalService, WithdrawalRequestError } from '../../services/WithdrawalService';
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
 * What a Cross trading account can withdraw, from that account's own
 * valuation (the same rows the Wallet prints). `null` when the caller has no
 * such account yet — they then withdraw from the spot ledger like everyone
 * else.
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
   * TRADING: a Cross trading account — its rows' `available`, less what its
   * earlier unheld requests already claim. SPOT: the spot ledger's
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

    if (rows) {
      const assets = await Promise.all(rows.map(async (row) => {
        const claimed = await service.unheldClaimed(prisma, req.userId!, row.asset);
        const available = BigNumber.max(new BigNumber(row.available).minus(claimed), 0);
        return { asset: row.asset, available: available.isFinite() ? available.toFixed() : '0' };
      }));
      return res.json({ source: 'TRADING', assets: positive(assets), futures: [] });
    }

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

  router.post('/withdrawals', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let rows: { asset: string; available: string }[] | null;
    try {
      rows = await tradingRows(req);
    } catch (err) {
      return tradingFailure(res, err);
    }

    try {
      const result = rows
        ? await service.requestUnheldWithdrawal({
          userId: req.userId!,
          ...parsed.data,
          available: rows.find((row) => row.asset === parsed.data.asset)?.available ?? '0',
        })
        : await service.requestWithdrawal({ userId: req.userId!, ...parsed.data });
      res.json(result);
    } catch (err) {
      if (err instanceof WithdrawalRequestError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to submit withdrawal request' });
    }
  });

  return router;
}
