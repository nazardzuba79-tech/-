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
  const code = ts.transpileModule(read(file), { compilerOptions: {
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

  it('warns once about network and asset, rather than six times', () => {
    const html = renderModal(loaded);

    expect(html).toContain(dictionaries.ru['deposit.warningAll']);
    expect(html.split(dictionaries.ru['deposit.warningAll']).length - 1).toBe(1);
    // The old per-card warning took {assets} and {chain}; nothing may render
    // it with the placeholders still in place.
    expect(html).not.toContain('{assets}');
    expect(html).not.toContain('{chain}');
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

  it('carries the new warning in all seven languages', () => {
    for (const code of LOCALES) {
      expect(typeof dictionaries[code]['deposit.warningAll']).toBe('string');
      expect(dictionaries[code]['deposit.warningAll'].length).toBeGreaterThan(20);
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

  it('leaves the Wallet page deposit modal on its approved design', () => {
    const walletModal = read('frontend/src/pages/wallet-v3/DepositModal.tsx');
    expect(walletModal).toContain('useDepositOptions');
    expect(walletModal).not.toContain('useDepositWallets');
    // Its network/asset selects are part of the approved archive layout.
    expect(walletModal).toContain('deposit-network');
    expect(walletModal).toContain('deposit-asset');
  });

  it('leaves useDepositOptions itself intact for the callers that use it', () => {
    expect(hook).toContain('export function useDepositOptions(active: boolean)');
    expect(hook).toContain('minEquivalent');
  });
});
