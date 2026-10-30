import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureFinalizedCoverage } from './stocks-capture-clmm-coverage.mjs';
import { b58, MAINNET_GENESIS, PILOTS } from './stocks-verify-clmm-proof.mjs';
import { RPC_ENDPOINT } from './stocks-source-pipeline-coverage.mjs';

// All packets in this file are isolated synthetic fixtures, never market evidence.
const start = Date.parse('2026-10-01T00:00:00Z') / 1000;
const from = new Date(start * 1000).toISOString(), to = new Date((start + 60) * 1000).toISOString();
const publicKey = byte => b58(Buffer.alloc(32, byte));
const sig = byte => b58(Buffer.alloc(64, byte));

async function fixture(fn, { ticker = 'SPYx', mutate, failed = false } = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'voltex-coverage-capture-test-')), out = join(parent, 'packet');
  let milliseconds = (start + 180) * 1000, slotReads = 0;
  const calls = [], sleeps = [], pool = PILOTS[ticker].pool;
  const row = (slot, blockTime, byte, err = null) => ({ slot, blockTime, signature: sig(byte), confirmationStatus: 'finalized', err });
  const rows = [row(105, start + 60, 5), row(102, start + 20, 2, failed ? 'AccountInUse' : null), row(100, start - 1, 1)];
  const blocks = Object.fromEntries([[100, 99, start - 1, 1], [102, 100, start + 20, 2], [105, 102, start + 60, 5]].map(([slot, previous, time, byte]) => [slot, {
    blockTime: time, blockhash: publicKey(slot), previousBlockhash: publicKey(previous), parentSlot: previous,
    transactions: [{ version: 1, transaction: { signatures: [sig(byte)], message: {
      accountKeys: [pool], instructions: [], transactionConfig: {},
    } }, meta: { err: slot === 102 && failed ? 'AccountInUse' : null } }],
  }]));
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(url, RPC_ENDPOINT); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['content-type'], 'application/json');
    calls.push({ ...request, at: milliseconds });
    let value;
    if (request.method === 'getGenesisHash') value = MAINNET_GENESIS;
    else if (request.method === 'getSlot') value = 200 + slotReads++;
    else if (request.method === 'getSignaturesForAddress') value = structuredClone(rows);
    else if (request.method === 'getBlocks') value = [100, 102, 105];
    else if (request.method === 'getBlock') {
      assert.equal(request.params[1].maxSupportedTransactionVersion, 1);
      assert.equal(request.params[1].transactionDetails, 'full');
      value = structuredClone(blocks[request.params[0]]);
    } else assert.fail('Unexpected method ' + request.method);
    const response = mutate ? await mutate({ request, value, index: calls.length, calls }) : undefined;
    return response ?? Response.json({ jsonrpc: '2.0', id: request.id, result: value });
  };
  const options = { ticker, from, to, out };
  const hooks = { fetchImpl, now: () => milliseconds, sleep: async ms => { sleeps.push(ms); milliseconds += ms; } };
  try { return await fn({ options, hooks, calls, sleeps, parent, out }); }
  finally { await rm(parent, { recursive: true, force: true }); }
}

for (const ticker of ['SPYx', 'CRCLx']) test('captures a complete synthetic minute for ' + ticker + ' without admitting prices', () => fixture(async ({ options, hooks, calls, sleeps, out }) => {
  const result = await captureFinalizedCoverage(options, hooks);
  assert.equal(result.manifest.status, 'CAPTURED_UNVERIFIED');
  assert.equal(calls.length, 8); assert.equal(result.manifest.metrics.rpcAttempts, 8);
  assert.equal(result.manifest.metrics.rpcCompletions, 8);
  assert.deepEqual(result.manifest.slotRange, { from: 100, to: 105 });
  assert(sleeps.every(ms => ms === 3000));
  assert(calls.every((call, i) => !i || call.at - calls[i - 1].at >= 3000));
  assert.equal(result.verification.receiptCoverageVerified, true);
  assert.equal(result.verification.coverage.producedBlockCount, 3);
  assert.equal(result.verification.coverage.successfulPoolTransactions, 1);
  assert.equal(result.verification.acceptedIntervals, 0); assert.deepEqual(result.verification.candles, []);
  assert.equal(result.verification.gates.programIdentity, false);
  assert.equal(result.manifest.productionReady, false); assert.equal(result.manifest.ohlcv, null);
  const bytes = await readFile(join(out, 'manifest.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), result.manifestSha256);
  assert.equal(JSON.parse(await readFile(join(out, 'coverage-report.json'), 'utf8')).manifestSha256, result.manifestSha256);
}, { ticker }));

test('failed pool transactions remain in coverage and never become trades', () => fixture(async ({ options, hooks }) => {
  const result = await captureFinalizedCoverage(options, hooks);
  assert.equal(result.verification.receiptCoverageVerified, true);
  assert.equal(result.verification.coverage.failedPoolTransactions, 1);
  assert.equal(result.verification.coverage.successfulPoolTransactions, 0);
  assert.deepEqual(result.verification.candles, []);
}, { failed: true }));

for (const status of [403, 429, 503]) test('HTTP ' + status + ' is retained once and never retried or routed elsewhere', () => fixture(async ({ options, hooks, calls, out }) => {
  const result = await captureFinalizedCoverage(options, hooks);
  assert.equal(calls.length, 1); assert.equal(result.manifest.status, 'BLOCKED');
  assert.deepEqual(result.manifest.blockers, ['HTTP_' + status]);
  assert.equal(result.manifest.receipts[0].httpStatus, status);
  assert.equal(result.manifest.metrics.rpcCompletions, 0);
  assert.equal(result.manifest.metrics.automaticRetries, 0);
  assert.equal(result.manifest.metrics.monetarySpend, 0);
  assert.equal(result.verification, null);
  assert.equal(await readFile(join(out, 'receipt-001.json'), 'utf8'), '{"error":"denied"}');
}, { mutate: () => new Response('{"error":"denied"}', { status }) }));

test('transport failure records one attempt without leaking raw error or proxy credentials', () => fixture(async ({ options, hooks, calls }) => {
  const result = await captureFinalizedCoverage(options, hooks);
  assert.equal(calls.length, 1);
  assert.deepEqual(result.manifest.blockers, ['NETWORK_OR_IO_FAILURE']);
  assert.equal(result.manifest.receipts.length, 0);
  assert(!JSON.stringify(result).includes('secret-value'));
}, { mutate: () => { throw Error('https://user:secret-value@proxy.invalid'); } }));

test('wrong cluster stops before fetching any signatures or blocks', () => fixture(async ({ options, hooks, calls }) => {
  const result = await captureFinalizedCoverage(options, hooks);
  assert.equal(calls.length, 1); assert.deepEqual(result.manifest.blockers, ['WRONG_NETWORK']);
}, { mutate: ({ request }) => Response.json({ jsonrpc: '2.0', id: request.id, result: 'different-network' }) }));

test('invalid JSON and mismatched JSON-RPC identity cannot progress', async () => {
  for (const response of [() => new Response('not JSON'), () => Response.json({ jsonrpc: '2.0', id: 999, result: MAINNET_GENESIS })]) {
    await fixture(async ({ options, hooks, calls }) => {
      const result = await captureFinalizedCoverage(options, hooks);
      assert.equal(calls.length, 1); assert.equal(result.manifest.status, 'BLOCKED');
      assert.equal(result.verification, null);
    }, { mutate: response });
  }
});

test('unsupported transaction RPC error stops without retrying an older version or omitting the block', () => fixture(async ({ options, hooks, calls }) => {
  const result = await captureFinalizedCoverage(options, hooks);
  assert.equal(calls.length, 5); assert.deepEqual(result.manifest.blockers, ['RPC_-32015']);
  assert.equal(calls.at(-1).params[1].maxSupportedTransactionVersion, 1);
  assert.equal(result.verification, null);
}, { mutate: ({ request }) => request.method === 'getBlock'
  ? Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32015, message: 'unsupported' } }) : undefined }));

test('null full block is not treated as a no-trade interval', () => fixture(async ({ options, hooks, calls }) => {
  const result = await captureFinalizedCoverage(options, hooks);
  assert.equal(calls.length, 5); assert.deepEqual(result.manifest.blockers, ['FULL_BLOCK_UNAVAILABLE']);
  assert.equal(result.manifest.acceptedIntervals, 0);
}, { mutate: ({ request }) => request.method === 'getBlock' ? Response.json({ jsonrpc: '2.0', id: request.id, result: null }) : undefined }));

test('signature gaps and duplicates stop before a full block request', async () => {
  for (const change of [rows => rows.slice(0, 2), rows => [rows[0], rows[0], rows[2]], rows => rows.map(row => ({ ...row, blockTime: null }))]) {
    await fixture(async ({ options, hooks, calls }) => {
      const result = await captureFinalizedCoverage(options, hooks);
      assert.equal(calls.length, 3); assert.equal(result.manifest.status, 'BLOCKED');
      assert.equal(result.verification, null);
    }, { mutate: ({ request, value }) => request.method === 'getSignaturesForAddress'
      ? Response.json({ jsonrpc: '2.0', id: request.id, result: change(value) }) : undefined });
  }
});

test('tight request budget refuses the complete block phase instead of taking a partial sample', () => fixture(async ({ options, hooks, calls }) => {
  const result = await captureFinalizedCoverage({ ...options, maxRpcAttempts: 4 }, hooks);
  assert.equal(calls.length, 4); assert.deepEqual(result.manifest.blockers, ['RPC_BUDGET_EXHAUSTED']);
  assert.equal(result.verification, null);
}));

test('produced block cap is enforced before any block data request', () => fixture(async ({ options, hooks, calls }) => {
  const result = await captureFinalizedCoverage({ ...options, maxProducedBlocks: 2 }, hooks);
  assert.equal(calls.length, 4); assert.deepEqual(result.manifest.blockers, ['PRODUCED_SLOTS_INCOMPLETE_OR_BUDGET']);
}));

test('oversized response is cancelled and never followed by another request', () => fixture(async ({ options, hooks, calls }) => {
  const result = await captureFinalizedCoverage(options, hooks);
  assert.equal(calls.length, 1); assert.deepEqual(result.manifest.blockers, ['RESPONSE_TOO_LARGE']);
}, { mutate: () => new Response('{}', { headers: { 'content-length': '2500001' } }) }));

test('existing output directories are refused without overwriting or network access', () => fixture(async ({ options, hooks, calls, out }) => {
  await mkdir(out); await writeFile(join(out, 'manifest.json'), 'existing-evidence');
  await assert.rejects(captureFinalizedCoverage(options, hooks), { code: 'EEXIST' });
  assert.equal(calls.length, 0); assert.equal(await readFile(join(out, 'manifest.json'), 'utf8'), 'existing-evidence');
}));

test('unsupported pilots, active minutes and relaxed budgets fail before acquisition', () => fixture(async ({ options, hooks, calls }) => {
  for (const delta of [{ ticker: 'UNKNOWN' }, { to: from }, { from: new Date((start + 150) * 1000).toISOString(), to: new Date((start + 210) * 1000).toISOString() },
    { from: '2026-10-01T00:00Z', to: '2026-10-01T00:01Z' },
    { from: '2026-02-30T00:00:00Z', to: '2026-02-30T00:01:00Z' },
    { maxRpcAttempts: 226 }, { minimumSpacingMs: 2999 }, { maxProducedBlocks: 201 }, { maxSignaturePages: 4 }]) {
    await assert.rejects(captureFinalizedCoverage({ ...options, ...delta }, hooks));
  }
  assert.equal(calls.length, 0);
}));

test('packet verifier rejects corrupted block ancestry even after successful HTTP collection', () => fixture(async ({ options, hooks, calls }) => {
  const result = await captureFinalizedCoverage(options, hooks);
  assert.equal(calls.length, 8); assert.equal(result.manifest.status, 'CAPTURED_UNVERIFIED');
  assert.equal(result.verification.receiptCoverageVerified, false); assert.equal(result.verification.acceptedIntervals, 0);
  assert.deepEqual(result.verification.candles, []);
}, { mutate: ({ request, value }) => request.method === 'getBlock' && request.params[0] === 102
  ? Response.json({ jsonrpc: '2.0', id: request.id, result: { ...value, parentSlot: 101 } }) : undefined }));

test('15-minute time cap stops further requests rather than waiting indefinitely', () => fixture(async ({ options, hooks, calls }) => {
  const result = await captureFinalizedCoverage(options, { ...hooks, sleep: async ms => hooks.sleep(ms + 15 * 60 * 1000) });
  assert.equal(calls.length, 1); assert.deepEqual(result.manifest.blockers, ['CAPTURE_TIME_BUDGET']);
}));

test('unsupported or disabled native proxy configurations fail before network access', async () => {
  const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NODE_OPTIONS', 'NODE_USE_ENV_PROXY'];
  const configurations = [
    { args: [], env: { HTTPS_PROXY: 'http://127.0.0.1:9', NODE_USE_ENV_PROXY: '1' } },
    { args: ['--use-env-proxy'], env: { ALL_PROXY: 'http://127.0.0.1:9' } },
    { args: ['--use-env-proxy', '--no_use_env_proxy'], env: { HTTPS_PROXY: 'http://127.0.0.1:9' } },
    { args: ['--use-env-proxy', '--use-env-proxy=false'], env: { HTTPS_PROXY: 'http://127.0.0.1:9' } },
    { args: ['--use-env-proxy'], env: { HTTPS_PROXY: 'http://127.0.0.1:9', NODE_OPTIONS: '"--no_use_env_proxy"' } },
  ];
  for (const configuration of configurations) await fixture(async ({ options, hooks }) => {
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const savedArgs = process.execArgv, savedFetch = globalThis.fetch; let networkCalls = 0;
    try {
      for (const key of keys) delete process.env[key];
      Object.assign(process.env, configuration.env); process.execArgv = configuration.args;
      globalThis.fetch = async () => { networkCalls++; throw Error('UNEXPECTED_NETWORK'); };
      const result = await captureFinalizedCoverage(options, { ...hooks, fetchImpl: undefined });
      assert.equal(networkCalls, 0); assert.equal(result.manifest.metrics.rpcAttempts, 0);
      assert.deepEqual(result.manifest.blockers, ['CONFIGURED_PROXY_TRANSPORT_REQUIRED']);
    } finally {
      process.execArgv = savedArgs; globalThis.fetch = savedFetch;
      for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  });
});
