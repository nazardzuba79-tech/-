/**
 * Seeded randomness shared by the test-market simulation and its realism
 * layer. Pure: no clock, no Math.random. Every stream is named by
 * (seed, labels…), so a draw never depends on what was generated before it.
 */

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast and well distributed for this purpose. */
function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator for one labelled stream, e.g. seededRandom(seed, 'hour', 37). */
export function seededRandom(seed: string, ...labels: (string | number)[]): () => number {
  return mulberry32(fnv1a([seed, ...labels].join('|')));
}

/** Standard normal, clamped to ±3.2 so a single draw can never produce an absurd candle. */
export function normal(random: () => number): number {
  let u = random();
  while (u <= Number.EPSILON) u = random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  return Math.max(-3.2, Math.min(3.2, z));
}
