import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { SpotPairReferences } from './spotPeriodReturns';

type CachedReferences = { value: SpotPairReferences; bucket: number; retryAt: number };
const cache = new Map<string, CachedReferences>();
const pending = new Map<string, Promise<void>>();
const bucketAt = () => Math.floor(Date.now() / 900000);

function publishReferences(pair: string, incoming: SpotPairReferences, bucket: number) {
  const current = cache.get(pair);
  // A slow pre-boundary query must not erase a newer query's references.
  // Same-bucket failures/partial replies may fill gaps, never erase a valid
  // immutable close already obtained by another overlapping batch.
  if (bucket < bucketAt() || (current && current.bucket > bucket)) return;
  const value = current?.bucket === bucket ? {
    pair, day: current.value.day ?? incoming.day, week: current.value.week ?? incoming.week,
  } : incoming;
  cache.set(pair, { value, bucket, retryAt: value.day && value.week ? (bucket + 1) * 900000 : Date.now() + 60000 });
}

async function loadBatch(pairs: string[]) {
  const bucket = bucketAt();
  // The old bucket's pending request must not prevent a fresh-boundary read.
  const key = `${bucket}:${[...pairs].sort().join(',')}`;
  if (pending.has(key)) return pending.get(key)!;
  const promise = (async () => {
    try {
      const response = await api.getSpotPeriodReferences(pairs);
      const responseBucket = Number.isFinite(response.asOf) ? Math.floor(response.asOf / 900000) : bucket;
      for (const pair of pairs) {
        const value = response.references.find(row => row.pair === pair) ?? { pair, day: null, week: null };
        publishReferences(pair, value, responseBucket);
      }
    } catch {
      for (const pair of pairs) publishReferences(pair, { pair, day: null, week: null }, bucket);
    }
    while (cache.size > 3000) cache.delete(cache.keys().next().value!);
  })().finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

/** Quote/search changes prioritize newly visible pairs but reuse every valid
 * reference. Sorting/favourites never restart provider work for cached pairs.
 * Six-pair sequential batches are shared and the server has its own global
 * concurrency bound. A missing reference remains an honest em dash. */
export function useSpotPeriodReferences(pairs: readonly string[], enabled: boolean) {
  const latestPairs = useRef(pairs);
  latestPairs.current = pairs;
  const signature = [...pairs].sort().join(',');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let running = false;
    async function hydrate() {
      if (running) return;
      running = true;
      const missing = latestPairs.current.filter(pair => {
        const hit = cache.get(pair);
        return !hit || hit.bucket !== bucketAt() || hit.retryAt <= Date.now();
      });
      if (missing.length) setLoading(true);
      for (let index = 0; !cancelled && index < missing.length; index += 6) {
        await loadBatch(missing.slice(index, index + 6));
        if (!cancelled) setRevision(value => value + 1);
      }
      if (!cancelled) setLoading(false);
      running = false;
    }
    void hydrate();
    const timer = window.setInterval(() => void hydrate(), 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [enabled, signature]);
  // revision publishes cache writes without coupling history requests to the
  // live ticker's four-second price updates.
  void revision;
  return { references: new Map([...cache].filter(([, hit]) => hit.bucket === bucketAt()).map(([pair, hit]) => [pair, hit.value])), loading };
}
