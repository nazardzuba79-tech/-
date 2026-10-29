import { createPublicKey, verify as ed25519Verify } from 'node:crypto';

// This is NOT an on-chain attestor. It validates the independently attested,
// producer-signed PUBLIC display envelope and refuses any unknown price.
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SRC = 'voltex.solana-ohlcv.v1';
const PROGRAM = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const GATES = ['programIdentity', 'poolState', 'mintChronology', 'feeChronology', 'completeness', 'executionBinding'];
const STEPS = Object.freeze({ '1m': 60, '5m': 300, '1h': 3600 });
export class InvalidSnapshot extends Error { constructor(code) { super(code); this.code = code; } }
const reject = (code) => { throw new InvalidSnapshot(code); };

export function verifyPublicPage(page) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) reject('PAGE_INVALID');
  const { provenance: p, range, instrumentId, interval, candles, gaps } = page;
  const step = STEPS[interval];
  const src = p?.source;
  if (page.schema !== SRC || !step || page.priceKind !== 'raw-token' || page.quoteCurrency !== 'USDC'
    || src?.network !== 'solana-mainnet-beta' || src?.program !== PROGRAM || src?.quoteMint !== USDC
    || !B58.test(src?.mint || '') || !B58.test(src?.pool || '')
    || instrumentId !== `SOLANA:${src.mint}:${src.pool}`
    || !Number.isSafeInteger(range?.from) || !Number.isSafeInteger(range?.to)
    || range.from < 0 || range.from % step || range.to % step || range.to <= range.from
    || !Array.isArray(candles) || !Array.isArray(gaps)
    || (range.to - range.from) / step > 1500 || candles.length > 1500 || gaps.length > 1500) reject('SOURCE_UNAVAILABLE');
  if (p?.status !== 'ACCEPTED' || p.intervalComplete !== true || p.finality !== 'finalized'
    || p.synthetic !== false || !SHA256.test(p.receiptsHash || '')
    || !GATES.every(g => p.gates?.[g] === true)
    || !Number.isSafeInteger(p.acceptedTradeCount) || p.acceptedTradeCount <= 0) reject('PROOF_UNVERIFIED');

  const occupied = new Set();
  const add = time => {
    if (!Number.isSafeInteger(time) || time < range.from || time >= range.to || time % step || occupied.has(time))
      reject('COVERAGE_INVALID');
    occupied.add(time);
  };
  for (const g of gaps) {
    if (!g || !['NO_TRADES', 'UNKNOWN', 'OUTSIDE_RETENTION'].includes(g.reason)) reject('GAP_INVALID');
    add(g.time);
  }
  let count = 0;
  for (const c of candles) {
    if (!c || !Number.isSafeInteger(c.tradeCount) || c.tradeCount <= 0 || !SHA256.test(c.proofDigest || '')
      || ![c.open,c.high,c.low,c.close,c.volume].every(v => typeof v === 'number' && Number.isFinite(v))
      || c.low <= 0 || c.volume <= 0 || c.high < Math.max(c.open,c.close,c.low)
      || c.low > Math.min(c.open,c.close)) reject('CANDLE_INVALID');
    add(c.time);
    count += c.tradeCount;
  }
  if (!Number.isSafeInteger(count) || count !== p.acceptedTradeCount
    || occupied.size !== (range.to - range.from) / step) reject('COVERAGE_INVALID');
  return { instrumentId, interval, range };
}

const B64URL = /^[A-Za-z0-9_-]+$/;
export function verifySignedSnapshot(envelope, publicKey, now = Date.now()) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
    || typeof envelope.payloadB64 !== 'string' || typeof envelope.signatureB64 !== 'string'
    || !B64URL.test(envelope.payloadB64) || !B64URL.test(envelope.signatureB64)
    || envelope.payloadB64.length > 700000 || envelope.signatureB64.length > 180) reject('ENVELOPE_INVALID');
  const body = Buffer.from(envelope.payloadB64, 'base64url');
  const signature = Buffer.from(envelope.signatureB64, 'base64url');
  if (signature.length !== 64 || body.toString('base64url') !== envelope.payloadB64
    || signature.toString('base64url') !== envelope.signatureB64) reject('ENVELOPE_INVALID');
  let key;
  try { key = createPublicKey(publicKey); } catch { reject('PUBLIC_KEY_INVALID'); }
  if (key.asymmetricKeyType !== 'ed25519' || !ed25519Verify(null, body, key, signature)) reject('SIGNATURE_INVALID');
  let payload;
  try { payload = JSON.parse(body.toString('utf8')); } catch { reject('PAYLOAD_INVALID'); }
  if (!Number.isSafeInteger(payload?.issuedAtMs) || !Number.isSafeInteger(payload?.expiresAtMs)
    || payload.issuedAtMs > now + 1000 || payload.issuedAtMs < now - 31000
    || payload.expiresAtMs <= now || payload.expiresAtMs > payload.issuedAtMs + 30000) reject('SNAPSHOT_STALE');
  const id = verifyPublicPage(payload.page);
  return { payload, id, raw: { payloadB64: envelope.payloadB64, signatureB64: envelope.signatureB64 } };
}
