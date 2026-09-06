import type { ReactNode } from 'react';

/** Isolated review labels modeled results beside Copy Trading metrics.
 * Remove duplicate prose there only; preserve disclosure in normal builds. */
export function ReviewDisclosure({ children, neutral = null }: { children: ReactNode; neutral?: ReactNode }) {
  return import.meta.env.MODE === 'review' ? neutral : children;
}
