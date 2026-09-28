const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fromAdminWallets, fromUiSnapshot, fetchAdminWallets, buildReview } = require('./export-deposit-catalogue-baseline.cjs');
const address = '0x' + '1'.repeat(40);
const wallets = () => ['bitcoin', 'tron', 'ethereum', 'bsc', 'solana', 'ton'].map(chain => ({ chain,
  envConfigured: chain === 'ethereum', nativeAsset: 'ETH', nativeDepositsSupported: true,
  tokens: chain === 'ethereum' ? ['USDT', 'USDC'] : [], address: chain === 'ethereum' ? address : null }));
test('export resolves all backend rails, preserves USDT/USDC on shared address, no synthetic fallback', () => {
  const data = fromAdminWallets(wallets());
  const result = buildReview({ mode: 'test' }, data, '2026-09-28');
  assert.equal(result.rails, 3); assert.equal(result.unconfiguredChains.length, 5);
  assert.ok(result.document.baseline.every(r => r.address === address)); assert.deepEqual(result.document.overrides, []);
});
test('missing chain, duplicate chain, unknown token and unsupported network fail rather than omit', () => {
  assert.throws(() => fromAdminWallets(wallets().slice(1)), /Incomplete/);
  const duplicate = wallets(); duplicate[0] = duplicate[1]; assert.throws(() => fromAdminWallets(duplicate), /Incomplete/);
  const unknown = wallets(); unknown[2].tokens.push('UNKNOWN'); assert.throws(() => fromAdminWallets(unknown), /Unmapped/);
  const unconfigured = wallets(); unconfigured[0].address = 'unexpected'; assert.throws(() => fromAdminWallets(unconfigured), /override/);
});
test('empty configured address preserved as disabled; malformed address cannot produce baseline', () => {
  const input = wallets(); input[2].address = ''; assert.ok(fromAdminWallets(input).entries.every(e => !e.enabled));
  input[2].address = 'invalid'; assert.throws(() => buildReview({}, fromAdminWallets(input), ''), /Invalid/);
});
test('HTTP export only GET, no redirect, bounded timeout; credential never in review', async () => {
  let calls = 0;
  const data = await fetchAdminWallets('https://example.invalid/api/v1', 'synthetic-private', async (url, options) => {
    calls++; assert.equal(url, 'https://example.invalid/api/v1/admin/wallets'); assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal); return Response.json(wallets());
  });
  assert.equal(calls, 1); assert.ok(!JSON.stringify(buildReview({}, fromAdminWallets(data), '')).includes('synthetic-private'));
  await assert.rejects(fetchAdminWallets('http://example.invalid', 'x'), /HTTPS/);
  await assert.rejects(fetchAdminWallets('https://example.invalid', ''), /credential/);
  await assert.rejects(fetchAdminWallets('https://example.invalid', 'x', async () => new Response('', { status: 403 })), /403/);
});
test('complete UI snapshot supported without extracting browser session secrets; incomplete inventory rejected', () => {
  const input = { sourceUrl: 'https://example.invalid/admin/wallets', totalRails: 1, totalNetworks: 1,
    rows: [{ asset: 'ETH', networkName: 'Ethereum', standard: 'Native', address, status: 'Адрес задан' }],
    notes: ['Не настроены на backend: Bitcoin Network, TRON, BNB Smart Chain, Solana, TON. Поддерживаемые активы для них не заявлены.'] };
  assert.equal(fromUiSnapshot(input).entries.length, 1);
  assert.throws(() => fromUiSnapshot({ ...input, totalRails: 2 }), /Incomplete/);
  assert.throws(() => fromUiSnapshot({ ...input, notes: [] }), /inventory/);
});
