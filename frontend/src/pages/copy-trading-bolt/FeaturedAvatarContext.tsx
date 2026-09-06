import { createContext, useContext } from 'react';

// The featured strategy leader's real photo, fetched once for the page and
// read wherever that trader's avatar is drawn (marketplace card, grid card,
// profile header). A context rather than a prop because the avatar renders
// at three different depths and threading it through every component in
// between would be the only reason those components took the prop at all.
//
// Null is the normal case, not an error: no photo uploaded yet, or the
// request failed. Every consumer falls back to the initials circle.

const FeaturedAvatarContext = createContext<string | null>(null);

export function FeaturedAvatarProvider({ children, ownerAvatar }: { children: React.ReactNode; ownerAvatar: string | null }) {
  // Only the explicit strategy-owner identity is eligible. Never fall back to
  // the viewer or the legacy oldest-admin endpoint while this read is pending.
  return <FeaturedAvatarContext.Provider value={ownerAvatar}>{children}</FeaturedAvatarContext.Provider>;
}

export function useFeaturedAvatar(): string | null {
  return useContext(FeaturedAvatarContext);
}
