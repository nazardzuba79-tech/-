import { useEffect, useMemo, useState } from 'react';
import { api, clearToken, getToken } from './api';
import { depositMinimumEquivalent, validDepositConfig, type DepositConfig } from './depositMinimum';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

async function getDepositConfig(): Promise<DepositConfig> {
  const token = getToken();
  if (!token) throw new Error('Unauthenticated');
  const res = await fetch(`${API_BASE}/deposit-chains?includeConfig=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') window.location.href = '/';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export interface DepositWallet {
  chain: string;
  address: string;
  /** Exactly the assets the backend will credit on this chain. Never widened. */
  assets: string[];
}

/**
 * Every configured deposit wallet, read once.
 *
 * This is the ONE place deposit destinations come from. The nav screen
 * lists them all; the Wallet screen narrows them by asset and network. Both
 * read the same wallets, so the two screens cannot disagree about which
 * address belongs to which chain.
 *
 * The addresses normally arrive inside the config envelope, so the whole
 * list costs ONE request. An API that has not shipped that field yet omits
 * it, and those chains are resolved individually through the original
 * /deposit-address/:chain — the same validation either way. A chain whose
 * address cannot be resolved is DROPPED and flagged, never rendered blank:
 * an empty address in a funds-receiving field is how deposits get lost.
 */
export function useDepositWallets(active: boolean) {
  const empty = {
    loaded: false,
    wallets: [] as DepositWallet[],
    minDepositUsd: null as number | null,
    usdPeggedAssets: [] as string[],
    error: null as 'chains' | 'address' | null,
  };
  const [state, setState] = useState(empty);

  useEffect(() => {
    if (!active) { setState(empty); return; }
    let cancelled = false;
    setState(empty);
    getDepositConfig().then(async value => {
      if (cancelled) return;
      if (!validDepositConfig(value)) throw new Error('Invalid deposit configuration');
      const resolved = await Promise.all(value.chains.map(async (chain): Promise<DepositWallet | null> => {
        if (chain.address) return { chain: chain.chain, address: chain.address, assets: chain.supportedAssets };
        try {
          const destination = await api.getDepositAddress(chain.chain);
          if (destination.chain !== chain.chain || typeof destination.address !== 'string' || !destination.address
            || !Array.isArray(destination.supportedAssets)
            || !destination.supportedAssets.every(item => typeof item === 'string' && chain.supportedAssets.includes(item)))
            return null;
          return { chain: chain.chain, address: destination.address, assets: destination.supportedAssets };
        } catch { return null; }
      }));
      if (cancelled) return;
      const wallets = resolved.filter((wallet): wallet is DepositWallet => wallet !== null);
      setState({ loaded: true, wallets, minDepositUsd: value.minDepositUsd, usdPeggedAssets: value.usdPeggedAssets,
        error: wallets.length < value.chains.length ? 'address' : null });
    }).catch(() => {
      if (!cancelled) setState({ loaded: true, wallets: [], minDepositUsd: null, usdPeggedAssets: [], error: 'chains' });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return state;
}

/**
 * The deposit minimum expressed in the asset the user is about to send.
 *
 * The threshold itself is the backend's, in USD. For a USD-pegged asset the
 * two are the same number. For anything else this is a DISPLAY estimate off
 * the public ticker, refreshed every 30s — DepositService re-prices at
 * actual credit time, so nothing here decides what gets credited. An asset
 * with no usable price returns null and the screen shows the USD figure
 * alone rather than a guessed conversion.
 */
export function useMinimumEquivalent(
  minDepositUsd: number | null,
  usdPeggedAssets: string[],
  asset: string,
  active: boolean,
) {
  const [quote, setQuote] = useState<{ asset: string; minimum: number; equivalent: number } | null>(null);
  const stable = !!asset && usdPeggedAssets.includes(asset);

  useEffect(() => {
    if (!active || minDepositUsd === null || !asset || stable) return;
    let cancelled = false;
    const config: DepositConfig = { chains: [], minDepositUsd, usdPeggedAssets };
    const refresh = () => {
      api.getExternalTicker(`${asset}/USDT`).then(value => {
        if (cancelled) return;
        const equivalent = depositMinimumEquivalent(config, asset, value?.ticker?.lastPrice);
        setQuote(equivalent === null ? null : { asset, minimum: minDepositUsd, equivalent });
      }).catch(() => { if (!cancelled) setQuote(null); });
    };
    setQuote(null); refresh();
    const timer = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, minDepositUsd, asset, stable]);

  return {
    stable,
    minEquivalent: !active || minDepositUsd === null || !asset ? null
      : stable ? minDepositUsd
      : quote?.asset === asset && quote.minimum === minDepositUsd ? quote.equivalent : null,
  };
}

/**
 * Asset first, then the networks that carry it.
 *
 * Network-first put the user in front of an asset list that, on most
 * chains, holds exactly one entry — opening it changed nothing and the
 * screen read as stuck. Choosing the asset first is the question the user
 * actually has ("I am sending USDT — where?"), and it leaves the second
 * list with something to choose between.
 *
 * Neither list is ever widened beyond what the backend said it will
 * credit: an asset only appears because some wallet lists it, and a network
 * only appears under an asset whose own `assets` include it.
 */
export function useDepositSelection(wallets: DepositWallet[]) {
  const assets = useMemo(() => {
    const seen: string[] = [];
    for (const wallet of wallets) for (const asset of wallet.assets) if (!seen.includes(asset)) seen.push(asset);
    return seen;
  }, [wallets]);

  const [assetChoice, setAsset] = useState('');
  const [chainChoice, setChain] = useState('');

  // Fall back rather than hold a choice the current wallets cannot honour:
  // the config is re-read on each opening and a chain can disappear from it.
  const asset = assets.includes(assetChoice) ? assetChoice : assets[0] ?? '';
  const networks = useMemo(() => wallets.filter(wallet => wallet.assets.includes(asset)), [wallets, asset]);
  const wallet = networks.find(item => item.chain === chainChoice) ?? networks[0] ?? null;

  return {
    assets,
    asset,
    setAsset,
    networks,
    chain: wallet?.chain ?? '',
    setChain,
    address: wallet?.address ?? null,
  };
}
