import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import type { SpotPairReferences, SpotPeriodReferencesResponse } from '../spotPeriodReturns';

type CacheHit = { value: SpotPairReferences; bucket: number; retryAt: number };
function harness() {
  let now = 100 * 900000 + 899000;
  const queries: Array<{ pairs: string[]; resolve(value: SpotPeriodReferencesResponse): void; reject(error: Error): void }> = [];
  const api = { getSpotPeriodReferences: (pairs: string[]) => new Promise<SpotPeriodReferencesResponse>((resolve, reject) => queries.push({ pairs, resolve, reject })) };
  // Run the actual cache/async loader; React is not mounted and the API only
  // supplies deferred responses. No production internals are exported for QA.
  const source = fs.readFileSync(path.resolve(__dirname, '../useSpotPeriodReferences.ts'), 'utf8') + '\nexport { cache, loadBatch };';
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const module = { exports: {} as { cache: Map<string, CacheHit>; loadBatch(pairs: string[]): Promise<void> } };
  vm.runInNewContext(compiled, { module, exports: module.exports, Date: { now: () => now },
    require: (name: string) => name === './api' ? { api } : name === 'react' ? {} : (() => { throw new Error(`Unexpected import: ${name}`); })(),
  });
  return { ...module.exports, queries, time: () => now, advance: (ms: number) => { now += ms; } };
}
const complete = (pair: string, price: number): SpotPairReferences => ({ pair, day: { price, time: 10 }, week: { price: price - 1, time: 1 } });
const response = (asOf: number, ...references: SpotPairReferences[]): SpotPeriodReferencesResponse => ({ asOf, resolutionSeconds: 900, references });

test.each(['resolve', 'reject'] as const)('late old-bucket %s cannot overwrite the newer same-pair references', async outcome => {
  const h = harness();
  const oldAsOf = h.time();
  const old = h.loadBatch(['BTC/USD']);
  h.advance(2000);
  const fresh = h.loadBatch(['BTC/USD']);
  expect(h.queries).toHaveLength(2); // old pending batch does not block refresh
  h.queries[1].resolve(response(h.time(), complete('BTC/USD', 110)));
  await fresh;
  const newest = h.cache.get('BTC/USD');
  if (outcome === 'resolve') h.queries[0].resolve(response(oldAsOf, complete('BTC/USD', 90)));
  else h.queries[0].reject(new Error('late failure'));
  await old;
  expect(h.cache.get('BTC/USD')).toBe(newest);
  expect(h.cache.get('BTC/USD')?.value.day?.price).toBe(110);
});
test.each(['resolve', 'reject'] as const)('same-bucket overlapping %s cannot erase valid cached history', async outcome => {
  const h = harness();
  const stale = h.loadBatch(['BTC/USD']);
  const fresh = h.loadBatch(['BTC/USD', 'ETH/USD']);
  h.queries[1].resolve(response(h.time(), complete('BTC/USD', 110), complete('ETH/USD', 220)));
  await fresh;
  const expected = h.cache.get('BTC/USD');
  if (outcome === 'resolve') h.queries[0].resolve(response(h.time(), { pair: 'BTC/USD', day: null, week: null }));
  else h.queries[0].reject(new Error('failure'));
  await stale;
  expect(h.cache.get('BTC/USD')).toEqual(expected);
});
test('a partial response preserves obtained closes but retries missing references after sixty seconds', async () => {
  const h = harness();
  const partial = h.loadBatch(['BTC/USD']);
  h.queries[0].resolve(response(h.time(), { pair: 'BTC/USD', day: { price: 110, time: 10 }, week: null }));
  await partial;
  expect(h.cache.get('BTC/USD')?.retryAt).toBe(h.time() + 60000);
  const failed = h.loadBatch(['BTC/USD', 'ETH/USD']);
  h.queries[1].reject(new Error('unavailable'));
  await failed;
  expect(h.cache.get('BTC/USD')?.value.day?.price).toBe(110);
  expect(h.cache.get('BTC/USD')?.value.week).toBeNull();
  expect(h.cache.get('ETH/USD')?.value).toEqual({ pair: 'ETH/USD', day: null, week: null });
  expect(h.cache.get('ETH/USD')?.retryAt).toBe(h.time() + 60000);
});
test('response received after the boundary uses the server reference bucket, not request-start bucket', async () => {
  const h = harness();
  const pending = h.loadBatch(['BTC/USD']);
  h.advance(2000);
  h.queries[0].resolve(response(h.time(), complete('BTC/USD', 110)));
  await pending;
  expect(h.cache.get('BTC/USD')?.bucket).toBe(Math.floor(h.time() / 900000));
});
