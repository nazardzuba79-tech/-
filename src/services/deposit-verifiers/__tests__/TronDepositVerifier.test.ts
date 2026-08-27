import { TronDepositVerifier } from '../TronDepositVerifier';
import { DepositVerificationError } from '../errors';
import { ChainConfig } from '../../../config/chains';

const TREASURY = 'TTreasuryAddressXXXXXXXXXXXXXXXXXX';
const TREASURY_HEX = '41c434b54402b9d1d41d2c32c7f6d58ee4870cceba'; // base58ToHexAddress(TREASURY)
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const chainConfig: ChainConfig = {
  chain: 'tron',
  type: 'tron',
  treasuryAddress: TREASURY,
  minConfirmations: 19,
  nativeAsset: 'TRX',
  tokens: { USDT: { contractAddress: USDT_CONTRACT, decimals: 6 } },
  apiUrl: 'https://mock-trongrid',
};

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe('TronDepositVerifier', () => {
  it('rejects an asset with no configured TRC-20 contract', async () => {
    const verifier = new TronDepositVerifier(chainConfig, jest.fn());
    await expect(verifier.verify('tx1', 'BOGUS')).rejects.toThrow('Unsupported asset on Tron');
  });

  describe('native TRX', () => {
    it('credits a matching TransferContract and computes confirmations from the current block', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              {
                blockNumber: 1000,
                raw_data: {
                  contract: [{ type: 'TransferContract', parameter: { value: { amount: 5000000, owner_address: '41sender', to_address: TREASURY_HEX } } }],
                },
              },
            ],
          })
        )
        .mockResolvedValueOnce(jsonResponse({ block_header: { raw_data: { number: 1018 } } }));

      const verifier = new TronDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.verify('tx1', 'TRX');

      expect(result.amount.toString()).toBe('5'); // 5,000,000 sun / 1e6
      expect(result.confirmations).toBe(19); // 1018 - 1000 + 1
    });

    it('rejects a transaction not yet mined', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ data: [{ raw_data: { contract: [] } }] }));
      const verifier = new TronDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.verify('tx1', 'TRX')).rejects.toThrow('not yet mined');
    });

    it('rejects a transaction that does not pay the treasury address', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              blockNumber: 1000,
              raw_data: { contract: [{ type: 'TransferContract', parameter: { value: { amount: 1, owner_address: 'x', to_address: '41someoneelse' } } }] },
            },
          ],
        })
      );
      const verifier = new TronDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.verify('tx1', 'TRX')).rejects.toThrow('does not pay the treasury address');
    });
  });

  it('credits a matching Transfer event and computes confirmations from the current block', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [
            {
              block_number: 1000,
              contract_address: USDT_CONTRACT,
              event_name: 'Transfer',
              result: { from: 'TSender', to: TREASURY, value: '5000000' },
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ block_header: { raw_data: { number: 1018 } } }));

    const verifier = new TronDepositVerifier(chainConfig, fetchFn);
    const result = await verifier.verify('tx1', 'USDT');

    expect(result.amount.toString()).toBe('5'); // 5,000,000 / 1e6
    expect(result.confirmations).toBe(19); // 1018 - 1000 + 1
  });

  it('ignores Transfer events for a different contract or recipient', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          { block_number: 1000, contract_address: 'TOtherContract', event_name: 'Transfer', result: { from: 'a', to: TREASURY, value: '1' } },
          { block_number: 1000, contract_address: USDT_CONTRACT, event_name: 'Transfer', result: { from: 'a', to: 'TSomeoneElse', value: '1' } },
        ],
      })
    );

    const verifier = new TronDepositVerifier(chainConfig, fetchFn);
    await expect(verifier.verify('tx1', 'USDT')).rejects.toThrow(DepositVerificationError);
  });

  it('throws when the transaction has no events at all', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ success: true, data: [] }));
    const verifier = new TronDepositVerifier(chainConfig, fetchFn);
    await expect(verifier.verify('tx1', 'USDT')).rejects.toThrow('not found, not yet mined');
  });

  it('sends the TRON-PRO-API-KEY header when configured', async () => {
    const withKey: ChainConfig = { ...chainConfig, apiKey: 'secret' };
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [{ block_number: 1, contract_address: USDT_CONTRACT, event_name: 'Transfer', result: { from: 'a', to: TREASURY, value: '1' } }],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ block_header: { raw_data: { number: 1 } } }));

    const verifier = new TronDepositVerifier(withKey, fetchFn);
    await verifier.verify('tx1', 'USDT');

    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('/v1/transactions/'),
      expect.objectContaining({ headers: { 'TRON-PRO-API-KEY': 'secret' } })
    );
  });

  it('wraps a network failure in DepositVerificationError', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('timeout'));
    const verifier = new TronDepositVerifier(chainConfig, fetchFn);
    await expect(verifier.verify('tx1', 'USDT')).rejects.toThrow('Failed to reach TronGrid API');
  });

  describe('listIncoming', () => {
    it('lists recent TRC-20 transfers to the treasury address, one call per configured token, plus native TRX transfers', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              { transaction_id: 'tx-a', to: TREASURY, value: '5000000', block_timestamp: 1700000000000 },
              { transaction_id: 'tx-b', to: TREASURY, value: '1250000', block_timestamp: 1700000100000 },
            ],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              {
                txID: 'tx-c',
                raw_data: {
                  timestamp: 1700000200000,
                  contract: [{ type: 'TransferContract', parameter: { value: { amount: 2000000, owner_address: '41sender', to_address: TREASURY_HEX } } }],
                },
              },
            ],
          })
        );

      const verifier = new TronDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.listIncoming();

      expect(result).toEqual([
        { txHash: 'tx-a', asset: 'USDT', amount: '5', confirmations: 19, timestamp: new Date(1700000000000).toISOString() },
        { txHash: 'tx-b', asset: 'USDT', amount: '1.25', confirmations: 19, timestamp: new Date(1700000100000).toISOString() },
        { txHash: 'tx-c', asset: 'TRX', amount: '2', confirmations: 19, timestamp: new Date(1700000200000).toISOString() },
      ]);
      expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining(`/v1/accounts/${TREASURY}/transactions/trc20`), expect.anything());
      expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining(`/v1/accounts/${TREASURY}/transactions?`), expect.anything());
    });

    it('returns an empty list when there are no transfers', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ data: [] })).mockResolvedValueOnce(jsonResponse({ data: [] }));
      const verifier = new TronDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.listIncoming()).resolves.toEqual([]);
    });
  });
});
