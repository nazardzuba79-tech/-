import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  isListingPreviewPair, LISTING_PREVIEW_MESSAGE, LISTING_PREVIEW_STAGES, LISTING_PREVIEW_STATUS, listingPreviewTicker,
  matchesListingPreviewSearch, readListingPreviewFlag, readListingPreviewStage, saveListingPreviewStage,
  withListingPreviewTicker, withoutListingPreview,
} from '../listingPreview';

const src = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

describe('the preview is off unless the owner turns it on, and stays as chosen', () => {
  test('off by default', () => {
    expect(readListingPreviewFlag('', memory())).toBe(false);
    expect(readListingPreviewFlag('?pair=VTA%2FUSDT', memory())).toBe(false);
  });
  test('?listingPreview=1 turns it on and a reload without the parameter keeps it on', () => {
    const storage = memory();
    expect(readListingPreviewFlag('?listingPreview=1', storage)).toBe(true);
    expect(readListingPreviewFlag('', storage)).toBe(true);
    expect(readListingPreviewFlag('?listingPreview=0', storage)).toBe(false);
    expect(readListingPreviewFlag('', storage)).toBe(false);
  });
  test('a blocked storage still honours the URL and never throws', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(readListingPreviewFlag('?listingPreview=1', broken)).toBe(true);
    expect(readListingPreviewFlag('', broken)).toBe(false);
    expect(readListingPreviewStage(broken)).toBe('before');
  });
  test('the chosen stage survives a reload', () => {
    const storage = memory();
    expect(readListingPreviewStage(storage)).toBe('before');
    saveListingPreviewStage('soon', storage);
    expect(readListingPreviewStage(storage)).toBe('soon');
  });
});

describe('frozen: fixed digits, no clock, no timer, no request', () => {
  test('every stage is a constant display', () => {
    expect(LISTING_PREVIEW_STAGES.before.countdown).toEqual(['01', '06', '12', '00']);
    expect(LISTING_PREVIEW_STAGES.soon.countdown).toEqual(['00', '00', '00', '20']);
  });
  test('the preview code reads no clock, schedules nothing and fetches nothing', () => {
    for (const file of ['lib/listingPreview.ts', 'components/ListingPreviewTerminal.tsx', 'pages/markets-bolt/ListingPreviewStrip.tsx']) {
      const code = src(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect({ file, clock: /Date\.now|new Date|performance\.now/.test(code) }).toEqual({ file, clock: false });
      expect({ file, timer: /setInterval|setTimeout|requestAnimationFrame/.test(code) }).toEqual({ file, timer: false });
      expect({ file, network: /fetch\(|api\.|XMLHttpRequest|WebSocket/.test(code) }).toEqual({ file, network: false });
    }
  });
});

describe('nothing can trade', () => {
  const page = src('pages/TradePage.tsx');
  const panels = src('components/ListingPreviewTerminal.tsx');
  test('the preview pair gets the preview panels, never the order form, the book fetch or the chart', () => {
    expect(page).toContain('const previewPair = listingPreview && isListingPreviewPair(pair);');
    expect(page).toContain('? <ListingPreviewOrderPanel key={pair} />');
    expect(page).toContain("marketType !== 'spot' || previewPair || document.hidden) return;");
    expect(page).toContain('{previewPair ? <ListingPreviewCard /> : <PriceChart');
  });
  test('Buy and Sell only show the message', () => {
    expect(panels.match(/onClick=\{refuse\}/g)).toHaveLength(2);
    expect(panels).toContain('aria-disabled="true"');
    expect(LISTING_PREVIEW_MESSAGE).toBe('VOLTORA is a test asset and is not available for trading.');
    expect(LISTING_PREVIEW_STATUS).toBe('TEST · NOT TRADABLE');
  });
});

describe('lists', () => {
  const btc = { pair: 'BTC/USDT', lastPrice: '1', bidPrice: '1', askPrice: '1', high24h: '1', low24h: '1', volume24h: '1', quoteVolume24h: '1', changePercent24h: '0' };
  test('the row is added only while the preview is on, and only next to a loaded list', () => {
    const venue = new Map([['BTC/USDT', btc]]);
    expect(withListingPreviewTicker(venue, false)).toBe(venue);
    expect(withListingPreviewTicker(new Map(), true).size).toBe(0);
    const merged = withListingPreviewTicker(venue, true);
    expect([...merged.keys()]).toEqual(['BTC/USDT', 'VTA/USDT']);
    expect(venue.size).toBe(1);
  });
  test('every figure of the row is empty (a dash), never a zero', () => {
    const row = listingPreviewTicker();
    expect([row.lastPrice, row.changePercent24h, row.quoteVolume24h]).toEqual(['', '', '']);
  });
  test('market summaries leave it out; search finds it', () => {
    expect(withoutListingPreview([btc, listingPreviewTicker()]).map((r) => r.pair)).toEqual(['BTC/USDT']);
    expect(src('pages/markets-bolt/components.tsx')).toContain('setTickers(withoutListingPreview(Array.from(tickerMap.values())))');
    for (const q of ['', 'vta', 'VTA/USDT', 'voltora', 'Volt']) expect(matchesListingPreviewSearch(q)).toBe(true);
    expect(matchesListingPreviewSearch('btc')).toBe(false);
    expect(isListingPreviewPair('vta/usdt')).toBe(true);
    expect(isListingPreviewPair('BTC/USDT')).toBe(false);
  });
});
