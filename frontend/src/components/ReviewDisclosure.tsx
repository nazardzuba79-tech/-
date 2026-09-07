import type { ReactNode } from 'react';

/** Provenance is shown by source-aware labels beside the actual figures.
 * Keep only the existing neutral product/methodology information here. */
export function ReviewDisclosure({ neutral = null }: { children: ReactNode; neutral?: ReactNode }) {
  return neutral;
}
