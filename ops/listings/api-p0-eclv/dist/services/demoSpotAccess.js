"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.demoWithdrawalGuardEnabled = exports.demoSpotEnabled = void 0;
exports.demoSpotRole = demoSpotRole;
exports.demoSpotLedger = demoSpotLedger;
const bignumber_js_1 = __importDefault(require("bignumber.js"));
const testAssetConfig_1 = require("./testMarkets/testAssetConfig");
const demoSpotEnabled = (env = process.env) => env.DEMO_SPOT_ENABLED === 'true';
exports.demoSpotEnabled = demoSpotEnabled;
/**
 * Whether the demo-funds guard switches are on: `DEMO_WITHDRAWAL_GUARD_ENABLED=true`, or forced by `DEMO_SPOT_ENABLED`
 * or `DEMO_LIQUIDITY_ENABLED`. It no longer decides any withdrawal: since Issue #617 a demo-valued (unheld) request is
 * refused permanently by WithdrawalService and the withdrawal routes — never filed, approved or marked sent, whatever
 * these switches say, including requests filed before. Kept as a configuration signal for code that reports it.
 */
const demoWithdrawalGuardEnabled = (env = process.env) => env.DEMO_WITHDRAWAL_GUARD_ENABLED === 'true' || (0, exports.demoSpotEnabled)(env) || env.DEMO_LIQUIDITY_ENABLED === 'true';
exports.demoWithdrawalGuardEnabled = demoWithdrawalGuardEnabled;
async function demoSpotRole(db, userId, enabled = (0, exports.demoSpotEnabled)()) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, blockedAt: true } });
    if (!user || user.blockedAt)
        return null;
    if (user.role === 'ADMIN')
        return 'admin';
    if (!enabled || user.role !== 'USER')
        return null;
    const credit = await db.auditLog.findFirst({ where: { userId, action: 'DEMO_BALANCE_ADJUSTED' }, select: { id: true } });
    return credit ? 'trader' : null;
}
async function demoSpotLedger(db, userId, enabled = (0, exports.demoSpotEnabled)()) {
    if (!enabled)
        return 'spot';
    const funded = await db.balance.findMany({ where: { userId, OR: [{ available: { gt: 0 } }, { locked: { gt: 0 } }] }, select: { asset: true, available: true, locked: true } });
    if (funded.some(b => !(0, testAssetConfig_1.isTestAssetPairOrSymbol)(b.asset) && new bignumber_js_1.default(b.available.toString()).plus(b.locked.toString()).gt(0)))
        return 'spot';
    return (await demoSpotRole(db, userId, true)) ? 'demo' : 'none';
}
//# sourceMappingURL=demoSpotAccess.js.map