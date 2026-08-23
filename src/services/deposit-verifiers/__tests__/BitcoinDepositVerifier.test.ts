import { BitcoinDepositVerifier } from '../BitcoinDepositVerifier';
import { DepositVerificationError } from '../errors';
import { ChainConfig } from '../../../config/chains';

const TREASURY = 'bc1qtreasuryaddressxxxxxxxxxxxxxxxxxxxxxx';

const chainConfig: ChainConfig = {
  chain: 'bitcoin',
  type: 'bitcoin',
  treasuryAddress: TREASURY,
  minConfirmations: 2,
  nativeAsset: 'BTC',
  tokens: {},
  apiUrl: 'https://mock-esplora/api',
};

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body), text: () => Promise.resolve(String(body)) } as Response;
}
function textResponse(body: string, ok = true, status = 200) {
  return { ok, status, text: () => Promise.resolve(body), json: () => Promise.resolve(JSON.parse(body)) } as Response;
}

describe('BitcoinDepositVerifier', () => {
  it('rejects a non-BTC asset', async () => {
    const verifier = new BitcoinDepositVerifier(chainConfig, jest.fn());
    await expect(verifier.verify('tx1', 'ETH')).rejects.toThrow('Unsupported asset on Bitcoin');
  });

  it('sums outputs paying the treasury address and reports confirmations', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          vout: [
            { scriptpubkey_address: 'someone-else', value: 100000 },
            { scriptpubkey_address: TREASURY, value: 50000 },
            { scriptpubkey_address: TREASURY, value: 25000 },
          ],
          status: { confirmed: true, block_height: 800000 },
        })
      )
      .mockResolvedValueOnce(textResponse('800001'));

    const verifier = new BitcoinDepositVerifier(chainConfig, fetchFn);
    const result = await verifier.verify('tx1', 'BTC');

    expect(result.amount.toString()).toBe('0.00075'); // (50000+25000) sats in BTC
    expect(result.confirmations).toBe(2); // 800001 - 800000 + 1
  });

  it('throws when no output pays the treasury address', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({ vout: [{ scriptpubkey_address: 'someone-else', value: 100000 }], status: { confirmed: false } })
    );

    const verifier = new BitcoinDepositVerifier(chainConfig, fetchFn);
    await expect(verifier.verify('tx1', 'BTC')).rejects.toThrow('does not pay the treasury address');
  });

  it('reports zero confirmations for an unconfirmed transaction', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({ vout: [{ scriptpubkey_address: TREASURY, value: 1000 }], status: { confirmed: false } })
    );

    const verifier = new BitcoinDepositVerifier(chainConfig, fetchFn);
    const result = await verifier.verify('tx1', 'BTC');

    expect(result.confirmations).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(1); // never asked for tip height
  });

  it('throws a clear error for a 404 (unknown/unmined tx)', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({}, false, 404));
    const verifier = new BitcoinDepositVerifier(chainConfig, fetchFn);
    await expect(verifier.verify('tx1', 'BTC')).rejects.toThrow(DepositVerificationError);
  });

  it('wraps a network failure in DepositVerificationError', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('DNS failure'));
    const verifier = new BitcoinDepositVerifier(chainConfig, fetchFn);
    await expect(verifier.verify('tx1', 'BTC')).rejects.toThrow('Failed to reach Bitcoin explorer API');
  });

  describe('listIncoming', () => {
    it('returns only txs paying the treasury address, with real confirmation counts', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse([
            { txid: 'tx-a', vout: [{ scriptpubkey_address: TREASURY, value: 50000 }], status: { confirmed: true, block_height: 800000 } },
            { txid: 'tx-b', vout: [{ scriptpubkey_address: 'someone-else', value: 10000 }], status: { confirmed: true, block_height: 800000 } },
            { txid: 'tx-c', vout: [{ scriptpubkey_address: TREASURY, value: 25000 }], status: { confirmed: false } },
          ])
        )
        .mockResolvedValueOnce(textResponse('800001'));

      const verifier = new BitcoinDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.listIncoming();

      expect(result).toEqual([
        { txHash: 'tx-a', asset: 'BTC', amount: '0.0005', confirmations: 2 },
        { txHash: 'tx-c', asset: 'BTC', amount: '0.00025', confirmations: 0 },
      ]);
    });

    it('returns an empty list without a tip-height call when nothing matches', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse([{ txid: 'tx-a', vout: [{ scriptpubkey_address: 'someone-else', value: 1000 }], status: { confirmed: true, block_height: 1 } }]));
      const verifier = new BitcoinDepositVerifier(chainConfig, fetchFn);

      const result = await verifier.listIncoming();

      expect(result).toEqual([]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });
});
