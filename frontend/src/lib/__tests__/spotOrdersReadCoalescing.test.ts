import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createReadCoalescer } from '../readCoalescer';
import { createSpotReadController, SPOT_OPEN_ORDER_STATUSES } from '../../components/spotOrderPresentation';

/**
 * 2026-10-13 audit: an idle Spot terminal read `/orders/me` 30 times a
 * minute — the chart's trigger lines and the open-orders panel each poll
 * every 4 s, ~200 ms apart, for the same account. One request per tick
 * now answers both; a read after the trader's own change stays its own.
 */

const src = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');
const flush = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };

describe('createReadCoalescer: identical reads inside the window share one request', () => {
  test('a second read 200 ms after the first gets the first promise; the server is asked once', async () => {
    let clock = 1000;
    const read = createReadCoalescer<string>(1500, () => clock);
    const run = jest.fn().mockResolvedValue('rows');
    const first = read('/orders/me?status=X', run);
    clock += 200;
    const second = read('/orders/me?status=X', run);
    expect(second).toBe(first);
    await expect(second).resolves.toBe('rows');
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('past the window the next read is a new request (polling is not frozen)', async () => {
    let clock = 0;
    const read = createReadCoalescer<number>(1500, () => clock);
    let n = 0; const run = jest.fn(() => Promise.resolve(++n));
    await expect(read('k', run)).resolves.toBe(1);
    clock = 1499; await expect(read('k', run)).resolves.toBe(1);
    clock = 1500; await expect(read('k', run)).resolves.toBe(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('a fresh read never shares, and it becomes what the next reader inside the window sees', async () => {
    let clock = 0;
    const read = createReadCoalescer<string>(1500, () => clock);
    const run = jest.fn().mockResolvedValueOnce('stale').mockResolvedValueOnce('after-cancel');
    const polled = read('k', run);
    clock = 100;
    const fresh = read('k', run, true);
    expect(fresh).not.toBe(polled);
    await expect(fresh).resolves.toBe('after-cancel');
    clock = 200;
    expect(read('k', run)).toBe(fresh);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('different keys never share', async () => {
    const read = createReadCoalescer<string>(1500, () => 0);
    const run = jest.fn().mockResolvedValue('x');
    read('a', run); read('b', run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('a rejection is not served to later readers — they retry', async () => {
    let clock = 0;
    const read = createReadCoalescer<string>(1500, () => clock);
    const run = jest.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce('ok');
    await expect(read('k', run)).rejects.toThrow('503');
    clock = 100;
    await expect(read('k', run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('two readers sharing one rejected request both learn of the failure', async () => {
    let clock = 0;
    const read = createReadCoalescer<string>(1500, () => clock);
    const run = jest.fn().mockRejectedValue(new Error('down'));
    const a = read('k', run); clock = 50; const b = read('k', run);
    await expect(a).rejects.toThrow('down');
    await expect(b).rejects.toThrow('down');
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('createSpotReadController tells the request when the read must be fresh', () => {
  const handlers = () => ({ accept: jest.fn(), reject: jest.fn(), settled: jest.fn() });
  test('a poll is not fresh; read(true) after a mutation is', async () => {
    const request = jest.fn().mockResolvedValue([]);
    const controller = createSpotReadController(request, handlers());
    await controller.read(false); await flush();
    expect(request).toHaveBeenLastCalledWith(false);
    await controller.read(true); await flush();
    expect(request).toHaveBeenLastCalledWith(true);
    await controller.read(); await flush();
    expect(request).toHaveBeenLastCalledWith(false);
  });

  test('a fresh read queued behind an in-flight poll runs fresh, and only that one', async () => {
    let release!: (rows: unknown[]) => void;
    const request = jest.fn()
      .mockImplementationOnce(() => new Promise<unknown[]>(res => { release = res; }))
      .mockResolvedValue([]);
    const controller = createSpotReadController(request, handlers());
    const poll = controller.read(false);
    await flush(); // the controller starts its request in a microtask; it is now in the air
    expect(request).toHaveBeenCalledTimes(1);
    void controller.read(true); // mutation while the poll is in the air
    release([]); await poll; await flush();
    expect(request.mock.calls.map(c => c[0])).toEqual([false, true]);
    await controller.read(false); await flush();
    expect(request).toHaveBeenLastCalledWith(false);
  });
});

describe('the chart and the panel read one URL, so the API answers both with one request', () => {
  test('the panel reads the shared status set and passes its freshness through', () => {
    const panel = src('components/OpenOrdersPanel.tsx');
    expect(panel).toContain('createSpotReadController(fresh => api.getMyOrders(SPOT_OPEN_ORDER_STATUSES, { fresh })');
    expect(SPOT_OPEN_ORDER_STATUSES).toBe('PENDING_TRIGGER,OPEN,PARTIALLY_FILLED');
  });

  test('the chart reads the same set (literal: its harness enumerates imports) and keeps only trigger orders', () => {
    const chart = src('components/PriceChart.tsx');
    expect(chart).toContain(`.getMyOrders('${SPOT_OPEN_ORDER_STATUSES}')`);
    expect(chart).toContain(`.getMyOrders('${SPOT_OPEN_ORDER_STATUSES}', { fresh: true })`);
    expect(chart).not.toMatch(/getMyOrders\('PENDING_TRIGGER'\)/);
    expect(chart.match(/o\.pair === pair && o\.status === 'PENDING_TRIGGER'/g)).toHaveLength(2);
  });

  test('the API coalesces /orders/me by URL inside a 1.5 s window and honours fresh', () => {
    const api = src('lib/api.ts');
    expect(api).toContain("import { createReadCoalescer } from './readCoalescer';");
    expect(api).toContain('const readSpotOrders = createReadCoalescer<SpotOrderRecord[]>(1500);');
    expect(api).toMatch(/getMyOrders: \(status\?: string, options\?: \{ fresh\?: boolean \}\) =>\s*readSpotOrders\(\s*`\/orders\/me\$\{status \? `\?status=\$\{status\}` : ''\}`,/);
    expect(api).toContain('options?.fresh,');
  });
});
