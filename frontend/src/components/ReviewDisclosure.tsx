import type { ReactNode } from 'react';
import { useGlobalPrelaunchNotice } from './PrelaunchNotice';

/** Duplicate product copy can be omitted only when the application itself
 * renders the clear global notice. Outside that provider disclosure fails open. */
export function ReviewDisclosure({ children, neutral = null }: { children: ReactNode; neutral?: ReactNode }) {
  return useGlobalPrelaunchNotice() ? neutral : children;
}
