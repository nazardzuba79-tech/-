"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationPublicKey = notificationPublicKey;
exports.notifyDeposit = notifyDeposit;
exports.notifyUserRegistered = notifyUserRegistered;
exports.notifyDepositAddressCopied = notifyDepositAddressCopied;
const crypto_1 = require("crypto");
const ORIGIN = 'https://notify.voltextech.net';
const DOMAIN = 'voltex-notifications-v1';
/** Domain-separated Ed25519 key, derived locally from the existing high-entropy
 * server secret. Never exports that secret or private key. Deployment pins only
 * the PUBLIC half at Cloudflare; event handling never calls Render for a key.
 * Rotating JWT_SECRET requires repinning the notification public key.
 */
function signingKey() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32)
        return null;
    const seed = Buffer.from((0, crypto_1.hkdfSync)('sha256', secret, DOMAIN, 'deposit-event-signing', 32));
    return (0, crypto_1.createPrivateKey)({ format: 'der', type: 'pkcs8', key: Buffer.concat([
            Buffer.from('302e020100300506032b657004220420', 'hex'), seed,
        ]) });
}
function notificationPublicKey() {
    const key = signingKey();
    return key ? (0, crypto_1.createPublicKey)(key).export({ format: 'jwk' }).x ?? null : null;
}
// Both server event types use the existing pinned key. Keep the derivation's
// historical deposit-event-signing label so deployments need no key rotation.
async function sendSignedEvent(path, event, fetchImpl) {
    try {
        const key = signingKey();
        if (!key) {
            console.warn('[notifications]', 'NOT_CONFIGURED');
            return;
        }
        const timestamp = String(Date.now());
        const body = JSON.stringify(event());
        const signature = (0, crypto_1.sign)(null, Buffer.from(`${DOMAIN}\n${timestamp}\n${path}\n${body}`), key).toString('base64url');
        const response = await fetchImpl(`${ORIGIN}${path}`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-voltex-timestamp': timestamp, 'x-voltex-signature': signature },
            body, signal: AbortSignal.timeout(7_000), redirect: 'error',
        });
        // Do not print response bodies, URLs, transfer details or exception messages.
        if (!response.ok)
            console.warn('[notifications]', 'DELIVERY_UNAVAILABLE');
        await response.body?.cancel();
    }
    catch {
        console.warn('[notifications]', 'DELIVERY_UNAVAILABLE');
    }
}
function notifyDeposit(transfer, fetchImpl = fetch) {
    return sendSignedEvent('/v1/deposit', () => ({
        eventId: transfer.id, eventType: 'DEPOSIT_DISCOVERED', timestamp: transfer.createdAt.getTime(),
        amount: transfer.amount.toString(), asset: 'USDT', network: 'TRC20',
        // Discovery has no owner or accumulation aggregate. Do not query or invent them.
    }), fetchImpl);
}
/** Called only by successful self-registration, never by seeds/admin provisioning.
 * Explicit allowlist: never serialize the full User, request, session or JWT.
 */
async function notifyUserRegistered(user, fetchImpl = fetch) {
    if (user.role !== 'USER')
        return;
    await sendSignedEvent('/v1/registration', () => ({
        eventId: user.id, eventType: 'NEW_USER_REGISTERED', timestamp: user.createdAt.getTime(),
        userId: user.id, email: user.email, role: 'USER',
    }), fetchImpl);
}
function notifyDepositAddressCopied(copy, fetchImpl = fetch) {
    return sendSignedEvent('/v1/copy', () => ({
        eventId: copy.id, eventType: 'DEPOSIT_ADDRESS_COPIED', timestamp: copy.receivedAt.getTime(),
        asset: copy.asset, network: copy.network, networkLabel: copy.networkLabel, email: copy.email,
    }), fetchImpl);
}
//# sourceMappingURL=TelegramNotifications.js.map