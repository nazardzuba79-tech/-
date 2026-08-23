// Must run before the `import { ethers }` below is compiled to a require()
// call — ts-jest doesn't hoist jest.mock() the way babel-jest does, so this
// has to be physically first in source order, not just logically first.
// `import { ethers } from 'ethers'` pulls the package's nested `ethers`
// namespace re-export, not its flat top-level exports — JsonRpcProvider has
// to be overridden inside that nested object, not the outer one.
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: jest.fn() } };
});

import { ethers } from 'ethers';
import { EvmDepositVerifier } from '../EvmDepositVerifier';
import { DepositVerificationError } from '../errors';
import { ChainConfig } from '../../../config/chains';

const TREASURY = '0x1234567890123456789012345678901234567890';
const USDT_CONTRACT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

const chainConfig: ChainConfig = {
  chain: 'ethereum',
  type: 'evm',
  treasuryAddress: TREASURY,
  minConfirmations: 12,
  nativeAsset: 'ETH',
  tokens: { USDT: { contractAddress: USDT_CONTRACT, decimals: 6 } },
  rpcUrl: 'https://mock-rpc.example',
  apiUrl: 'https://mock-explorer.example/api',
  apiKey: 'test-key',
};

function mockProvider(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const provider = {
    getTransactionReceipt: jest.fn(),
    getBlockNumber: jest.fn(),
    getTransaction: jest.fn(),
    ...overrides,
  };
  (ethers.JsonRpcProvider as unknown as jest.Mock).mockImplementation(() => provider);
  return provider;
}

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe('EvmDepositVerifier', () => {
  describe('verify', () => {
    it('verifies a native ETH transfer to the treasury address', async () => {
      mockProvider({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100 }),
        getBlockNumber: jest.fn().mockResolvedValue(103),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('1.5') }),
      });

      const verifier = new EvmDepositVerifier(chainConfig);
      const result = await verifier.verify('0xtx1', 'ETH');

      expect(result.amount.toString()).toBe('1.5');
      expect(result.confirmations).toBe(4); // 103 - 100 + 1
    });

    it('rejects a native transfer that does not pay the treasury address', async () => {
      mockProvider({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100 }),
        getBlockNumber: jest.fn().mockResolvedValue(100),
        getTransaction: jest.fn().mockResolvedValue({ to: '0xsomeoneelse', value: ethers.parseEther('1') }),
      });

      const verifier = new EvmDepositVerifier(chainConfig);
      await expect(verifier.verify('0xtx1', 'ETH')).rejects.toThrow('does not pay the treasury address');
    });

    it('verifies an ERC-20 token transfer via the Transfer event log', async () => {
      const treasuryTopic = ethers.zeroPadValue(TREASURY, 32);
      mockProvider({
        getTransactionReceipt: jest.fn().mockResolvedValue({
          status: 1,
          blockNumber: 100,
          logs: [
            {
              address: USDT_CONTRACT,
              topics: [ethers.id('Transfer(address,address,uint256)'), ethers.zeroPadValue('0x2222222222222222222222222222222222222b', 32), treasuryTopic],
              data: ethers.toBeHex(50_000_000n, 32), // 50 USDT at 6 decimals
            },
          ],
        }),
        getBlockNumber: jest.fn().mockResolvedValue(100),
      });

      const verifier = new EvmDepositVerifier(chainConfig);
      const result = await verifier.verify('0xtx1', 'USDT');

      expect(result.amount.toString()).toBe('50');
    });

    it('throws for a transaction that failed on-chain', async () => {
      mockProvider({ getTransactionReceipt: jest.fn().mockResolvedValue({ status: 0, blockNumber: 100 }) });

      const verifier = new EvmDepositVerifier(chainConfig);
      await expect(verifier.verify('0xtx1', 'ETH')).rejects.toThrow('failed on-chain');
    });

    it('throws for an unmined transaction', async () => {
      mockProvider({ getTransactionReceipt: jest.fn().mockResolvedValue(null) });

      const verifier = new EvmDepositVerifier(chainConfig);
      await expect(verifier.verify('0xtx1', 'ETH')).rejects.toThrow(DepositVerificationError);
    });
  });

  describe('listIncoming', () => {
    it('lists native ETH transfers to the treasury address, skipping failed txs and other recipients', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            status: '1',
            message: 'OK',
            result: [
              { hash: '0xa', to: TREASURY, value: ethers.parseEther('2').toString(), isError: '0' },
              { hash: '0xb', to: TREASURY, value: ethers.parseEther('1').toString(), isError: '1' }, // failed tx
              { hash: '0xc', to: '0xsomeoneelse', value: ethers.parseEther('3').toString(), isError: '0' },
            ],
          })
        )
        .mockResolvedValueOnce(jsonResponse({ status: '0', message: 'No transactions found', result: [] }));

      const verifier = new EvmDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.listIncoming();

      expect(result).toEqual([{ txHash: '0xa', asset: 'ETH', amount: '2', confirmations: 12 }]);
    });

    it('lists ERC-20 token transfers to the treasury address', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse({ status: '0', message: 'No transactions found', result: [] }))
        .mockResolvedValueOnce(
          jsonResponse({
            status: '1',
            message: 'OK',
            result: [{ hash: '0xd', to: TREASURY, value: '75000000', contractAddress: USDT_CONTRACT }],
          })
        );

      const verifier = new EvmDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.listIncoming();

      expect(result).toEqual([{ txHash: '0xd', asset: 'USDT', amount: '75', confirmations: 12 }]);
    });

    it('throws a clear error when no API key is configured', async () => {
      const noKeyConfig: ChainConfig = { ...chainConfig, apiKey: undefined };
      const verifier = new EvmDepositVerifier(noKeyConfig, jest.fn());
      await expect(verifier.listIncoming()).rejects.toThrow('No Etherscan-style API key configured');
    });

    it('wraps a network failure in DepositVerificationError', async () => {
      const fetchFn = jest.fn().mockRejectedValue(new Error('DNS failure'));
      const verifier = new EvmDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.listIncoming()).rejects.toThrow('Failed to reach block explorer API');
    });
  });
});
