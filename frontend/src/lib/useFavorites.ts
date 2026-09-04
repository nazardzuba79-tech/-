import { useCallback, useEffect, useState } from 'react';
import { loadFavorites, saveFavorites, subscribeFavorites } from './pairList';

/**
 * The favourite-pairs set, live.
 *
 * Every surface that shows favourites (the spot terminal's pair list, the
 * futures pair list, Markets and the homepage market table) used to hold
 * its own `useState(loadFavorites)` snapshot taken once at mount. Starring
 * a pair in one of them left the others showing the pre-star set until the
 * page was reloaded. This hook keeps one shared store (still localStorage,
 * still the same key) and re-renders every consumer on a change — including
 * one made in another browser tab.
 *
 * `toggle` persists, which is what broadcasts the change; callers that only
 * read favourites can ignore it.
 */
export function useFavorites(): { favorites: Set<string>; toggle: (pair: string) => void } {
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);

  useEffect(() => subscribeFavorites(setFavorites), []);

  const toggle = useCallback((pair: string) => {
    // Read the store rather than closing over state: two toggles in the
    // same tick must not lose the first one.
    const next = loadFavorites();
    if (next.has(pair)) next.delete(pair);
    else next.add(pair);
    saveFavorites(next);
    setFavorites(next);
  }, []);

  return { favorites, toggle };
}
