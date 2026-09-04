import { loadFavorites, saveFavorites, subscribeFavorites } from '../pairList';

/**
 * Favourites used to be a snapshot each component took once at mount, so
 * starring a pair on Markets left the terminal's own list showing the
 * pre-star set until a reload. saveFavorites now notifies, which is what
 * lets every surface share one live set (see lib/useFavorites).
 *
 * These run without a DOM: loadFavorites/saveFavorites already swallow the
 * absence of localStorage, and the notification path is what is under test.
 */
describe('favourites store notifications', () => {
  it('notifies subscribers when favourites are saved', () => {
    const seen: string[][] = [];
    const unsubscribe = subscribeFavorites((favs) => seen.push([...favs].sort()));

    saveFavorites(new Set(['BTC/USDT']));
    saveFavorites(new Set(['BTC/USDT', 'ETH/USDT']));

    expect(seen).toEqual([['BTC/USDT'], ['BTC/USDT', 'ETH/USDT']]);
    unsubscribe();
  });

  it('hands each subscriber its own copy, so one cannot mutate another', () => {
    let received: Set<string> | null = null;
    const unsubscribe = subscribeFavorites((favs) => {
      received = favs;
    });

    const saved = new Set(['SOL/USDT']);
    saveFavorites(saved);
    received!.add('MUTATED');

    expect(saved.has('MUTATED')).toBe(false);
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribeFavorites(() => {
      calls += 1;
    });
    saveFavorites(new Set(['BTC/USDT']));
    unsubscribe();
    saveFavorites(new Set(['ETH/USDT']));

    expect(calls).toBe(1);
  });

  it('survives having no storage at all rather than throwing', () => {
    expect(() => saveFavorites(new Set(['BTC/USDT']))).not.toThrow();
    expect(loadFavorites()).toBeInstanceOf(Set);
  });
});
