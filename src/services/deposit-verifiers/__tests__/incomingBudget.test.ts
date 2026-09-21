import { ChainConfig } from '../../../config/chains';
import { BitcoinDepositVerifier } from '../BitcoinDepositVerifier';
import { EvmDepositVerifier } from '../EvmDepositVerifier';
import { TronDepositVerifier } from '../TronDepositVerifier';
import { SolanaDepositVerifier } from '../SolanaDepositVerifier';
import { TonDepositVerifier } from '../TonDepositVerifier';

const treasury = '41' + '11'.repeat(20);
const token = '41' + '22'.repeat(20);
const config: ChainConfig = { chain: 'tron', type: 'tron', treasuryAddress: treasury,
  nativeAsset: 'TRX', minConfirmations: 19, apiUrl: 'https://fixture.invalid', apiKey: 'fixture',
  tokens: { USDT: { contractAddress: token, decimals: 6 } } };
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body } as Response);
const many = (item: (i: number) => unknown) => Array.from({ length: 100 }, (_, i) => item(i));

describe('bounded incoming provider windows: no pagination/retry expansion', () => {
  it('TRON: one page per token, at most 20 observations even if provider returns 100 + next link', async () => {
    const fetchFn = jest.fn(async () => response({ data: many(i => ({ transaction_id: `${i}`, to: treasury,
      value: '10000000', block_timestamp: 1700000000000 })), meta: { links: { next: 'https://fixture.invalid/next' } } }));
    const result = await new TronDepositVerifier(config, fetchFn).listIncoming();
    expect(result).toHaveLength(20); expect(result.every(row => row.amount === '10')).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(new URL((fetchFn.mock.calls as unknown[][])[0][0] as string).searchParams.get('limit')).toBe('20');
  });

  it('EVM: one 20-item page for native and each token; never follow next page', async () => {
    const fetchFn = jest.fn(async () => response({ status: '1', result: many(i => ({ hash: `${i}`, to: treasury,
      isError: '0', value: '10000000', timeStamp: '1700000000' })), next: 'another-page' }));
    const result = await new EvmDepositVerifier({ ...config, chain: 'ethereum', type: 'evm', nativeAsset: 'ETH' }, fetchFn).listIncoming();
    expect(result).toHaveLength(40); expect(fetchFn).toHaveBeenCalledTimes(2);
    for (const [url] of fetchFn.mock.calls as unknown[][]) {
      expect(new URL(url as string).searchParams.get('page')).toBe('1');
      expect(new URL(url as string).searchParams.get('offset')).toBe('20');
    }
  });

  it('Bitcoin: at most 25 transactions, one address request + one shared height request', async () => {
    const fetchFn = jest.fn(async (url: string | URL | Request) => String(url).includes('/address/')
      ? response(many(i => ({ txid: `${i}`, vout: [{ scriptpubkey_address: treasury, value: 1000 }],
        status: { confirmed: true, block_height: 1 } })))
      : { ok: true, status: 200, text: async () => '100' } as Response);
    const result = await new BitcoinDepositVerifier({ ...config, chain: 'bitcoin', type: 'bitcoin', nativeAsset: 'BTC', tokens: {} }, fetchFn).listIncoming();
    expect(result).toHaveLength(25); expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('Solana: one signatures page plus at most 20 transaction reads even on oversized response', async () => {
    const fetchFn = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      if (payload.method === 'getSignaturesForAddress') {
        expect(payload.params[1]).toEqual({ limit: 20 });
        return response({ result: many(i => ({ signature: `${i}`, err: null, blockTime: 1700000000 })) });
      }
      expect(payload.method).toBe('getTransaction');
      return response({ result: { meta: { err: null, preBalances: [0], postBalances: [1000000000] },
        transaction: { message: { accountKeys: [{ pubkey: treasury }] } } } });
    });
    const result = await new SolanaDepositVerifier({ ...config, chain: 'solana', type: 'solana', nativeAsset: 'SOL' }, fetchFn).listIncoming();
    expect(result).toHaveLength(20); expect(fetchFn).toHaveBeenCalledTimes(21);
  });

  it('TON: one 20-event page, ignoring next_from instead of recursively scanning history', async () => {
    const fetchFn = jest.fn(async () => response({ events: many(i => ({ event_id: `${i}`, timestamp: 1700000000,
      actions: [{ type: 'TonTransfer', status: 'ok', TonTransfer: { recipient: { address: treasury }, amount: 1000000000 } }] })), next_from: 1700000000 }));
    const result = await new TonDepositVerifier({ ...config, chain: 'ton', type: 'ton', nativeAsset: 'TON' }, fetchFn).listIncoming();
    expect(result).toHaveLength(20); expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('Solana transaction RPC failure propagates without retry or false empty success', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(response({ result: [{ signature: 'test', err: null, blockTime: 1700000000 }] }))
      .mockRejectedValue(new Error('provider unavailable'));
    await expect(new SolanaDepositVerifier({ ...config, chain: 'solana', type: 'solana', nativeAsset: 'SOL' }, fetchFn)
      .listIncoming()).rejects.toThrow('provider unavailable');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
