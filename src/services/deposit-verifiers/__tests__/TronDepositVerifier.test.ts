import { TronDepositVerifier } from '../TronDepositVerifier';
import { DepositVerificationError, ProviderUnavailableError, TransferNotFoundError } from '../errors';
import { ChainConfig } from '../../../config/chains';

const TREASURY = '411111111111111111111111111111111111111111';
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_HEX = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TX = 'ab'.repeat(32);

const chainConfig: ChainConfig = {
  chain: 'tron',
  type: 'tron',
  treasuryAddress: TREASURY,
  minConfirmations: 19,
  nativeAsset: 'TRX',
  tokens: { USDT: { contractAddress: USDT_CONTRACT, decimals: 6 } },
  apiUrl: 'https://mock-trongrid',
};

function jsonResponse(body: any, ok = true, status = 200, headers: Record<string, string> = {}) {
  return { ok, status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, json: () => Promise.resolve(body) } as unknown as Response;
}
const log = (to: string, raw: bigint, contract = USDT_HEX) => ({
  address: contract, topics: [TOPIC, '0'.repeat(24) + '55'.repeat(20), '0'.repeat(24) + to.slice(2)], data: raw.toString(16).padStart(64, '0'),
});
const info = (extra: any = {}) => ({ id: TX, blockNumber: 1000, blockTimeStamp: 1_700_000_000_000, receipt: { result: 'SUCCESS' }, log: [log(TREASURY, BigInt(5_000_000))], ...extra });

/** fetch stub routing by path: solidity info, full-node info, head block. */
function node({ solidity, full, head = 1018 }: { solidity?: any; full?: any; head?: number }): jest.Mock & typeof fetch {
  return jest.fn(async (url: any) => {
    if (url.includes('/walletsolidity/gettransactioninfobyid')) return jsonResponse(solidity ?? {});
    if (url.includes('/wallet/gettransactioninfobyid')) return jsonResponse(full ?? {});
    if (url.includes('/wallet/getnowblock')) return jsonResponse({ block_header: { raw_data: { number: head } } });
    throw new Error(`unexpected ${url}`);
  }) as any;
}

describe('TronDepositVerifier (node-level proof)', () => {
  it('rejects an asset with no configured TRC-20 contract', async () => {
    const verifier = new TronDepositVerifier(chainConfig, jest.fn());
    await expect(verifier.verify(TX, 'FAKE')).rejects.toThrow('Unsupported asset on Tron');
  });

  it('refuses a configured "USDT" whose contract is not the allowlisted mainnet contract', async () => {
    const fake: ChainConfig = { ...chainConfig, tokens: { USDT: { contractAddress: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf', decimals: 6 } } };
    await expect(new TronDepositVerifier(fake, jest.fn()).prove(TX, 'USDT')).rejects.toThrow('allowlist');
    const decimals: ChainConfig = { ...chainConfig, tokens: { USDT: { contractAddress: USDT_CONTRACT, decimals: 18 } } };
    await expect(new TronDepositVerifier(decimals, jest.fn()).prove(TX, 'USDT')).rejects.toThrow('allowlist');
  });

  it('proves a solidified SUCCESS transfer: exact amount, measured confirmations, block time, finalized', async () => {
    const proof = await new TronDepositVerifier(chainConfig, node({ solidity: info() })).prove(TX, 'USDT');
    expect(proof.amount.toString()).toBe('5');
    expect(proof.confirmations).toBe(19);
    expect(proof.finalized).toBe(true);
    expect(proof.blockNumber).toBe(1000);
    expect(proof.blockTimestamp?.toISOString()).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('a mined but not yet solidified transaction is proven with finalized=false', async () => {
    const proof = await new TronDepositVerifier(chainConfig, node({ full: info(), head: 1002 })).prove(TX, 'USDT');
    expect(proof.finalized).toBe(false);
    expect(proof.confirmations).toBe(3);
  });

  it('sums several matching Transfer logs in one transaction and ignores other recipients/contracts', async () => {
    const solidity = info({ log: [log(TREASURY, BigInt(1_000_000)), log(TREASURY, BigInt(2_500_000)), log('41' + '22'.repeat(20), BigInt(9_000_000)), log(TREASURY, BigInt(7_000_000), '33'.repeat(20))] });
    const proof = await new TronDepositVerifier(chainConfig, node({ solidity })).prove(TX, 'USDT');
    expect(proof.amount.toString()).toBe('3.5');
  });

  it('rejects a failed transaction, a transfer from another contract, and a transfer to another address', async () => {
    const v = (solidity: any) => new TronDepositVerifier(chainConfig, node({ solidity })).prove(TX, 'USDT');
    await expect(v(info({ result: 'FAILED', receipt: { result: 'REVERT' } }))).rejects.toThrow('failed on chain');
    await expect(v(info({ log: [log(TREASURY, BigInt(5), '33'.repeat(20))] }))).rejects.toThrow('no allowlisted token transfer');
    await expect(v(info({ log: [log('41' + '22'.repeat(20), BigInt(5))] }))).rejects.toThrow('no allowlisted token transfer');
  });

  it('checks the recipient it is given (a retired treasury address)', async () => {
    const old = '41' + '44'.repeat(20);
    const proof = await new TronDepositVerifier(chainConfig, node({ solidity: info({ log: [log(old, BigInt(1_000_000))] }) })).prove(TX, 'USDT', { recipient: old });
    expect(proof.amount.toString()).toBe('1');
    expect(proof.recipient).toBe(old);
  });

  it('an unknown transaction is TransferNotFound, not a provider failure', async () => {
    await expect(new TronDepositVerifier(chainConfig, node({})).prove(TX, 'USDT')).rejects.toBeInstanceOf(TransferNotFoundError);
  });

  it('network failure, HTTP 429 (with Retry-After) and 5xx are ProviderUnavailable, never "no deposit"', async () => {
    await expect(new TronDepositVerifier(chainConfig, jest.fn().mockRejectedValue(new Error('timeout'))).prove(TX, 'USDT')).rejects.toBeInstanceOf(ProviderUnavailableError);
    const limited = new TronDepositVerifier(chainConfig, jest.fn().mockResolvedValue(jsonResponse({}, false, 429, { 'retry-after': '30' })));
    const err = await limited.prove(TX, 'USDT').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect(err.retryAfterMs).toBe(30_000);
    await expect(new TronDepositVerifier(chainConfig, jest.fn().mockResolvedValue(jsonResponse({}, false, 503))).prove(TX, 'USDT')).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(ProviderUnavailableError.prototype).toBeInstanceOf(DepositVerificationError);
  });

  it('uses a head block supplied by the caller instead of asking again', async () => {
    const fetchFn = node({ solidity: info() });
    const proof = await new TronDepositVerifier(chainConfig, fetchFn).prove(TX, 'USDT', { headBlock: 1100 });
    expect(proof.confirmations).toBe(101);
    expect(fetchFn.mock.calls.some(([u]: any) => String(u).includes('getnowblock'))).toBe(false);
  });

  it('sends the TRON-PRO-API-KEY header when configured', async () => {
    const fetchFn = node({ solidity: info() });
    await new TronDepositVerifier({ ...chainConfig, apiKey: 'secret' }, fetchFn).prove(TX, 'USDT');
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('/walletsolidity/'), expect.objectContaining({ headers: expect.objectContaining({ 'TRON-PRO-API-KEY': 'secret' }) }));
  });

  describe('listIncoming (display feed only)', () => {
    it('lists recent transfers without inventing a confirmation count', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ data: [] })).mockResolvedValueOnce(jsonResponse({
        data: [
          { transaction_id: 'tx-a', to: TREASURY, value: '5000000', block_timestamp: 1700000000000 },
          { transaction_id: 'tx-b', to: TREASURY, value: '1250000', block_timestamp: 1700000100000 },
        ],
      }));
      const result = await new TronDepositVerifier(chainConfig, fetchFn).listIncoming();
      expect(result).toEqual([
        { txHash: 'tx-a', asset: 'USDT', amount: '5', confirmations: null, timestamp: new Date(1700000000000).toISOString() },
        { txHash: 'tx-b', asset: 'USDT', amount: '1.25', confirmations: null, timestamp: new Date(1700000100000).toISOString() },
      ]);
    });

    it('a malformed list is a provider error, not an empty success', async () => {
      await expect(new TronDepositVerifier(chainConfig, jest.fn().mockResolvedValue(jsonResponse({ nope: true }))).listIncoming()).rejects.toBeInstanceOf(ProviderUnavailableError);
    });
  });
});

describe('native TRX proof (#693)', () => {
  const body = (overrides: any = {}) => ({ txID: TX, ret: [{ contractRet: 'SUCCESS' }], raw_data: { contract: [{
    type: 'TransferContract', parameter: { type_url: 'type.googleapis.com/protocol.TransferContract', value: {
      owner_address: '41' + '55'.repeat(20), to_address: TREASURY, amount: '12345678',
    } },
  }] }, ...overrides });
  const receipt = (extra: any = {}) => ({ id: TX, blockNumber: 1000, blockTimeStamp: 1_700_000_000_000, receipt: { net_usage: 268 }, ...extra });
  function nativeNode(solid: any = body(), solidInfo: any = receipt(), full: any = {}, fullInfo: any = {}, head = 1018) {
    return jest.fn(async (url: any) => {
      const p = new URL(String(url)).pathname;
      if (p === '/walletsolidity/gettransactionbyid') return jsonResponse(solid);
      if (p === '/wallet/gettransactionbyid') return jsonResponse(full);
      if (p === '/walletsolidity/gettransactioninfobyid') return jsonResponse(solidInfo);
      if (p === '/wallet/gettransactioninfobyid') return jsonResponse(fullInfo);
      if (p === '/wallet/getnowblock') return jsonResponse({ block_header: { raw_data: { number: head } } });
      throw Error('Unexpected native fixture endpoint ' + p);
    }) as any;
  }
  it('proves native TransferContract sun exactly, without requiring a smart-contract receipt.result', async () => {
    const proof = await new TronDepositVerifier(chainConfig, nativeNode()).prove(TX, 'TRX');
    expect(proof.amount.toFixed()).toBe('12.345678');expect(proof.confirmations).toBe(19);expect(proof.finalized).toBe(true);
    expect(proof.recipient).toBe(TREASURY);expect(proof.blockNumber).toBe(1000);
  });
  it('reports a mined/full-node proof as unfinalized, never as a solidified receipt', async () => {
    const proof = await new TronDepositVerifier(chainConfig, nativeNode({}, {}, body(), receipt(), 1002)).prove(TX, 'TRX');
    expect(proof.finalized).toBe(false);expect(proof.confirmations).toBe(3);
  });
  it('requires both solidified body and solidified inclusion info before finality', async () => {
    const proof = await new TronDepositVerifier(chainConfig, nativeNode(body(), {}, {}, receipt())).prove(TX, 'TRX');
    expect(proof.finalized).toBe(false);
  });
  it.each(['TriggerSmartContract', 'TransferAssetContract'])('never calls %s native TRX', async type => {
    const b = body();b.raw_data.contract[0].type = type;
    await expect(new TronDepositVerifier(chainConfig, nativeNode(b)).prove(TX, 'TRX')).rejects.toThrow('not a native TRX');
  });
  it('refuses wrong recipient and failed native execution', async () => {
    const b = body();b.raw_data.contract[0].parameter.value.to_address = '41' + '22'.repeat(20);
    await expect(new TronDepositVerifier(chainConfig, nativeNode(b)).prove(TX, 'TRX')).rejects.toThrow('does not pay');
    await expect(new TronDepositVerifier(chainConfig, nativeNode(body({ ret: [{ contractRet: 'REVERT' }] }))).prove(TX, 'TRX')).rejects.toThrow('failed on chain');
    await expect(new TronDepositVerifier(chainConfig, nativeNode(body(), receipt({ result: 'FAILED' }))).prove(TX, 'TRX')).rejects.toThrow('failed on chain');
  });
  it.each([0, -1, '1.5', Number.MAX_SAFE_INTEGER + 1, '9223372036854775808'])('refuses invalid or rounded amount %s', async amount => {
    const b = body();b.raw_data.contract[0].parameter.value.amount = amount as any;
    await expect(new TronDepositVerifier(chainConfig, nativeNode(b)).prove(TX, 'TRX')).rejects.toBeInstanceOf(DepositVerificationError);
  });
  it('refuses a different transaction body/receipt and an impossible head', async () => {
    await expect(new TronDepositVerifier(chainConfig, nativeNode(body({ txID: 'cd'.repeat(32) }))).prove(TX, 'TRX')).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(new TronDepositVerifier(chainConfig, nativeNode(body(), receipt({ id: 'cd'.repeat(32) }))).prove(TX, 'TRX')).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(new TronDepositVerifier(chainConfig, nativeNode(body(), receipt(), {}, {}, 999)).prove(TX, 'TRX')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
  it('unknown is not a confirmed deposit, and USDT still requires token logs', async () => {
    await expect(new TronDepositVerifier(chainConfig, nativeNode({}, {})).prove(TX, 'TRX')).rejects.toBeInstanceOf(TransferNotFoundError);
    await expect(new TronDepositVerifier(chainConfig, node({ solidity: receipt({ receipt: { result: 'SUCCESS' } }) })).prove(TX, 'USDT')).rejects.toThrow('no allowlisted token transfer');
  });
});
