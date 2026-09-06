import type { ReactNode } from 'react';
import { useCopyTradingNotice } from './CopyTradingNotice';

/** Duplicate Copy copy is omitted only within the scope that renders its
 * contextual results notice. Standalone components still disclose their source. */
export function ReviewDisclosure({ children, neutral = null }: { children: ReactNode; neutral?: ReactNode }) {
  return useCopyTradingNotice() ? neutral : children;
}
