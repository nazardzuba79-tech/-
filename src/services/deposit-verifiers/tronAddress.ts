import { createHash } from 'crypto';
import { decodeBase58 } from 'ethers';

/** Compare TRON addresses across Base58Check and the hex encoding used in
 * decoded TronGrid event parameters. Never lowercase Base58 addresses. */
export function tronAddressHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.replace(/^0x/i, '');
  if (/^[\da-f]{40}$/i.test(hex)) return `41${hex.toLowerCase()}`;
  if (/^41[\da-f]{40}$/i.test(hex)) return hex.toLowerCase();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return null;
  try {
    const bytes = Buffer.from(decodeBase58(value).toString(16).padStart(50, '0'), 'hex');
    if (bytes.length !== 25 || bytes[0] !== 0x41) return null;
    const payload = bytes.subarray(0, 21);
    const checksum = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
    return checksum.equals(bytes.subarray(21)) ? payload.toString('hex') : null;
  } catch { return null; }
}
