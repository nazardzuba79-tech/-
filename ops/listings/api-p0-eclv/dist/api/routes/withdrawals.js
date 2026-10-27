"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withdrawalsRouter = withdrawalsRouter;
const asyncRoute_1 = require("../asyncRoute");
const express_1 = require("express");
const zod_1 = require("zod");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bignumber_js_1 = __importDefault(require("bignumber.js"));
const WithdrawalService_1 = require("../../services/WithdrawalService");
const auth_1 = require("../middleware/auth");
const access_1 = require("../../private-trading/access");
const serviceTypes_1 = require("../../private-trading/serviceTypes");
const testAssetConfig_1 = require("../../services/testMarkets/testAssetConfig");
const requestSchema = zod_1.z.object({
    asset: zod_1.z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,20}$/),
    network: zod_1.z.string().trim().min(1).max(32),
    // Checked for shape by the client per network; here only for being one
    // printable token of a sane length, since the admin pays it by hand.
    toAddress: zod_1.z.string().trim().min(1).max(128).regex(/^\S+$/),
    amount: zod_1.z.string().trim().regex(/^\d{1,18}(\.\d{1,18})?$/).refine((v) => new bignumber_js_1.default(v).isGreaterThan(0), 'amount must be > 0'),
});
const TRADING_UNAVAILABLE = 'Trading account balance is temporarily unavailable';
function withdrawalsRouter(prisma, options = {}) {
    const router = (0, express_1.Router)();
    const service = new WithdrawalService_1.WithdrawalService(prisma);
    /**
     * The caller's Cross trading account rows, or `null` for an account that
     * withdraws from spot. Only the owner and the configured test accounts
     * have one; everyone else never reaches the reader.
     */
    async function tradingRows(req) {
        if (!options.tradingWallet || !(0, access_1.isSimulationOnlyUser)(req.userId))
            return null;
        // requireAuth has verified this bearer token; decode only its expiry.
        const claims = jsonwebtoken_1.default.decode(req.headers.authorization.slice(7));
        const actor = {
            userId: req.userId,
            sessionId: req.sessionId ?? '',
            expiresAt: typeof claims?.exp === 'number' ? claims.exp * 1000 : 0,
        };
        return options.tradingWallet(actor);
    }
    function tradingFailure(res, err) {
        if (err instanceof serviceTypes_1.PrivateTradingError && err.status < 500)
            return res.status(err.status).json({ error: err.message });
        console.error('[withdrawals] trading wallet read failed', err);
        return res.status(503).json({ error: TRADING_UNAVAILABLE });
    }
    // The account's own withdrawal-request history, scoped to the caller —
    // same pattern as GET /deposits/me.
    router.get('/withdrawals/me', (0, auth_1.requireAuth)(prisma), (0, asyncRoute_1.asyncRoute)(async (req, res) => {
        const withdrawals = await prisma.withdrawal.findMany({
            where: { userId: req.userId },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        res.json(withdrawals.map((w) => ({
            id: w.id,
            asset: w.asset,
            network: w.network,
            toAddress: w.toAddress,
            amount: w.amount.toString(),
            status: w.status,
            rejectionReason: w.rejectionReason,
            createdAt: w.createdAt,
        })));
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
    router.get('/withdrawals/options', (0, auth_1.requireAuth)(prisma), (0, asyncRoute_1.asyncRoute)(async (req, res) => {
        let rows;
        try {
            rows = await tradingRows(req);
        }
        catch (err) {
            return tradingFailure(res, err);
        }
        const positive = (list) => list.filter((b) => !(0, testAssetConfig_1.isTestAssetPairOrSymbol)(b.asset) && new bignumber_js_1.default(b.available).isGreaterThan(0));
        if (rows)
            return res.json({ source: 'TRADING', assets: [], futures: [] });
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
    router.post('/withdrawals', (0, auth_1.requireAuth)(prisma), async (req, res) => {
        const parsed = requestSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: parsed.error.flatten() });
        let rows;
        try {
            rows = await tradingRows(req);
        }
        catch (err) {
            return tradingFailure(res, err);
        }
        // A Cross trading account is demo-valued: it files no request, whatever the demo switches; nothing is written.
        if (rows) {
            const refused = new WithdrawalService_1.DemoFundsNotWithdrawableError();
            return res.status(403).json({ error: refused.message, code: refused.code });
        }
        try {
            const result = await service.requestWithdrawal({ userId: req.userId, ...parsed.data });
            res.json(result);
        }
        catch (err) {
            if (err instanceof WithdrawalService_1.WithdrawalRequestError)
                return res.status(400).json({ error: err.message });
            console.error(err);
            res.status(500).json({ error: 'Failed to submit withdrawal request' });
        }
    });
    return router;
}
//# sourceMappingURL=withdrawals.js.map