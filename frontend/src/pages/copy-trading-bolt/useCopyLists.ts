import { useCallback, useEffect, useState } from 'react';

// The two per-user lists the marketplace tabs are built on: traders the
// user starred, and traders the user is actually copying. Both live in
// localStorage so they survive a reload and a navigation away from the
// page — the same approach the trade pages already use for favourite
// pairs (see lib/pairList.ts).
//
// Following is deliberately NOT a synonym for "starred": starring is a
// bookmark anyone can use, while following means capital is being copied,
// which is why only an eligible account can add to it (see CopyButton).

const FAVORITES_KEY = 'voltex_copy_favorites';
const FOLLOWING_KEY = 'voltex_copy_following';

function load(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    // Private mode, cleared storage, or a value some other tab corrupted —
    // an empty list is the correct fallback, never an error.
    return new Set();
  }
}

// Same-document sync. The `storage` event only fires in OTHER tabs, so
// without this a card's star and the profile's star would each hold their
// own copy of the list and disagree until a reload.
const SYNC_EVENT = 'voltex-copy-lists-changed';

function save(key: string, value: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    // Storage full or blocked: the list still works for this session.
  }
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: key }));
}

function useIdSet(key: string) {
  const [ids, setIds] = useState<Set<string>>(() => load(key));

  // Keep two open tabs in agreement — copying a trader in one should show
  // up in the other's Following tab rather than being silently overwritten
  // the next time either one writes.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === key) setIds(load(key));
    }
    function onLocalChange(e: Event) {
      if ((e as CustomEvent<string>).detail === key) setIds(load(key));
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener(SYNC_EVENT, onLocalChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SYNC_EVENT, onLocalChange);
    };
  }, [key]);

  const toggle = useCallback((id: string) => {
    setIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      save(key, next);
      return next;
    });
  }, [key]);

  const remove = useCallback((id: string) => {
    setIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      save(key, next);
      return next;
    });
  }, [key]);

  return { ids, toggle, remove };
}

export function useFavorites() {
  const { ids, toggle } = useIdSet(FAVORITES_KEY);
  return { favorites: ids, toggleFavorite: toggle };
}

export function useFollowing() {
  const { ids, toggle, remove } = useIdSet(FOLLOWING_KEY);
  return { following: ids, toggleFollowing: toggle, stopFollowing: remove };
}
