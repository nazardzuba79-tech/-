import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { LOCALES, readDictionaries } from '../../../test-utils/i18nSource';

/**
 * The header's Депозит button opens the deposit wallets directly.
 *
 * The screen used to make the user pick a network from a dropdown before it
 * would show a single address. Every configured wallet is now listed at
 * once, so these guards are mostly about what must NOT come back: a network
 * picker, an address rendered blank while it loads, a per-asset minimum
 * quoted without the asset, or a chain whose address could not be resolved
 * shown anyway.
 */

const root = resolve(__dirname, '../../../..');
const frontend = resolve(root, 'frontend');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n');

function evaluate(file: string, imports: Record<string, unknown> = {}) {
  // `import.meta` is a module-only form and this runs the transpiled source
  // through `new Function`. Only the env lookup is rewritten — the value it
  // yields (undefined) is the same one a build without VITE_API_URL gets,
  // so the module still falls back to its own default.
  const code = ts.transpileModule(read(file).replace(/import\.meta\.env/g, '({} as any)'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const output: Record<string, any> = {};
  new Function('exports', 'require', code)(output, (name: string) => name.endsWith('.css') ? {} : imports[name] ?? req(name));
  return output;
}

const dictionaries = readDictionaries();
const language = (lang: (typeof LOCALES)[number] = 'ru') => ({
  lang,
  t: (key: string, params?: Record<string, string | number>) => {
    const template = dictionaries[lang][key] ?? key;
    return params ? template.replace(/\{(\w+)\}/g, (match: string, name: string) => String(params[name] ?? match)) : template;
  },
});

const { validDepositConfig } = evaluate('frontend/src/lib/depositMinimum.ts');

// Two chains, the shapes the real API returns: an EVM chain offering its
// native asset plus a token, and Tron offering only its TRC-20 token.
const WALLETS = [
  { chain: 'ethereum', address: '0x1111111111111111111111111111111111111111', assets: ['ETH', 'USDT'] },
  { chain: 'tron', address: 'TXYZexampleTronTreasuryAddress00000', assets: ['USDT'] },
];

function renderModal(state: Record<string, unknown>, lang: (typeof LOCALES)[number] = 'ru') {
  const mod = evaluate('frontend/src/components/DepositModal.tsx', {
    '../lib/useDepositOptions': { useDepositWallets: () => state },
    '../lib/i18n': { useLanguage: () => language(lang) },
  });
  return renderToStaticMarkup(React.createElement(mod.DepositModal, { onClose: () => undefined }));
}

const loaded = { loaded: true, wallets: WALLETS, minDepositUsd: 20, error: null };

describe('the deposit screen shows every wallet straight away', () => {
  it('prints all configured addresses, with no network to pick first', () => {
    const html = renderModal(loaded);

    for (const wallet of WALLETS) expect(html).toContain(wallet.address);
    // The picker is gone, not merely restyled: neither a <select> nor the
    // "Сеть" label it carried survives anywhere in the markup.
    expect(html).not.toContain('<select');
    expect(html).not.toContain(dictionaries.ru['deposit.network']);
  });

  it('names each network and the exact assets it will credit', () => {
    const html = renderModal(loaded);

    expect(html).toContain(dictionaries.ru['deposit.chain.ethereum']);
    expect(html).toContain(dictionaries.ru['deposit.chain.tron']);
    // Tron takes USDT only — TRX would be lost. The card must not widen the
    // list to the chain's native asset.
    const tronCard = html.slice(html.indexOf(WALLETS[1].address) - 400, html.indexOf(WALLETS[1].address));
    expect(tronCard).toContain('USDT');
    expect(tronCard).not.toContain('TRX');
  });

  it('gives every wallet its own copy button, distinguishable by network', () => {
    const html = renderModal(loaded);

    expect(html.split(dictionaries.ru['deposit.copy']).length - 1).toBeGreaterThanOrEqual(WALLETS.length);
    // A screen reader user hears six identically-labelled buttons otherwise.
    expect(html).toContain(`aria-label="${dictionaries.ru['deposit.copy']} — ${dictionaries.ru['deposit.chain.ethereum']}"`);
  });

  it('warns under each address, naming that wallet’s own assets and network', () => {
    const html = renderModal(loaded);

    // One warning per wallet, not one generic notice for all of them.
    expect(html.split('Отправляй на этот адрес только').length - 1).toBe(WALLETS.length);
    // Each names what THAT chain credits. Tron takes USDT only, so its
    // warning must not borrow Ethereum's pair.
    expect(html).toContain('только USDT в сеть TRC-20');
    expect(html).toContain('только ETH / USDT в сеть ERC-20');
    // The network name in the sentence is the bare network, never the card
    // heading: "only USDT on the USDT (TRC-20) network" is not a sentence.
    expect(html).not.toContain('в сеть USDT (TRC-20)');
    // Nothing renders with the placeholders still in place.
    expect(html).not.toContain('{assets}');
    expect(html).not.toContain('{chain}');
  });

  it('draws the warning in amber, not the red this app uses for a loss', () => {
    const html = renderModal(loaded);
    const block = html.slice(html.indexOf('<p style="background:'), html.indexOf('Отправляй'));

    // Sampled from the rendered style: red channel above blue, and not the
    // sell red. `--sell` must not appear on a warning at all.
    expect(block).toMatch(/background:rgba\(233, 173, 53/);
    expect(block).toMatch(/color:#e3b45c/);
    expect(block).not.toContain('var(--sell');
  });

  it('shows the minimum only once the real figure has arrived', () => {
    expect(renderModal(loaded)).toContain(dictionaries.ru['deposit.minAmountHint'].replace('{amount}', '20'));
    // Not a placeholder figure and not a spinner left behind by a failure.
    const failed = renderModal({ loaded: true, wallets: [], minDepositUsd: null, error: 'chains' });
    expect(failed).not.toContain('$');
    expect(failed).not.toContain(dictionaries.ru['deposit.loadingNetworks']);
    expect(failed).toContain(dictionaries.ru['deposit.loadChainsError']);
  });

  it('says it is loading before the config lands, and says nothing is configured after', () => {
    const loading = renderModal({ loaded: false, wallets: [], minDepositUsd: null, error: null });
    expect(loading).toContain(dictionaries.ru['deposit.loadingNetworks']);
    expect(loading).not.toContain(dictionaries.ru['deposit.noneConfigured']);

    const none = renderModal({ loaded: true, wallets: [], minDepositUsd: 20, error: null });
    expect(none).toContain(dictionaries.ru['deposit.noneConfigured']);
    expect(none).not.toContain(dictionaries.ru['deposit.loadingNetworks']);
  });

  it('still lists the wallets it did resolve when one chain failed, and says so', () => {
    const html = renderModal({ loaded: true, wallets: WALLETS, minDepositUsd: 20, error: 'address' });

    for (const wallet of WALLETS) expect(html).toContain(wallet.address);
    expect(html).toContain(dictionaries.ru['deposit.loadAddressError']);
  });

  it('carries the warning and every bare network name in all seven languages', () => {
    for (const code of LOCALES) {
      expect(typeof dictionaries[code]['deposit.warningAddress']).toBe('string');
      expect(dictionaries[code]['deposit.warningAddress'].length).toBeGreaterThan(20);
      // Both placeholders, or a locale would silently drop the asset or the
      // network from a warning about sending funds.
      expect(dictionaries[code]['deposit.warningAddress']).toContain('{assets}');
      expect(dictionaries[code]['deposit.warningAddress']).toContain('{chain}');
      for (const chain of ['bitcoin', 'tron', 'ethereum', 'bsc', 'solana', 'ton']) {
        expect(typeof dictionaries[code][`deposit.network.${chain}`]).toBe('string');
      }
      // The superseded combined warning is gone, not left behind unused.
      expect(dictionaries[code]['deposit.warningAll']).toBeUndefined();
    }
  });
});

describe('the address the screen prints', () => {
  const base = {
    minDepositUsd: 20,
    usdPeggedAssets: ['USDT'],
    chains: [{ chain: 'ethereum', nativeAsset: 'ETH', tokens: ['USDT'], supportedAssets: ['ETH', 'USDT'] }],
  };

  it('is accepted when the API carries it', () => {
    expect(validDepositConfig({ ...base, chains: [{ ...base.chains[0], address: '0xabc' }] })).toBe(true);
  });

  it('is tolerated when absent, because the frontend and the API deploy separately', () => {
    expect(validDepositConfig(base)).toBe(true);
  });

  it('is rejected when present but blank or not a string', () => {
    expect(validDepositConfig({ ...base, chains: [{ ...base.chains[0], address: '' }] })).toBe(false);
    expect(validDepositConfig({ ...base, chains: [{ ...base.chains[0], address: 123 }] })).toBe(false);
    expect(validDepositConfig({ ...base, chains: [{ ...base.chains[0], address: null }] })).toBe(false);
  });
});

describe('what this change deliberately leaves alone', () => {
  const hook = read('frontend/src/lib/useDepositOptions.ts');

  it('falls back to the per-chain route for an API that has not shipped the field', () => {
    expect(hook).toContain('api.getDepositAddress(chain.chain)');
    // And the fallback re-checks the response instead of trusting it: a
    // destination naming another chain, or an asset the config never listed,
    // is discarded.
    expect(hook).toContain('destination.chain !== chain.chain');
    expect(hook).toContain('chain.supportedAssets.includes(item)');
  });

  it('drops a wallet it could not resolve rather than rendering it blank', () => {
    expect(hook).toContain("wallet is DepositWallet => wallet !== null");
    expect(hook).toContain("wallets.length < value.chains.length ? 'address' : null");
  });

  it('puts the asset above the network on the Wallet page', () => {
    const walletModal = read('frontend/src/pages/wallet-v3/DepositModal.tsx');
    // Network-first left the user in front of an asset list that, on most
    // chains, held exactly one entry.
    expect(walletModal.indexOf('id="deposit-asset"')).toBeGreaterThan(-1);
    expect(walletModal.indexOf('id="deposit-asset"')).toBeLessThan(walletModal.indexOf('id="deposit-network"'));
    // The network list is narrowed to the chains that credit the chosen
    // asset, never the whole set.
    expect(walletModal).toContain('networks.map');
    expect(walletModal).not.toContain('chains.map');
  });

  it('keeps one deposit data path, not two', () => {
    // Both screens read the same wallets, so they cannot disagree about
    // which address belongs to which chain.
    expect(hook).toContain('export function useDepositWallets(active: boolean)');
    expect(hook).not.toMatch(/export function useDepositOptions\b/);
    expect(read('frontend/src/pages/wallet-v3/DepositModal.tsx')).toContain('useDepositWallets');
    expect(read('frontend/src/components/DepositModal.tsx')).toContain('useDepositWallets');
    // The deposit config is read through exactly one entry, and downloaded
    // in exactly one place behind it.
    expect(hook.match(/loadDepositConfig\(\)\.then/g)?.length).toBe(1);
    expect(hook.match(/await getDepositConfig\(\)/g)?.length).toBe(1);
  });

  it('narrows the network list to chains that actually credit the asset', () => {
    const selection = evaluate('frontend/src/lib/useDepositOptions.ts', {
      react: { useEffect: () => undefined, useMemo: (fn: () => unknown) => fn(), useState: (initial: unknown) => [initial, () => undefined] },
      './api': { api: {}, clearToken: () => undefined, getToken: () => null },
      './depositMinimum': { depositMinimumEquivalent: () => null, validDepositConfig: () => true },
    });
    const wallets = [
      { chain: 'bitcoin', address: 'a', assets: ['BTC'] },
      { chain: 'tron', address: 'b', assets: ['USDT'] },
      { chain: 'ethereum', address: 'c', assets: ['ETH', 'USDT'] },
    ];
    const state = selection.useDepositSelection(wallets);

    // Every asset any wallet credits, each once, in the order the backend
    // listed the chains.
    expect(state.assets).toEqual(['BTC', 'USDT', 'ETH']);
    // With no explicit choice it settles on the first asset and the first
    // chain that carries it — never a chain that does not.
    expect(state.asset).toBe('BTC');
    expect(state.networks.map((w: { chain: string }) => w.chain)).toEqual(['bitcoin']);
    expect(state.address).toBe('a');
  });

  it('never offers a network that would not credit the chosen asset', () => {
    const selection = evaluate('frontend/src/lib/useDepositOptions.ts', {
      react: { useEffect: () => undefined, useMemo: (fn: () => unknown) => fn(), useState: () => ['USDT', () => undefined] },
      './api': { api: {}, clearToken: () => undefined, getToken: () => null },
      './depositMinimum': { depositMinimumEquivalent: () => null, validDepositConfig: () => true },
    });
    const state = selection.useDepositSelection([
      { chain: 'bitcoin', address: 'a', assets: ['BTC'] },
      { chain: 'tron', address: 'b', assets: ['USDT'] },
      { chain: 'ethereum', address: 'c', assets: ['ETH', 'USDT'] },
    ]);

    // USDT rides two chains; Bitcoin credits none of it and must not appear.
    expect(state.networks.map((w: { chain: string }) => w.chain)).toEqual(['tron', 'ethereum']);
    expect(state.networks.every((w: { assets: string[] }) => w.assets.includes('USDT'))).toBe(true);
  });
});

describe('the addresses are downloaded again only when they change', () => {
  const config = (address: string, version?: string) => ({
    chains: [{ chain: 'tron', nativeAsset: 'TRX', tokens: ['USDT'], supportedAssets: ['USDT'], address }],
    minDepositUsd: 10, usdPeggedAssets: ['USDT'], ...(version ? { version } : {}),
  });
  const realFetch = globalThis.fetch;
  const realStorage = (globalThis as any).localStorage;
  let store: Map<string, string>;
  let calls: string[];
  let server: { config: unknown; version: string | null; down?: boolean };

  beforeEach(() => {
    store = new Map();
    calls = [];
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
    globalThis.fetch = (async (url: string) => {
      calls.push(url.replace('/api/v1', ''));
      if (server.down) throw new Error('offline');
      const body = url.includes('/deposit-config-version') ? { version: server.version } : server.config;
      return { ok: true, status: 200, json: async () => body } as any;
    }) as any;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    (globalThis as any).localStorage = realStorage;
  });

  /** A fresh module each time, as after a page reload: only the device copy carries over. */
  const load = () => evaluate('frontend/src/lib/useDepositOptions.ts', {
    react: { useEffect: () => undefined, useMemo: (fn: () => unknown) => fn(), useState: (initial: unknown) => [initial, () => undefined] },
    './api': { api: {}, clearToken: () => undefined, getToken: () => 'token' },
    './depositMinimum': { depositMinimumEquivalent: () => null, validDepositConfig },
  });

  it('downloads once, then only asks the fingerprint while it matches', async () => {
    server = { config: config('T-old', 'v1'), version: 'v1' };
    expect((await load().loadDepositConfig()).chains[0].address).toBe('T-old');
    expect(calls).toEqual(['/deposit-chains?includeConfig=true']);

    calls = [];
    expect((await load().loadDepositConfig()).chains[0].address).toBe('T-old');
    expect(calls).toEqual(['/deposit-config-version']);
  });

  it('downloads the new addresses as soon as the fingerprint differs', async () => {
    server = { config: config('T-old', 'v1'), version: 'v1' };
    await load().loadDepositConfig();

    server = { config: config('T-new', 'v2'), version: 'v2' };
    calls = [];
    expect((await load().loadDepositConfig()).chains[0].address).toBe('T-new');
    expect(calls).toEqual(['/deposit-config-version', '/deposit-chains?includeConfig=true']);
    // And the new list is what the device keeps from now on.
    calls = [];
    expect((await load().loadDepositConfig()).chains[0].address).toBe('T-new');
    expect(calls).toEqual(['/deposit-config-version']);
  });

  it('keeps nothing it could not confirm later: no fingerprint, or a chain without an address', async () => {
    server = { config: config('T-old'), version: null };
    await load().loadDepositConfig();
    expect(store.size).toBe(0);

    server = { config: { ...config('', 'v1') }, version: 'v1' };
    await load().loadDepositConfig();
    expect(store.size).toBe(0);
  });

  it('fails closed when the server cannot be reached, even with a copy on the device', async () => {
    server = { config: config('T-old', 'v1'), version: 'v1' };
    await load().loadDepositConfig();

    server = { ...server, down: true };
    await expect(load().loadDepositConfig()).rejects.toThrow('offline');
  });

  it('lets an open join the check a hover started instead of asking twice', async () => {
    server = { config: config('T-old', 'v1'), version: 'v1' };
    const hook = load();
    hook.prefetchDepositConfig();
    await hook.loadDepositConfig();
    expect(calls).toEqual(['/deposit-chains?includeConfig=true']);
  });

  it('never draws the device copy before the fingerprint confirms it', () => {
    const source = read('frontend/src/lib/useDepositOptions.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const effect = source.slice(source.indexOf('export function useDepositWallets'));
    expect(effect).not.toContain('readStoredConfig');
    expect(effect).toContain('setState(empty);');
  });
});
