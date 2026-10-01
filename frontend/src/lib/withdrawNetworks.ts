/**
 * The networks a withdrawal request can name, per asset, and a conservative
 * address check.
 *
 * The admin pays every request by hand, so the network is what the admin is
 * told to send on. The list offers only the usual networks for each asset;
 * the stored value is the short code the admin console already reads
 * (`TRC20`, `ERC20`, …).
 */
export interface WithdrawNetwork {
  code: string;
  label: string;
  family: 'tron' | 'evm' | 'bitcoin' | 'solana' | 'ton';
}

const TRC20: WithdrawNetwork = { code: 'TRC20', label: 'TRON (TRC20)', family: 'tron' };
const ERC20: WithdrawNetwork = { code: 'ERC20', label: 'Ethereum (ERC20)', family: 'evm' };
const BEP20: WithdrawNetwork = { code: 'BEP20', label: 'BNB Smart Chain (BEP20)', family: 'evm' };
const SOL: WithdrawNetwork = { code: 'SOL', label: 'Solana', family: 'solana' };
const TON: WithdrawNetwork = { code: 'TON', label: 'TON', family: 'ton' };
const BTC: WithdrawNetwork = { code: 'BTC', label: 'Bitcoin', family: 'bitcoin' };

const BY_ASSET: Record<string, WithdrawNetwork[]> = {
  USDT: [TRC20, ERC20, BEP20, TON, SOL],
  USDC: [ERC20, BEP20, SOL],
  BTC: [BTC],
  ETH: [ERC20],
  BNB: [BEP20],
  TRX: [TRC20],
  SOL: [SOL],
  TON: [TON],
};

/** Any other token: the two EVM networks such tokens usually travel on. */
const DEFAULT_NETWORKS = [ERC20, BEP20];

export function withdrawNetworks(asset: string): WithdrawNetwork[] {
  return BY_ASSET[asset.toUpperCase()] ?? DEFAULT_NETWORKS;
}

/**
 * One well-known form per family, in order of how specific it is: base58
 * Solana keys overlap the shorter base58 forms, so a TRON or legacy Bitcoin
 * address is recognised as that before it could pass as Solana.
 */
const SHAPES: [WithdrawNetwork['family'], RegExp][] = [
  ['evm', /^0x[0-9a-fA-F]{40}$/],
  ['tron', /^T[1-9A-HJ-NP-Za-km-z]{33}$/],
  ['bitcoin', /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/],
  // User-friendly (48 base64url characters) or raw (workchain:hex) form.
  ['ton', /^(?:[UEk0][Qf][A-Za-z0-9_-]{46}|-?\d:[0-9a-fA-F]{64})$/],
  // Solana addresses are base58 public keys, 32–44 characters.
  ['solana', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/],
];

export type AddressVerdict = 'empty' | 'ok' | 'spaces' | 'wrongNetwork' | 'unrecognised';

/**
 * A UX check, not a guarantee: the admin still reads every address before
 * paying. `wrongNetwork` when the address is clearly another family's (an
 * 0x address on TRON, a T… address on Ethereum); `unrecognised` when it has
 * none of the known forms. Both are refused, since every network offered has
 * one well-known form.
 */
export function checkWithdrawAddress(network: WithdrawNetwork, raw: string): AddressVerdict {
  const value = raw.trim();
  if (!value) return 'empty';
  if (/\s/.test(value)) return 'spaces';
  const match = SHAPES.find(([, shape]) => shape.test(value));
  if (!match) return 'unrecognised';
  return match[0] === network.family ? 'ok' : 'wrongNetwork';
}
