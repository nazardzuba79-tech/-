import { FearGreedService, FearGreedError } from '../FearGreedService';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

const LIVE_PAYLOAD = {
  data: [{ value: '71', value_classification: 'Greed', timestamp: '1735689600' }],
};

describe('FearGreedService', () => {
  it('returns the published index value and classification', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(LIVE_PAYLOAD));
    const service = new FearGreedService('https://api.alternative.me', fetchFn as any);

    const reading = await service.getIndex();

    expect(reading).toEqual({ value: 71, classification: 'Greed', updatedAt: 1735689600 });
    expect(fetchFn).toHaveBeenCalledWith('https://api.alternative.me/fng/?limit=1');
  });

  it('caches within the TTL instead of refetching on every request', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(LIVE_PAYLOAD));
    const service = new FearGreedService('https://api.alternative.me', fetchFn as any);

    await service.getIndex();
    await service.getIndex();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('serves the last good reading when a later refresh fails', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(LIVE_PAYLOAD))
      .mockRejectedValue(new Error('network down'));
    const service = new FearGreedService('https://api.alternative.me', fetchFn as any);

    await service.getIndex();
    // Expire the cache so the second call actually attempts a refresh.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60_000);
    const reading = await service.getIndex();

    expect(reading.value).toBe(71);
    jest.restoreAllMocks();
  });

  it('throws when the very first call fails, with nothing cached to serve', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({}, false, 429));
    const service = new FearGreedService('https://api.alternative.me', fetchFn as any);

    await expect(service.getIndex()).rejects.toBeInstanceOf(FearGreedError);
  });

  it('rejects a value outside 0-100 rather than rendering it as an index', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ data: [{ value: 'n/a' }] }));
    const service = new FearGreedService('https://api.alternative.me', fetchFn as any);

    await expect(service.getIndex()).rejects.toBeInstanceOf(FearGreedError);
  });
});
