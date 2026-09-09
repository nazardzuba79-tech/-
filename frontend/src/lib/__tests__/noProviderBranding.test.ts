import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

/**
 * The VOLTEX product surface names no upstream provider or outside venue.
 *
 * This is a PRESENTATION rule, not a data-contract change: `source`,
 * `venues`, `turnoverVenues`, `openInterestBaseVenues` and
 * `openInterestUsdVenues` are all still populated, still typed, and still
 * asserted elsewhere in this suite. They stop at the network boundary
 * instead of reaching the screen. See docs/MARKET_DATA_ARCHITECTURE.md
 * §17.
 *
 * Two layers, because either alone has a hole:
 *
 *   1. Every user-visible string in the dictionary. A provider name added
 *      to one of seven languages is still a provider name on screen.
 *   2. Executable code of the customer-facing components, comments
 *      stripped. A name hardcoded into JSX never passes through i18n, so
 *      layer 1 would not see it.
 */

const frontend = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');

/** Provider and venue names, plus the wording that named them
 *  indirectly. `Kraken` is matched as a whole word so `krakenSocket`,
 *  an internal identifier, does not trip it — identifiers are not text. */
const BRANDING =
  /\b(binance|okx|coingecko|coin gecko|twelvedata|twelve data|alternative\.me|bybit|deribit|bitget)\b|\bkraken\b|tracked venue|external venue|отслеживаем\w* площадк|внешн\w* бирж|外部交易所|追踪交易所/i;

/** Source with comments removed: these are claims about what RENDERS.
 *  The files' own comments deliberately record which upstreams the code
 *  talks to, and documenting a provider is not branding it. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the dictionary contains no provider branding', () => {
  const dictionary = read('src/lib/i18n.tsx');
  // Every quoted VALUE in the translation tables, in all seven languages.
  const values = [...dictionary.matchAll(/^\s*'[\w.]+':\s*(.+)$/gm)].map((m) => m[1]);

  it('has translations to check at all', () => {
    // Guards the regex above: a parser that silently matches nothing
    // would make every assertion below vacuously true.
    expect(values.length).toBeGreaterThan(3000);
  });

  it.each(['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'])('is clean across all languages (%s)', () => {
    const offenders = values.filter((v) => BRANDING.test(v));
    expect(offenders).toEqual([]);
  });
});

describe('customer-facing components render no provider branding', () => {
  /**
   * Everything under src/, minus tests and two files that are checked
   * differently:
   *
   *   - `i18n.tsx` — every value is checked above, per language.
   *   - `api.ts` — the DATA CONTRACT, which is exactly where provenance
   *     is supposed to live (`DerivativesVenue`, the asset registry's
   *     provider-id map). It renders nothing. The block below asserts it
   *     still CARRIES that provenance, which is the opposite assertion.
   *
   * Walking the tree rather than listing files is deliberate: a NEW page
   * must be covered by this rule without anyone remembering to add it.
   */
  const EXCLUDED = new Set([join('src', 'lib', 'i18n.tsx'), join('src', 'lib', 'api.ts')]);

  function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(resolve(frontend, dir))) {
      const rel = join(dir, entry);
      if (statSync(resolve(frontend, rel)).isDirectory()) {
        if (entry !== '__tests__' && entry !== 'node_modules') sources(rel, out);
      } else if (/\.(tsx?|css)$/.test(entry) && !EXCLUDED.has(rel)) {
        out.push(rel);
      }
    }
    return out;
  }

  const files = sources('src');


  it('found the frontend sources', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no provider name in any executable line', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const [n, line] of code(read(file)).split('\n').entries()) {
        // The Kraken WebSocket URL is the data path itself, not a label.
        // It is a real leak — visible in devtools — and is recorded as
        // such in §17; closing it needs a server-side fan-out, not a copy
        // change, so it is excluded here rather than silently matched.
        if (line.includes('wss://ws.kraken.com')) continue;
        if (BRANDING.test(line)) offenders.push(`${file}:${n + 1}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('provenance is kept, not deleted', () => {
  it('still travels in the API contract', () => {
    const api = read('src/lib/api.ts');
    for (const field of ['turnoverVenues', 'openInterestBaseVenues', 'openInterestUsdVenues', 'VenueAttribution']) {
      expect(api).toContain(field);
    }
  });

  it('is still produced by the backend service', () => {
    const service = readFileSync(
      resolve(frontend, '..', 'src/services/marketData/derivatives/ExternalDerivativesService.ts'),
      'utf8'
    );
    expect(service).toContain('openInterestBaseVenues');
    expect(service).toContain('turnoverVenues');
  });
});
