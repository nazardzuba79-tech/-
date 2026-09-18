import { useEffect, useState } from 'react';
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

/** Every configured deposit wallet at once, for a UI that lists them all
 * instead of making the user pick a network first.
 *
 * The addresses normally arrive inside the config envelope, so the whole
 * list costs ONE request. An API that has not shipped that field yet omits
 * it, and those chains are resolved individually through the original
 * /deposit-address/:chain — the same validation either way. A chain whose
 * address cannot be resolved is DROPPED and flagged, never rendered blank:
 * an empty address in a funds-receiving field is how deposits get lost.
 */
export function useDepositWallets(active: boolean) {
  const empty = { loaded: false, wallets: [] as DepositWallet[], minDepositUsd: null as number | null, error: null as 'chains' | 'address' | null };
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
      setState({ loaded: true, wallets, minDepositUsd: value.minDepositUsd,
        error: wallets.length < value.chains.length ? 'address' : null });
    }).catch(() => { if (!cancelled) setState({ loaded: true, wallets: [], minDepositUsd: null, error: 'chains' }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return state;
}

/** Shared by the nav and Wallet deposit forms. Configuration is read on each
 * opening; no guessed minimum, address, supported asset or conversion. */
export function useDepositOptions(active: boolean) {
  const [config, setConfig] = useState<DepositConfig | null>(null);
  const [chainsLoaded, setChainsLoaded] = useState(false);
  const [chain, setChain] = useState<string | null>(null);
  const [asset, setAsset] = useState('');
  const [destination, setDestination] = useState<{ chain: string; address: string; assets: string[] } | null>(null);
  const [error, setError] = useState<'chains' | 'address' | null>(null);
  const [quote, setQuote] = useState<{ asset: string; minimum: number; equivalent: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setConfig(null); setChainsLoaded(false); setChain(null); setDestination(null); setAsset(''); setError(null);
    getDepositConfig().then(value => {
      if (cancelled) return;
      if (!validDepositConfig(value)) throw new Error('Invalid deposit configuration');
      setConfig(value); setChain(value.chains[0]?.chain ?? null);
    }).catch(() => { if (!cancelled) setError('chains'); })
      .finally(() => { if (!cancelled) setChainsLoaded(true); });
    return () => { cancelled = true; };
  }, [active]);

  useEffect(() => {
    if (!active || !config || !chain) return;
    let cancelled = false;
    setDestination(null); setAsset(''); setError(null);
    api.getDepositAddress(chain).then(value => {
      if (cancelled) return;
      const supported = config.chains.find(item => item.chain === chain)?.supportedAssets ?? [];
      if (value.chain !== chain || typeof value.address !== 'string' || !value.address
        || !Array.isArray(value.supportedAssets) || !value.supportedAssets.every(item => typeof item === 'string' && supported.includes(item)))
        throw new Error('Invalid deposit destination');
      setDestination({ chain, address: value.address, assets: value.supportedAssets });
      setAsset(value.supportedAssets[0] ?? '');
    }).catch(() => { if (!cancelled) setError('address'); });
    return () => { cancelled = true; };
  }, [active, config, chain]);

  const assets = destination?.chain === chain ? destination.assets : [];
  const selectedAsset = assets.includes(asset) ? asset : '';
  useEffect(() => {
    if (!active || !config || !selectedAsset || config.usdPeggedAssets.includes(selectedAsset)) return;
    let cancelled = false;
    const refresh = () => {
      api.getExternalTicker(`${selectedAsset}/USDT`).then(value => {
        if (cancelled) return;
        const equivalent = depositMinimumEquivalent(config, selectedAsset, value?.ticker?.lastPrice);
        setQuote(equivalent === null ? null : { asset: selectedAsset, minimum: config.minDepositUsd, equivalent });
      }).catch(() => { if (!cancelled) setQuote(null); });
    };
    setQuote(null); refresh();
    const timer = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, config, selectedAsset]);

  const stable = !!config?.usdPeggedAssets.includes(selectedAsset);
  return {
    chains: active ? config?.chains ?? [] : [], chainsLoaded, chain, setChain, asset: selectedAsset, setAsset, assets,
    address: active && destination?.chain === chain ? destination.address : null, error,
    minDepositUsd: active ? config?.minDepositUsd ?? null : null, stable,
    minEquivalent: !active || !config || !selectedAsset ? null : stable ? config.minDepositUsd
      : quote?.asset === selectedAsset && quote.minimum === config.minDepositUsd ? quote.equivalent : null,
  };
}
