import { SolanaDepositVerifier } from '../SolanaDepositVerifier';
import { ChainConfig } from '../../../config/chains';

const TREASURY = 'TreasuryPubkey11111111111111111111111111';
const SENDER = 'SenderPubkey1111111111111111111111111111';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const chainConfig: ChainConfig = {
  chain: 'solana',
  type: 'solana',
  treasuryAddress: TREASURY,
  minConfirmations: 32,
  nativeAsset: 'SOL',
  tokens: { USDT: { contractAddress: USDT_MINT, decimals: 6 } },
  apiUrl: 'https://mock-solana-rpc',
};

function rpcResponse(result: any) {
  return { ok: true, status: 200, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }) } as Response;
}

function rpcErrorResponse(message: string) {
  return { ok: true, status: 200, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, error: { code: -1, message } }) } as Response;
}

describe('SolanaDepositVerifier', () => {
  describe('native SOL', () => {
    it('credits the lamport delta at the treasury account index', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(
          rpcResponse({
            meta: { err: null, preBalances: [1000000000, 5000000000], postBalances: [999995000, 7000000000] },
            transaction: { message: { accountKeys: [{ pubkey: SENDER }, { pubkey: TREASURY }] } },
            blockTime: 1700000000,
          })
        )
        .mockResolvedValueOnce(rpcResponse({ value: [{ confirmations: 40, err: null }] }));

      const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.verify('sig1', 'SOL');

      expect(result.amount.toString()).toBe('2'); // (7,000,000,000 - 5,000,000,000) / 1e9
      expect(result.confirmations).toBe(40);
    });

    it('treats null confirmations (finalized) as the configured minimum', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(
          rpcResponse({
            meta: { err: null, preBalances: [1000000000, 0], postBalances: [999995000, 1000000000] },
            transaction: { message: { accountKeys: [{ pubkey: SENDER }, { pubkey: TREASURY }] } },
            blockTime: 1700000000,
          })
        )
        .mockResolvedValueOnce(rpcResponse({ value: [{ confirmations: null, err: null }] }));

      const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.verify('sig1', 'SOL');
      expect(result.confirmations).toBe(32);
    });

    it('rejects a transaction that failed on-chain', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(rpcResponse({ meta: { err: 'InstructionError' }, transaction: { message: { accountKeys: [] } }, blockTime: null }));
      const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.verify('sig1', 'SOL')).rejects.toThrow('failed on-chain');
    });

    it('rejects a transaction not found', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(rpcResponse(null));
      const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.verify('sig1', 'SOL')).rejects.toThrow('not found or not yet processed');
    });
  });

  describe('USDT-SPL', () => {
    it('credits the token-account delta for the treasury owner and configured mint', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(
          rpcResponse({
            meta: {
              err: null,
              preBalances: [],
              postBalances: [],
              preTokenBalances: [{ accountIndex: 1, mint: USDT_MINT, owner: TREASURY, uiTokenAmount: { amount: '1000000', decimals: 6 } }],
              postTokenBalances: [{ accountIndex: 1, mint: USDT_MINT, owner: TREASURY, uiTokenAmount: { amount: '6000000', decimals: 6 } }],
            },
            transaction: { message: { accountKeys: [{ pubkey: SENDER }, { pubkey: TREASURY }] } },
            blockTime: 1700000000,
          })
        )
        .mockResolvedValueOnce(rpcResponse({ value: [{ confirmations: 32, err: null }] }));

      const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.verify('sig1', 'USDT');
      expect(result.amount.toString()).toBe('5'); // (6,000,000 - 1,000,000) / 1e6
    });

    it('rejects when there is no matching post-token-balance for the treasury owner and mint', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(
        rpcResponse({
          meta: { err: null, preBalances: [], postBalances: [], preTokenBalances: [], postTokenBalances: [] },
          transaction: { message: { accountKeys: [] } },
          blockTime: null,
        })
      );
      const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.verify('sig1', 'USDT')).rejects.toThrow('No matching token transfer');
    });

    it('rejects an unsupported asset', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(
        rpcResponse({ meta: { err: null, preBalances: [], postBalances: [] }, transaction: { message: { accountKeys: [] } }, blockTime: null })
      );
      const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.verify('sig1', 'BOGUS')).rejects.toThrow('Unsupported asset');
    });
  });

  it('wraps an RPC error response in DepositVerificationError', async () => {
    const fetchFn = jest.fn().mockResolvedValueOnce(rpcErrorResponse('slot skipped'));
    const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
    await expect(verifier.verify('sig1', 'SOL')).rejects.toThrow('Solana RPC error: slot skipped');
  });

  it('wraps a network failure in DepositVerificationError', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('timeout'));
    const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
    await expect(verifier.verify('sig1', 'SOL')).rejects.toThrow('Failed to reach Solana RPC endpoint');
  });

  describe('listIncoming', () => {
    it('lists native and token transfers found among recent signatures for the treasury address', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(rpcResponse([{ signature: 'sig-a', slot: 100, err: null, blockTime: 1700000000 }]))
        .mockResolvedValueOnce(
          rpcResponse({
            meta: { err: null, preBalances: [1000000000, 0], postBalances: [999995000, 3000000000] },
            transaction: { message: { accountKeys: [{ pubkey: SENDER }, { pubkey: TREASURY }] } },
            blockTime: 1700000000,
          })
        );

      const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.listIncoming();

      expect(result).toEqual([
        { txHash: 'sig-a', asset: 'SOL', amount: '3', confirmations: 32, timestamp: new Date(1700000000 * 1000).toISOString() },
      ]);
    });

    it('skips signatures with an error', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(rpcResponse([{ signature: 'sig-bad', slot: 100, err: 'InstructionError', blockTime: 1700000000 }]));
      const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.listIncoming()).resolves.toEqual([]);
    });

    it('returns an empty list when there are no signatures', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(rpcResponse([]));
      const verifier = new SolanaDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.listIncoming()).resolves.toEqual([]);
    });
  });
});
