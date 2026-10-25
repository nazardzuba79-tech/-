/**
 * LOCAL RESEARCH ONLY. A mint match, DEX listing, GeckoTerminal API match,
 * direct Solana proof, iframe document load and visible chart are different claims.
 * All reported volumes/liquidity are historical third-party snapshots.
 */
import geckoCatalog from './onchainXStocksCatalogue.generated.json';
import { ONCHAIN_EMBED_MARKETS } from './onchainEmbedPreviewData';
import { STOCKS_DISCOVERED_CANDIDATES } from './onchainDiscoveredCandidates';

export type OnchainPoolChoice = Readonly<{
  address: string;
  dex: string;
  verifiedOnChain: boolean;
  geckoIndexed: boolean;
  liquidityUSD: number | null;
  tx24hReported: number | null;
}>;
export type OnchainStockEntry = Readonly<{
  ticker: string;
  name: string;
  mint: string;
  pools: readonly OnchainPoolChoice[];
  activeAtDiscovery: boolean;
  independentlyVerifiedPool: boolean;
  geckoIndexedPool: boolean;
}>;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const issuerPools = geckoCatalog.markets;
const proofByTicker = new Map(ONCHAIN_EMBED_MARKETS.map(m => [m.ticker, m]));

function assertAddress(value: string): void {
  if (!SOLANA_ADDRESS.test(value)) throw new Error('INVALID_SOLANA_ADDRESS');
}

export const STOCKS_ONCHAIN_CATALOGUE: readonly OnchainStockEntry[] = Object.freeze(
  STOCKS_DISCOVERED_CANDIDATES.map(candidate => {
    assertAddress(candidate.mint);
    const proof = proofByTicker.get(candidate.ticker);
    if (proof && proof.mint !== candidate.mint) throw new Error('ISSUER_MINT_CONFLICT');
    const gecko = issuerPools.find(m => m.ticker === candidate.ticker && m.mint === candidate.mint);
    const choices = new Map<string, OnchainPoolChoice>();
    function append(pool: string, dex: string, geckoIndexed: boolean, verifiedOnChain: boolean,
                    liquidityUSD: number | null, tx24hReported: number | null) {
      assertAddress(pool);
      const previous = choices.get(pool);
      choices.set(pool, {
        address: pool, dex,
        geckoIndexed: geckoIndexed || (previous?.geckoIndexed ?? false),
        verifiedOnChain: verifiedOnChain || (previous?.verifiedOnChain ?? false),
        liquidityUSD: liquidityUSD ?? previous?.liquidityUSD ?? null,
        tx24hReported: tx24hReported ?? previous?.tx24hReported ?? null,
      });
    }
    // GeckoTerminal's pool-identity API verified this address; it did NOT verify
    // chart pixels, trading rights or the Solana program's transactions.
    if (gecko) append(gecko.pool, gecko.dex, true, false, gecko.liquidityUSD, gecko.txns24h);
    append(candidate.pool, candidate.dex, false, false, candidate.liquidityUSD, candidate.tx24hReported);
    // Independent Solana proof is attached to exactly the checked pool, not a ticker generally.
    if (proof) append(proof.pool, 'raydium', false, true, null, null);
    const pools = [...choices.values()].sort((a, b) =>
      Number(b.geckoIndexed) - Number(a.geckoIndexed) ||
      Number(b.verifiedOnChain) - Number(a.verifiedOnChain) ||
      (b.tx24hReported ?? 0) - (a.tx24hReported ?? 0)
    );
    return Object.freeze({
      ticker: candidate.ticker,
      name: proof?.name ?? candidate.name,
      mint: candidate.mint,
      pools: Object.freeze(pools),
      activeAtDiscovery: candidate.liquidityUSD >= 2000 && candidate.tx24hReported >= 10,
      independentlyVerifiedPool: pools.some(p => p.verifiedOnChain),
      geckoIndexedPool: pools.some(p => p.geckoIndexed),
    });
  })
);

if (new Set(STOCKS_ONCHAIN_CATALOGUE.map(m => m.ticker)).size !== STOCKS_ONCHAIN_CATALOGUE.length) {
  throw new Error('DUPLICATE_XSTOCKS_TICKER');
}
for (const original of ONCHAIN_EMBED_MARKETS) {
  if (!STOCKS_ONCHAIN_CATALOGUE.some(m => m.ticker === original.ticker && m.mint === original.mint)) {
    throw new Error('MISSING_VERIFIED_XSTOCK');
  }
}

export const STOCKS_QUALITY_COUNTS = Object.freeze({
  candidates: STOCKS_ONCHAIN_CATALOGUE.length,
  activitySnapshot: STOCKS_ONCHAIN_CATALOGUE.filter(m => m.activeAtDiscovery).length,
  withDirectOnchainProof: STOCKS_ONCHAIN_CATALOGUE.filter(m => m.independentlyVerifiedPool).length,
  withGeckoApiProof: STOCKS_ONCHAIN_CATALOGUE.filter(m => m.geckoIndexedPool).length,
  withEitherPoolProof: STOCKS_ONCHAIN_CATALOGUE.filter(m => m.independentlyVerifiedPool || m.geckoIndexedPool).length,
});

export function onchainChartUrl(market: OnchainStockEntry, pool: OnchainPoolChoice): string {
  if (!STOCKS_ONCHAIN_CATALOGUE.some(m => m.ticker === market.ticker && m.mint === market.mint &&
      m.pools.some(p => p.address === pool.address))) throw new Error('UNKNOWN_STOCKS_CHART_POOL');
  const url = new URL('https://www.geckoterminal.com/solana/pools/' + pool.address);
  for (const [k, v] of Object.entries({
    embed: '1', info: '0', swaps: '0', light_chart: '0',
    chart_type: 'price', resolution: '1h', bg_color: '101318',
  })) url.searchParams.set(k, v);
  return url.toString();
}
