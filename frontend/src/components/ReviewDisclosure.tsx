import type { ReactNode } from 'react';

/** Source-aware local labels carry provenance. Preserve only neutral product
 * information; no build mode can restore the former disclosure paragraphs. */
export function ReviewDisclosure({ neutral = null }: { children: ReactNode; neutral?: ReactNode }) {
  return neutral;
}
