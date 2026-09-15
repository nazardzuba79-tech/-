import type { Trader } from './traders';

/**
 * Lightweight invitation-only catalogue.
 *
 * These are fictional VOLTEX demo aliases used only to make the closed
 * marketplace directory feel populated. They have no public profile,
 * performance history, live feed, copied orders, background worker, or
 * financial statistics. The UI intentionally never renders their NaN fields.
 */
const PREFIXES = [
  'Apex','Nova','Atlas','Orbit','Vertex','Zenith','Cipher','Quantum',
  'Pulse','Nexa','Arctic','Solar','Lumen','Echo','Prime','Delta',
  'Vega','Titan','Helix','Onyx','Kairo','Flux','Orion','Cobalt',
] as const;

const SUFFIXES = [
  'Vector','Pulse','Ledger','Signal','Wave','Capital','Edge','Flow','Grid',
  'Matrix','Horizon','Alpha','Node','Peak','Bridge','Core','Spark','Vault',
] as const;

const REGIONS = [
  'Singapore','Japan','South Korea','Hong Kong','United Kingdom','Germany',
  'Switzerland','United Arab Emirates','Australia','Canada','Sweden','Spain',
  'Netherlands','New Zealand','Malaysia','Thailand','Vietnam','Poland',
] as const;

const TONES = ['blue','green','orange','rose','slate','gold'] as const;

export const LOCKED_CATALOGUE_SIZE = PREFIXES.length * SUFFIXES.length; // 432

export const lockedCatalogueTraders: Trader[] = PREFIXES.flatMap((prefix, prefixIndex) =>
  SUFFIXES.map((suffix, suffixIndex) => {
    const index = prefixIndex * SUFFIXES.length + suffixIndex;
    return {
      id: `VX-L${String(index + 1).padStart(3, '0')}`,
      name: `${prefix}${suffix}`,
      initials: `${prefix[0]}${suffix[0]}`,
      tone: TONES[index % TONES.length],
      region: REGIONS[index % REGIONS.length],
      strategy: 'Private Master Trader',
      category: 'multi-asset',
      roi7: Number.NaN,
      roi30: Number.NaN,
      roi90: Number.NaN,
      roiAll: Number.NaN,
      winRate: Number.NaN,
      drawdown: Number.NaN,
      copiers: Number.NaN,
      aum: Number.NaN,
      volume: Number.NaN,
      risk: 'Moderate',
      activeMonths: Number.NaN,
      performanceFee: Number.NaN,
    } satisfies Trader;
  }),
);
