import { depositRails, railDisplay, addressAdvice } from '../../pages/admin/depositRails';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const configured = (chain: string, nativeAsset: string, tokens: string[]) => ({ chain, nativeAsset, tokens, address: 'public-address', envConfigured: true });
test('USDT TRON and Ethereum native/token vocabulary is unambiguous', () => {
  expect(railDisplay('USDT', 'tron').label).toBe('USDT · TRON (TRC-20)');
  expect(railDisplay('USDT', 'TRC20').label).toBe('USDT · TRON (TRC-20)');
  expect(railDisplay('ETH', 'ethereum').label).toBe('ETH · Ethereum (Native)');
  expect(railDisplay('USDT', 'ERC-20').label).toBe('USDT · Ethereum (ERC-20)');
  expect(railDisplay('USDT', 'BEP20').label).toBe('USDT · BNB Smart Chain (BEP-20)');
  expect(railDisplay('ANY', 'unknown network')).toMatchObject({ network: 'unknown network', standard: '—' });
  expect(railDisplay('ETH', 'native').network).toBe('native'); // free-text withdrawals do not prove a chain
});
test('configured ETH and ERC-20 rails share one exact wallet and affected list', () => {
  const wallet = configured('ethereum', 'ETH', ['USDT', 'USDC']);
  const rails = depositRails([wallet]);
  expect(rails.map(r => r.label)).toEqual(['ETH · Ethereum (Native)', 'USDC · Ethereum (ERC-20)', 'USDT · Ethereum (ERC-20)']);
  expect(rails.every(r => r.wallet === wallet && r.shared)).toBe(true);
});
test('no native TRX, unconfigured rails, or invented USDT support', () => {
  expect(depositRails([configured('tron', 'TRX', ['USDT'])]).map(r => r.asset)).toEqual(['USDT']);
  expect(depositRails([configured('tron', 'TRX', [])])).toEqual([]);
  expect(depositRails([{ ...configured('ethereum', 'ETH', ['USDT']), envConfigured: false }])).toEqual([]);
  expect(depositRails([configured('solana', 'SOL', [])]).map(r => r.asset)).toEqual(['SOL']);
  expect(depositRails([{ ...configured('future', 'X', ['Y']), nativeDepositsSupported: false }]).map(r => r.asset)).toEqual(['Y']);
});
test.each([['bitcoin', 'BTC', '', 'Native'], ['solana', 'SOL', 'USDT', 'SPL'], ['ton', 'TON', 'USDT', 'Jetton'], ['bsc', 'BNB', 'USDT', 'BEP-20']])('derive %s only from config', (chain, native, token, standard) => {
  const rails = depositRails([configured(chain, native, token ? [token] : [])]);
  expect(rails.find(r => r.asset === (token || native))?.standard).toBe(standard);
});
test('conservative warnings preserve legitimate alternative address families', () => {
  for (const [chain, address] of [['ton', `0:${'ab'.repeat(32)}`], ['ton', 'UQ' + 'a'.repeat(46)], ['bitcoin', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'], ['bitcoin', 'bc1p' + 'q'.repeat(58)], ['tron', '41' + 'a'.repeat(40)], ['ethereum', '0x' + 'aB'.repeat(20)]]) {
    expect(addressAdvice(chain, address).error).toBeUndefined();
    expect(addressAdvice(chain, address).warning).toBeTruthy();
  }
  expect(addressAdvice('tron', '0x' + 'a'.repeat(40)).error).toBeTruthy();
  expect(addressAdvice('ethereum', 'T' + 'a'.repeat(33)).error).toBeTruthy();
  expect(addressAdvice('ethereum', 'https://wallet.invalid/receive').error).toBeTruthy();
  expect(addressAdvice('ethereum', 'word '.repeat(12)).error).toBeTruthy();
});
test('Products admin surface is removed and overview remains lazy behind admin layout', () => {
  const root = resolve(__dirname, '../../..');
  const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
  const nav = readFileSync(resolve(root, 'src/pages/admin/AdminLayout.tsx'), 'utf8');
  const api = readFileSync(resolve(root, 'src/lib/api.ts'), 'utf8');
  expect(app).not.toContain('AdminProductsPage');
  expect(nav).not.toContain('/admin/products');
  expect(api).not.toMatch(/getAdminProducts|createProduct:|updateProduct:|deleteProduct:/);
  expect(existsSync(resolve(root, 'src/pages/admin/AdminProductsPage.tsx'))).toBe(false);
  expect(app).toContain('const AdminOverviewPage = lazy(');
  expect(app).toContain('<Route index element={<AdminOverviewPage />} />');
  expect(nav).toContain('useAdminGate()');
  expect(nav).toContain("status === 'denied'");
});
