import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The wall between external analytics data and VOLTEX financial logic.
 *
 * Phase 2 puts Binance and OKX numbers on a VOLTEX page for the first
 * time. The failure mode that matters is not a wrong chart — it is one of
 * those numbers reaching a path that prices, margins or liquidates a real
 * position. A user's liquidation price must depend on VOLTEX's own index
 * and mark price and on nothing else, whatever an external venue says or
 * fails to say.
 *
 * A runtime test cannot prove the absence of a code path, so this reads
 * the shipped financial sources and asserts what they do NOT import and do
 * NOT reference. Structural, deliberately: a future edit that wires an
 * analytics provider into the futures engine fails here rather than in
 * production.
 */

const root = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n');

/** Source with comments removed. The claims below are about executable
 *  code; several of these files DISCUSS external venues in prose in order
 *  to record that they are not used, and a naive substring search would
 *  match the very sentence documenting the separation. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every module that decides money: what a position is worth, what margin
 *  it needs, when it liquidates, what funding it settles, and how orders
 *  match. */
const FINANCIAL_SOURCES = [
  'src/futures/MarkPriceService.ts',
  'src/futures/FundingRateService.ts',
  'src/futures/LiquidationEngine.ts',
  'src/futures/FuturesProtectionService.ts',
  'src/futures/FuturesPositionService.ts',
  'src/futures/FuturesMarketExecution.ts',
  'src/futures/marginMath.ts',
  'src/futures/exposureRisk.ts',
  'src/futures/InsuranceFundService.ts',
  'src/matching-engine/MatchingEngine.ts',
  'src/services/OrderService.ts',
  'src/cfd/CfdPositionService.ts',
];

/** The Phase 2 analytics modules, by file and by exported symbol. */
const ANALYTICS_MODULES = [
  'BinanceDerivativesService',
  'OkxDerivativesService',
  'ExternalDerivativesService',
  'DerivedAnalyticsService',
  'AnalyticsDataService',
];

describe('external analytics data cannot reach VOLTEX financial logic', () => {
  const present = FINANCIAL_SOURCES.filter((p) => {
    try {
      read(p);
      return true;
    } catch {
      return false;
    }
  });

  it('covers the financial modules it claims to cover', () => {
    // A renamed or moved engine must not silently empty this suite.
    expect(present.length).toBeGreaterThanOrEqual(8);
    expect(present).toContain('src/futures/MarkPriceService.ts');
    expect(present).toContain('src/futures/LiquidationEngine.ts');
    expect(present).toContain('src/futures/FundingRateService.ts');
  });

  it.each(present)('%s imports no analytics or external-derivatives module', (path) => {
    const source = code(path);
    for (const moduleName of ANALYTICS_MODULES) {
      expect(source).not.toContain(moduleName);
    }
    expect(source).not.toMatch(/from\s+['"][^'"]*derivatives\/[^'"]*['"]/);
    expect(source).not.toMatch(/from\s+['"][^'"]*analytics\/[^'"]*['"]/);
  });

  it.each(present)('%s never reaches an external venue endpoint', (path) => {
    const source = code(path);
    expect(source).not.toMatch(/fapi\.binance|www\.okx|api\.binance|okx\.com/i);
    // ENDPOINT PATHS, not bare identifiers. `FundingRateService` computes
    // its own `premiumIndex` variable from VOLTEX's own mark and index —
    // that is the separation working, and matching the word alone would
    // fail the very code this test exists to protect.
    expect(source).not.toMatch(/\/fapi\/v1\//);
    expect(source).not.toMatch(/\/api\/v5\/(public|market)\//);
    expect(source).not.toMatch(/\/futures\/data\//);
    expect(source).not.toMatch(/fapi\/v1\/premiumIndex|openInterestHist/);
  });

  it('keeps the analytics service out of every futures and matching construction path', () => {
    // index.ts wires both; the assertion is that the financial services
    // are not GIVEN the analytics ones, not that the file never mentions
    // them. Each financial constructor call is checked for the symbols.
    const index = code('src/index.ts');
    const futuresConstructions = index.match(/new (MarkPriceService|FundingRateService|LiquidationEngine|FuturesPositionService|MatchingEngine)\([^;]*\)/g) ?? [];
    expect(futuresConstructions.length).toBeGreaterThan(0);
    for (const call of futuresConstructions) {
      for (const moduleName of ['externalDerivativesService', 'derivedAnalyticsService', 'analyticsDataService', 'binanceDerivativesService', 'okxDerivativesService']) {
        expect(call).not.toContain(moduleName);
      }
    }
  });

  it('flows in one direction only: analytics reads the futures services, never the reverse', () => {
    const analytics = code('src/services/AnalyticsDataService.ts');
    // Analytics is allowed to READ VOLTEX financial state for its
    // venue-scoped section.
    expect(analytics).toContain('MarkPriceService');
    // And the financial side holds no reference back.
    for (const path of present) {
      expect(code(path)).not.toContain('AnalyticsDataService');
    }
  });

  it('marks external venue values as external in the type system', () => {
    const types = read('src/services/marketData/derivatives/types.ts');
    // Every external row is stamped with the venue that produced it, so a
    // value cannot be moved into a VOLTEX context without carrying the
    // evidence that it is not ours.
    expect(types).toContain("export type DerivativesVenue = 'binance' | 'okx'");
    for (const shape of ['VenueOpenInterest', 'VenueFunding', 'VenueBasis', 'LongShortRatio']) {
      const block = types.slice(types.indexOf(`interface ${shape}`), types.indexOf('}', types.indexOf(`interface ${shape}`)));
      expect(block).toContain('venue: DerivativesVenue');
    }
  });

  it('never lets an external number stand in for a VOLTEX mark or index price', () => {
    const analytics = code('src/services/AnalyticsDataService.ts');
    // The venue-scoped section reads mark/index ONLY from the futures
    // service; the external sections are assembled separately and are
    // never merged into `DerivativesValue`.
    expect(analytics).toContain('this.markPriceService.getMarkPrice');
    expect(analytics).toContain('this.markPriceService.getIndexPrice');
    const contractFn = analytics.slice(analytics.indexOf('private async contract('));
    expect(contractFn).not.toMatch(/binance|okx|external/i);
  });

  it('exposes no write path on any external adapter', () => {
    for (const file of [
      'src/services/marketData/derivatives/BinanceDerivativesService.ts',
      'src/services/marketData/derivatives/OkxDerivativesService.ts',
    ]) {
      const source = code(file);
      // Read-only by construction: no order, no transfer, no signature.
      expect(source).not.toMatch(/method:\s*['"]POST['"]|method:\s*['"]DELETE['"]|method:\s*['"]PUT['"]/);
      expect(source).not.toMatch(/\border\b|withdraw|transfer|signature|hmac/i);
      // And no credential is read from anywhere.
      expect(source).not.toMatch(/process\.env\.[A-Z_]*(KEY|SECRET|TOKEN|PASSPHRASE)/);
    }
  });
});
