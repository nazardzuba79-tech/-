/** Labels describe a recorded network; only backend configuration grants support. */
const NETWORKS: Record<string, { name: string; standard: string; native: string }> = {
  bitcoin: { name: 'Bitcoin Network', standard: '', native: 'BTC' },
  ethereum: { name: 'Ethereum', standard: 'ERC-20', native: 'ETH' },
  tron: { name: 'TRON', standard: 'TRC-20', native: 'TRX' },
  bsc: { name: 'BNB Smart Chain', standard: 'BEP-20', native: 'BNB' },
  solana: { name: 'Solana', standard: 'SPL', native: 'SOL' },
  ton: { name: 'TON', standard: 'Jetton', native: 'TON' },
};
const ALIASES: Record<string, string> = { trc20: 'tron', erc20: 'ethereum', bep20: 'bsc', spl: 'solana', jetton: 'ton', btc: 'bitcoin', eth: 'ethereum' };
export function networkKey(value: string): string {
  const key = value.trim().toLowerCase();
  return ALIASES[key.replace(/[- ]/g, '')] ?? key;
}
export function networkName(chain: string): string { return NETWORKS[networkKey(chain)]?.name ?? chain; }
export function railDisplay(asset: string, chain: string, native?: boolean) {
  const config = NETWORKS[networkKey(chain)];
  const standard = native === true ? 'Native' : native === false ? config?.standard || '—'
    : config ? (asset.toUpperCase() === config.native ? 'Native' : config.standard || '—') : '—';
  const network = networkName(chain);
  return { network, standard, label: `${asset} · ${network}${standard !== '—' ? ` (${standard})` : ''}` };
}
export interface WalletConfig {
  chain: string; nativeAsset: string | null; tokens: string[]; address: string | null;
  envConfigured: boolean; nativeDepositsSupported?: boolean;
}
export function depositRails<T extends WalletConfig>(wallets: T[]) {
  return wallets.flatMap(wallet => {
    if (!wallet.envConfigured) return [];
    const assets = [
      ...(wallet.nativeAsset && (wallet.nativeDepositsSupported ?? networkKey(wallet.chain) !== 'tron') ? [{ asset: wallet.nativeAsset, native: true }] : []),
      ...wallet.tokens.filter(asset => asset !== wallet.nativeAsset || networkKey(wallet.chain) === 'tron').map(asset => ({ asset, native: false })),
    ];
    return assets.map(({ asset, native }) => ({ ...railDisplay(asset, wallet.chain, native), asset, chain: wallet.chain, wallet, shared: assets.length > 1, key: `${wallet.chain}:${asset}` }));
  }).sort((a, b) => a.asset.localeCompare(b.asset) || a.network.localeCompare(b.network));
}
/** Conservative UX checks only, never a checksum/ownership guarantee. */
export function addressAdvice(chain: string, raw: string): { error?: string; warning: string } {
  const value = raw.trim();
  const warning = 'Формат не подтверждает сеть или владельца. Сверьте публичный адрес с кошельком получателя.';
  if (!value || value.length > 256 || /\s/.test(value)) return { error: 'Введите один публичный адрес без пробелов (до 256 символов).', warning };
  if (/^[a-z]+:\/\//i.test(value) || /^(bitcoin|ethereum|solana|ton|tron):/i.test(value)) return { error: 'Вставьте только адрес, без URL или платёжной ссылки.', warning };
  const network = networkKey(chain);
  // Exact recognizable families only; ambiguous or future forms get a warning, not rejection.
  const evm = /^0x[0-9a-f]{40}$/i.test(value);
  const tron = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
  const btc = /^(bc1|tb1)[ac-hj-np-z02-9]{20,90}$/i.test(value);
  if ((evm && ['tron', 'bitcoin', 'solana', 'ton'].includes(network)) ||
      (tron && ['ethereum', 'bsc', 'bitcoin', 'ton'].includes(network)) ||
      (btc && ['ethereum', 'bsc', 'tron', 'solana', 'ton'].includes(network))) {
    return { error: `Адрес похож на другую сеть. Проверьте ${networkName(chain)}.`, warning };
  }
  return { warning };
}
