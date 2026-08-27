jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: jest.fn(),
      Contract: jest.fn(),
    },
  };
});

import { ethers } from 'ethers';
import { getReserves } from '../ReservesService';

const OLD_ENV = process.env;

beforeEach(() => {
  process.env = { ...OLD_ENV };
  delete process.env.BITCOIN_TREASURY_ADDRESS;
  delete process.env.TRON_TREASURY_ADDRESS;
  delete process.env.ETHEREUM_TREASURY_ADDRESS;
});
afterAll(() => {
  process.env = OLD_ENV;
});

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function makePrisma(balancesByAsset: Record<string, { available: string; locked: string }[]>) {
  return {
    balance: {
      findMany: jest.fn().mockImplementation(({ where: { asset } }: any) =>
        Promise.resolve(
          (balancesByAsset[asset] ?? []).map((b) => ({ available: b.available, locked: b.locked }))
        )
      ),
    },
    treasuryWallet: { findUnique: jest.fn().mockResolvedValue(null) },
  } as any;
}

describe('getReserves', () => {
  it('returns nothing when no chains are configured', async () => {
    const prisma = makePrisma({});
    const rows = await getReserves(prisma, jest.fn());
    expect(rows).toEqual([]);
  });

  it('compares Bitcoin treasury on-chain balance against summed user liabilities', async () => {
    process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qtreasury';
    process.env.BITCOIN_NATIVE_ASSET = 'BTC';
    const prisma = makePrisma({ BTC: [{ available: '0.5', locked: '0.1' }, { available: '0.4', locked: '0' }] });
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({ chain_stats: { funded_txo_sum: 100_000_000, spent_txo_sum: 0 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } })
    );

    const rows = await getReserves(prisma, fetchFn);

    expect(rows).toHaveLength(1);
    expect(rows[0].chain).toBe('bitcoin');
    expect(rows[0].asset).toBe('BTC');
    expect(rows[0].internalLiabilities).toBe('1'); // 0.5+0.1+0.4+0
    expect(rows[0].onChainBalance).toBe('1'); // 100,000,000 sats
    expect(rows[0].coverageRatio).toBe(1);
  });

  it('reports full coverage when there are no internal liabilities at all', async () => {
    process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qtreasury';
    process.env.BITCOIN_NATIVE_ASSET = 'BTC';
    const prisma = makePrisma({});
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({ chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } })
    );

    const rows = await getReserves(prisma, fetchFn);

    expect(rows[0].internalLiabilities).toBe('0');
    expect(rows[0].coverageRatio).toBe(1);
  });

  it('surfaces (never hides) an on-chain lookup failure as onChainBalance: null', async () => {
    process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qtreasury';
    process.env.BITCOIN_NATIVE_ASSET = 'BTC';
    const prisma = makePrisma({ BTC: [{ available: '1', locked: '0' }] });
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({}, false, 503));

    const rows = await getReserves(prisma, fetchFn);

    expect(rows[0].onChainBalance).toBeNull();
    expect(rows[0].coverageRatio).toBeNull();
    expect(rows[0].error).toContain('503');
  });

  it('checks native TRX and each configured Tron TRC-20 token against the treasury balance', async () => {
    process.env.TRON_TREASURY_ADDRESS = 'Ttreasury';
    process.env.TRON_NATIVE_ASSET = 'TRX';
    process.env.TRON_TOKENS = 'USDT:TR7contract:6';
    const prisma = makePrisma({ USDT: [{ available: '1000', locked: '0' }] });
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({ data: [{ balance: 2_000_000, trc20: [{ TR7contract: '1000000000' }] }] }) // 2 TRX, 1000 USDT at 6 decimals
    );

    const rows = await getReserves(prisma, fetchFn);

    expect(rows).toHaveLength(2);
    expect(rows[0].chain).toBe('tron');
    expect(rows[0].asset).toBe('TRX');
    expect(rows[0].internalLiabilities).toBe('0'); // no TRX balances in the prisma mock
    expect(rows[0].onChainBalance).toBe('2');
    expect(rows[1].chain).toBe('tron');
    expect(rows[1].asset).toBe('USDT');
    expect(rows[1].internalLiabilities).toBe('1000');
    expect(rows[1].onChainBalance).toBe('1000');
    expect(rows[1].coverageRatio).toBe(1);
  });

  it('flags under-collateralization with a coverage ratio below 1', async () => {
    process.env.TRON_TREASURY_ADDRESS = 'Ttreasury';
    process.env.TRON_NATIVE_ASSET = 'TRX';
    process.env.TRON_TOKENS = 'USDT:TR7contract:6';
    const prisma = makePrisma({ USDT: [{ available: '1000', locked: '0' }] });
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ data: [{ trc20: [{ TR7contract: '500000000' }] }] }));

    const rows = await getReserves(prisma, fetchFn);

    expect(rows[1].asset).toBe('USDT');
    expect(rows[1].coverageRatio).toBe(0.5);
  });

  describe('Ethereum (evm)', () => {
    function setEthEnv() {
      process.env.ETHEREUM_TREASURY_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
      process.env.ETHEREUM_RPC_URL = 'https://rpc.example';
    }

    it('checks the native ETH balance against summed user liabilities', async () => {
      setEthEnv();
      (ethers.JsonRpcProvider as unknown as jest.Mock).mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue(ethers.parseEther('2')),
      }));
      const prisma = makePrisma({ ETH: [{ available: '1.5', locked: '0.5' }] });

      const rows = await getReserves(prisma, jest.fn());

      expect(rows).toHaveLength(1);
      expect(rows[0].chain).toBe('ethereum');
      expect(rows[0].asset).toBe('ETH');
      expect(rows[0].internalLiabilities).toBe('2');
      expect(rows[0].onChainBalance).toBe('2');
      expect(rows[0].coverageRatio).toBe(1);
    });

    it('checks each configured ERC-20 token balance via balanceOf', async () => {
      setEthEnv();
      process.env.ETHEREUM_TOKENS = 'USDT:0xdAC17F958D2ee523a2206206994597C13D831ec7:6';
      (ethers.JsonRpcProvider as unknown as jest.Mock).mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue(0n),
      }));
      (ethers.Contract as unknown as jest.Mock).mockImplementation(() => ({
        balanceOf: jest.fn().mockResolvedValue(1_000_000_000n), // 1000 USDT at 6 decimals
      }));
      const prisma = makePrisma({ ETH: [], USDT: [{ available: '1000', locked: '0' }] });

      const rows = await getReserves(prisma, jest.fn());

      const usdtRow = rows.find((r) => r.asset === 'USDT')!;
      expect(usdtRow.chain).toBe('ethereum');
      expect(usdtRow.internalLiabilities).toBe('1000');
      expect(usdtRow.onChainBalance).toBe('1000');
      expect(usdtRow.coverageRatio).toBe(1);
    });

    it('surfaces an RPC failure as onChainBalance: null instead of hiding it', async () => {
      setEthEnv();
      (ethers.JsonRpcProvider as unknown as jest.Mock).mockImplementation(() => ({
        getBalance: jest.fn().mockRejectedValue(new Error('RPC unreachable')),
      }));
      const prisma = makePrisma({ ETH: [{ available: '1', locked: '0' }] });

      const rows = await getReserves(prisma, jest.fn());

      expect(rows[0].onChainBalance).toBeNull();
      expect(rows[0].coverageRatio).toBeNull();
      expect(rows[0].error).toContain('RPC unreachable');
    });
  });
});
