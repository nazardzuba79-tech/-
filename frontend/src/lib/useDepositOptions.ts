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

/**
 * The deposit addresses live on the device and are downloaded again only
 * when they change.
 *
 * Addresses almost never change, yet every open used to download them and
 * wait behind «Загрузка сетей…». Now the last list is kept in localStorage
 * together with the server's fingerprint of it. An open asks only
 * /deposit-config-version — no addresses, no session lookup, no database
 * read on the server — and shows the device's list once the fingerprint
 * matches. The full list is downloaded only when the fingerprint differs
 * (an admin changed an address) or there is no copy yet. The device copy
 * is never shown unconfirmed: a rotated address must not appear even for a
 * moment, and a failed check fails closed like a failed download.
 *
 * A copy is kept only when it is complete (every chain carries its address)
 * and the server named its fingerprint; anything else is not stored, so an
 * older API simply behaves as before. A hover or focus on a Deposit button
 * starts the check early (prefetchDepositConfig), and the open a moment
 * later joins it instead of asking twice.
 */
const STORED_KEY = 'voltex.depositConfig.v1';
type StoredConfig = { version: string; config: DepositConfig };

function completeConfig(value: unknown): value is DepositConfig {
  return validDepositConfig(value) && value.chains.every(chain => typeof chain.address === 'string' && chain.address.length > 0);
}

function readStoredConfig(): StoredConfig | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORED_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value.version === 'string' && completeConfig(value.config) ? value : null;
  } catch { return null; }
}

function writeStoredConfig(value: StoredConfig | null) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value) localStorage.setItem(STORED_KEY, JSON.stringify(value)); else localStorage.removeItem(STORED_KEY);
  } catch { /* storage unavailable: the next open downloads, as before */ }
}

async function getDepositConfigVersion(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/deposit-config-version`, { cache: 'no-store' });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body && typeof body.version === 'string' ? body.version : null;
}

async function syncDepositConfig(): Promise<DepositConfig> {
  const stored = readStoredConfig();
  if (stored && (await getDepositConfigVersion().catch(() => null)) === stored.version) return stored.config;
  const fresh = await getDepositConfig();
  writeStoredConfig(completeConfig(fresh) && typeof fresh.version === 'string' ? { version: fresh.version, config: fresh } : null);
  return fresh;
}

const JOIN_MS = 10_000;
let inflight: { at: number; promise: Promise<DepositConfig> } | null = null;

/** The one entry to the deposit configuration: joins a check started a
 * moment ago (a hover), otherwise checks the fingerprint afresh. */
export function loadDepositConfig(): Promise<DepositConfig> {
  if (inflight && Date.now() - inflight.at < JOIN_MS) return inflight.promise;
  const entry = { at: Date.now(), promise: syncDepositConfig() };
  inflight = entry;
  entry.promise.catch(() => { if (inflight === entry) inflight = null; });
  return entry.promise;
}

/** Start the check on intent (hover/focus of a Deposit button). */
export function prefetchDepositConfig(): void {
  if (!getToken()) return;
  loadDepositConfig().catch(() => { /* the panel retries and reports on open */ });
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
    // Nothing is drawn from the device copy before the server's fingerprint
    // confirms it: a rotated address must never be shown, even briefly.
    setState(empty);
    loadDepositConfig().then(async value => {
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
