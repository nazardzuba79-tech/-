import { isAddress } from 'ethers';

/** Explicit identities and rails, NOT a market-cap ranking. Never infer a
 * wrapped/bridged asset's network from its symbol or its underlying asset. */
export interface RailDefinition {
  assetId: string; asset: string; networkId: string; networkName: string;
  standard: string; memoAllowed: boolean; memoLabel: string;
}
const definitions: [string, string, string, string, string, boolean?][] = [
  ['bitcoin', 'BTC', 'bitcoin', 'Bitcoin Network', 'Native'],
  ['ethereum', 'ETH', 'ethereum', 'Ethereum', 'Native'],
  ['tether', 'USDT', 'ethereum', 'Ethereum', 'ERC-20'],
  ['tether', 'USDT', 'tron', 'TRON', 'TRC-20'],
  ['usd-coin', 'USDC', 'ethereum', 'Ethereum', 'ERC-20'],
  ['usd-coin', 'USDC', 'solana', 'Solana', 'SPL'],
  ['binancecoin', 'BNB', 'bsc', 'BNB Smart Chain', 'Native'],
  ['solana', 'SOL', 'solana', 'Solana', 'Native'],
  ['polygon-ecosystem-token', 'POL', 'polygon', 'Polygon', 'Native'],
  ['ripple', 'XRP', 'xrp', 'XRP Ledger', 'Native', true],
  ['dogecoin', 'DOGE', 'dogecoin', 'Dogecoin', 'Native'],
  ['cardano', 'ADA', 'cardano', 'Cardano', 'Native'],
  ['tron', 'TRX', 'tron', 'TRON', 'Native'],
  ['the-open-network', 'TON', 'ton', 'TON', 'Native', true],
  ['avalanche-2', 'AVAX', 'avalanche', 'Avalanche C-Chain', 'Native'],
  ['chainlink', 'LINK', 'ethereum', 'Ethereum', 'ERC-20'],
  ['stellar', 'XLM', 'stellar', 'Stellar', 'Native', true],
  ['sui', 'SUI', 'sui', 'Sui', 'Native'],
  ['bitcoin-cash', 'BCH', 'bitcoin-cash', 'Bitcoin Cash', 'Native'],
  ['litecoin', 'LTC', 'litecoin', 'Litecoin', 'Native'],
  ['polkadot', 'DOT', 'polkadot', 'Polkadot', 'Native'],
  ['hedera-hashgraph', 'HBAR', 'hedera', 'Hedera', 'Native', true],
  ['shiba-inu', 'SHIB', 'ethereum', 'Ethereum', 'ERC-20'],
  ['uniswap', 'UNI', 'ethereum', 'Ethereum', 'ERC-20'],
  ['wrapped-bitcoin', 'WBTC', 'ethereum', 'Ethereum', 'ERC-20'],
  ['staked-ether', 'STETH', 'ethereum', 'Ethereum', 'ERC-20'],
  ['weth', 'WETH', 'ethereum', 'Ethereum', 'ERC-20'],
  ['ethena-usde', 'USDE', 'ethereum', 'Ethereum', 'ERC-20'],
  ['dai', 'DAI', 'ethereum', 'Ethereum', 'ERC-20'],
  ['usds', 'USDS', 'ethereum', 'Ethereum', 'ERC-20'],
  ['leo-token', 'LEO', 'ethereum', 'Ethereum', 'ERC-20'],
  ['hyperliquid', 'HYPE', 'hyperevm', 'HyperEVM', 'Native'],
];
export const DEPOSIT_RAILS: readonly RailDefinition[] = definitions.map(([assetId, asset, networkId, networkName, standard, memoAllowed]) => ({
  assetId, asset, networkId, networkName, standard, memoAllowed: !!memoAllowed,
  memoLabel: networkId === 'xrp' ? 'Destination tag' : 'Memo',
}));
export const railKey = (rail: Pick<RailDefinition, 'assetId' | 'networkId'>) => `${rail.assetId}:${rail.networkId}`;

/** Format validation only: no RPC/explorer lookup or claim of address ownership.
 * Operations must independently verify the destination before enabling it. */
export function validAddress(network: string, address: string): boolean {
  if (address.length > 256 || !address || /[\s<>"'`\\]/.test(address)) return false;
  if (['ethereum', 'bsc', 'polygon', 'avalanche', 'hyperevm'].includes(network)) return isAddress(address);
  const patterns: Record<string, RegExp> = {
    bitcoin: /^(?:bc1[ac-hj-np-z02-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
    tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    xrp: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
    dogecoin: /^D[1-9A-HJ-NP-Za-km-z]{25,34}$/,
    cardano: /^addr1[ac-hj-np-z02-9]{50,120}$/,
    ton: /^(?:[EU]Q[A-Za-z0-9_-]{46}|0:[a-fA-F0-9]{64})$/,
    stellar: /^G[A-Z2-7]{55}$/,
    sui: /^0x[a-fA-F0-9]{64}$/,
    'bitcoin-cash': /^(?:bitcoincash:)?[qp][ac-hj-np-z02-9]{41}$/,
    litecoin: /^(?:ltc1[ac-hj-np-z02-9]{11,71}|[LM3][1-9A-HJ-NP-Za-km-z]{25,34})$/,
    polkadot: /^1[1-9A-HJ-NP-Za-km-z]{46,47}$/,
    hedera: /^0\.0\.[0-9]{1,20}$/,
  };
  return patterns[network]?.test(address) ?? false;
}
