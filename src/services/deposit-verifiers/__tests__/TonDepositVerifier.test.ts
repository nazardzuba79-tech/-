import { TonDepositVerifier } from '../TonDepositVerifier';
import { ChainConfig } from '../../../config/chains';

const TREASURY = 'EQTreasuryAddress0000000000000000000000000';
const SENDER = 'EQSenderAddress00000000000000000000000000';
const USDT_JETTON = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const TX_HASH = 'a'.repeat(64);

const chainConfig: ChainConfig = {
  chain: 'ton',
  type: 'ton',
  treasuryAddress: TREASURY,
  minConfirmations: 3,
  nativeAsset: 'TON',
  tokens: { USDT: { contractAddress: USDT_JETTON, decimals: 6 } },
  apiUrl: 'https://mock-tonapi',
};

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe('TonDepositVerifier', () => {
  describe('native TON', () => {
    it('credits a matching TonTransfer action found by event_id', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(
        jsonResponse({
          events: [
            {
              event_id: TX_HASH,
              timestamp: 1700000000,
              actions: [{ type: 'TonTransfer', status: 'ok', TonTransfer: { sender: { address: SENDER }, recipient: { address: TREASURY }, amount: 2500000000 } }],
            },
          ],
        })
      );

      const verifier = new TonDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.verify(TX_HASH, 'TON');

      expect(result.amount.toString()).toBe('2.5'); // 2,500,000,000 nanotons / 1e9
      expect(result.confirmations).toBe(3);
    });

    it('rejects when no event matches the given hash', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ events: [] }));
      const verifier = new TonDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.verify(TX_HASH, 'TON')).rejects.toThrow('not found among the treasury');
    });

    it('rejects when the matching event has no transfer to the treasury', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(
        jsonResponse({
          events: [
            {
              event_id: TX_HASH,
              timestamp: 1700000000,
              actions: [{ type: 'TonTransfer', status: 'ok', TonTransfer: { sender: { address: SENDER }, recipient: { address: 'EQSomeoneElse' }, amount: 1 } }],
            },
          ],
        })
      );
      const verifier = new TonDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.verify(TX_HASH, 'TON')).rejects.toThrow('No matching transfer');
    });

    it('matches an event_id regardless of a leading 0x', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(
        jsonResponse({
          events: [
            {
              event_id: TX_HASH,
              timestamp: 1700000000,
              actions: [{ type: 'TonTransfer', status: 'ok', TonTransfer: { sender: { address: SENDER }, recipient: { address: TREASURY }, amount: 1000000000 } }],
            },
          ],
        })
      );
      const verifier = new TonDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.verify(`0x${TX_HASH}`, 'TON');
      expect(result.amount.toString()).toBe('1');
    });
  });

  describe('USDT jetton', () => {
    it('credits a matching JettonTransfer action for the configured jetton contract', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(
        jsonResponse({
          events: [
            {
              event_id: TX_HASH,
              timestamp: 1700000000,
              actions: [
                {
                  type: 'JettonTransfer',
                  status: 'ok',
                  JettonTransfer: { sender: { address: SENDER }, recipient: { address: TREASURY }, amount: '5000000', jetton: { address: USDT_JETTON } },
                },
              ],
            },
          ],
        })
      );

      const verifier = new TonDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.verify(TX_HASH, 'USDT');
      expect(result.amount.toString()).toBe('5'); // 5,000,000 / 1e6
    });

    it('rejects a JettonTransfer for a different jetton contract', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(
        jsonResponse({
          events: [
            {
              event_id: TX_HASH,
              timestamp: 1700000000,
              actions: [
                {
                  type: 'JettonTransfer',
                  status: 'ok',
                  JettonTransfer: { sender: { address: SENDER }, recipient: { address: TREASURY }, amount: '1', jetton: { address: 'EQSomeOtherJetton' } },
                },
              ],
            },
          ],
        })
      );
      const verifier = new TonDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.verify(TX_HASH, 'USDT')).rejects.toThrow('No matching transfer');
    });

    it('rejects an unsupported asset', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ events: [{ event_id: TX_HASH, timestamp: 1700000000, actions: [] }] }));
      const verifier = new TonDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.verify(TX_HASH, 'BOGUS')).rejects.toThrow('Unsupported asset');
    });
  });

  it('sends the Authorization header when an API key is configured', async () => {
    const withKey: ChainConfig = { ...chainConfig, apiKey: 'secret' };
    const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ events: [] }));
    const verifier = new TonDepositVerifier(withKey, fetchFn);
    await expect(verifier.verify(TX_HASH, 'TON')).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('/v2/accounts/'), expect.objectContaining({ headers: { Authorization: 'Bearer secret' } }));
  });

  it('wraps a network failure in DepositVerificationError', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('timeout'));
    const verifier = new TonDepositVerifier(chainConfig, fetchFn);
    await expect(verifier.verify(TX_HASH, 'TON')).rejects.toThrow('Failed to reach tonapi.io');
  });

  describe('listIncoming', () => {
    it('lists native and jetton transfers found across recent events', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(
        jsonResponse({
          events: [
            {
              event_id: 'evt-a',
              timestamp: 1700000000,
              actions: [{ type: 'TonTransfer', status: 'ok', TonTransfer: { sender: { address: SENDER }, recipient: { address: TREASURY }, amount: 1000000000 } }],
            },
            {
              event_id: 'evt-b',
              timestamp: 1700000100,
              actions: [
                {
                  type: 'JettonTransfer',
                  status: 'ok',
                  JettonTransfer: { sender: { address: SENDER }, recipient: { address: TREASURY }, amount: '2500000', jetton: { address: USDT_JETTON } },
                },
              ],
            },
          ],
        })
      );

      const verifier = new TonDepositVerifier(chainConfig, fetchFn);
      const result = await verifier.listIncoming();

      expect(result).toEqual([
        { txHash: 'evt-a', asset: 'TON', amount: '1', confirmations: 3, timestamp: new Date(1700000000 * 1000).toISOString() },
        { txHash: 'evt-b', asset: 'USDT', amount: '2.5', confirmations: 3, timestamp: new Date(1700000100 * 1000).toISOString() },
      ]);
    });

    it('ignores a jetton transfer for a jetton not configured as a supported deposit token', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(
        jsonResponse({
          events: [
            {
              event_id: 'evt-a',
              timestamp: 1700000000,
              actions: [
                {
                  type: 'JettonTransfer',
                  status: 'ok',
                  JettonTransfer: { sender: { address: SENDER }, recipient: { address: TREASURY }, amount: '1', jetton: { address: 'EQUnknownJetton' } },
                },
              ],
            },
          ],
        })
      );
      const verifier = new TonDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.listIncoming()).resolves.toEqual([]);
    });

    it('returns an empty list when there are no events', async () => {
      const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse({ events: [] }));
      const verifier = new TonDepositVerifier(chainConfig, fetchFn);
      await expect(verifier.listIncoming()).resolves.toEqual([]);
    });
  });
});
