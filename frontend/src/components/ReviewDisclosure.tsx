import type { ReactNode } from 'react';

/** Isolated review already has its persistent, explicit synthetic-data banner.
 * Remove duplicate product copy there only; never conceal it in normal builds. */
export function ReviewDisclosure({ children, neutral = null }: { children: ReactNode; neutral?: ReactNode }) {
  return import.meta.env.MODE === 'review' ? neutral : children;
}
