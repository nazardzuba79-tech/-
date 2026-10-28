import { catalogueQuery, settleCatalogue, type CatalogueCache } from '../../pages/stocks/global/catalogueVersion';

// #613: the terminal keeps the last full catalogue and asks the gateway to leave it out while it is current.
describe('Stocks catalogue version', () => {
  const list = [{ id: 'BYBIT:AAPLXUSDT' }, { id: 'BYBIT:TSLAXUSDT' }];
  const version = '0123456789abcdef';

  it('asks for the full catalogue until it holds one, then names its version', () => {
    expect(catalogueQuery(null)).toBe('');
    expect(catalogueQuery({ version, list })).toBe('&catalogue=0123456789abcdef');
  });

  it('keeps a full answer and its version', () => {
    expect(settleCatalogue(null, { catalogue: list, catalogueVersion: version })).toEqual({ list, cache: { version, list } });
  });

  it('completes an answer without the catalogue from the cache of the same version', () => {
    const cache: CatalogueCache<{ id: string }> = { version, list };
    const settled = settleCatalogue(cache, { catalogueVersion: version });
    expect(settled?.list).toBe(list);
    expect(settled?.cache).toBe(cache);
  });

  it('never invents a catalogue: another version, no cache or a malformed version cannot be completed', () => {
    expect(settleCatalogue({ version, list }, { catalogueVersion: 'fedcba9876543210' })).toBeNull();
    expect(settleCatalogue(null, { catalogueVersion: version })).toBeNull();
    expect(settleCatalogue({ version, list }, {})).toBeNull();
    // A full answer with a malformed version is shown but not kept, so the next read asks in full again.
    expect(settleCatalogue(null, { catalogue: list, catalogueVersion: 'NOT-HEX' })).toEqual({ list, cache: null });
  });
});
