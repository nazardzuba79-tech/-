import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../../lib/api';

// The featured strategy leader's real photo, fetched once for the page and
// read wherever that trader's avatar is drawn (marketplace card, grid card,
// profile header). A context rather than a prop because the avatar renders
// at three different depths and threading it through every component in
// between would be the only reason those components took the prop at all.
//
// Null is the normal case, not an error: no photo uploaded yet, or the
// request failed. Every consumer falls back to the initials circle.

const FeaturedAvatarContext = createContext<string | null>(null);

export function FeaturedAvatarProvider({ children }: { children: React.ReactNode }) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    api
      .getFeaturedTraderAvatar()
      .then((res) => setAvatarUrl(res.avatarUrl))
      .catch(() => {});
  }, []);

  return <FeaturedAvatarContext.Provider value={avatarUrl}>{children}</FeaturedAvatarContext.Provider>;
}

export function useFeaturedAvatar(): string | null {
  return useContext(FeaturedAvatarContext);
}
