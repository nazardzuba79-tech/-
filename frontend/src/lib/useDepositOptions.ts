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
