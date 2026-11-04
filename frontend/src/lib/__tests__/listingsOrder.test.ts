import { readFileSync } from 'fs';
import { resolve } from 'path';
import { orderListings } from '../listingsOrder';

/**
 * Markets listings strip (owner, 2026-11-04): a phone had no way to see what
 * is about to trade — the strip sat unsorted a long scroll down. «Скоро»
 * leads with the nearest listing date; «Торгуются» leads with the newest
 * live market; the phone draws the strip at the top of the page.
 */
const asset = (pair: string, phase: 'pre-listing' | 'live', listingAt: string) => ({ pair, listingAt, state: { phase } as { phase: 'pre-listing' | 'live' } });

describe('listings order', () => {
  const rows = [
    asset('LATE/USDT', 'pre-listing', '2026-12-20T10:00:00Z'),
    asset('OLD/USDT', 'live', '2026-10-01T10:00:00Z'),
    asset('SOON/USDT', 'pre-listing', '2026-11-10T10:00:00Z'),
    asset('NEW/USDT', 'live', '2026-11-01T10:00:00Z'),
    asset('TBA/USDT', 'pre-listing', 'not-a-date'),
  ];
  test('«Скоро»: countdowns first by nearest date, unconfirmed dates last among them, then live newest first', () => {
    expect(orderListings(rows, 'soon').map(r => r.pair)).toEqual(['SOON/USDT', 'LATE/USDT', 'TBA/USDT', 'NEW/USDT', 'OLD/USDT']);
  });
  test('«Торгуются»: live newest first, then the countdowns by date', () => {
    expect(orderListings(rows, 'live').map(r => r.pair)).toEqual(['NEW/USDT', 'OLD/USDT', 'SOON/USDT', 'LATE/USDT', 'TBA/USDT']);
  });
  test('the phone draws the strip with its heading at the top of the Markets page, the desktop keeps it above the catalogue', () => {
    const page = readFileSync(resolve(__dirname, '../../pages/markets-bolt/components.tsx'), 'utf8');
    expect(page).toContain("const phone = useMediaQuery('(max-width: 900px)');");
    expect(page).toContain('{phone && (\n          <TestMarketsStrip heading top search=""');
    expect(page).toContain("{activeKind === 'Spot' && !phone && (");
    const strip = readFileSync(resolve(__dirname, '../../pages/markets-bolt/TestMarketsStrip.tsx'), 'utf8');
    expect(strip).toContain('data-listing-sort={value}');
    expect(strip).toContain("t('listings.in', { time })");
  });
});
