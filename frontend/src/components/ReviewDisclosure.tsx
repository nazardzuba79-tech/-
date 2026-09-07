import type { ReactNode } from 'react';

/**
 * Review/development disclosure copy is intentionally not rendered in the
 * customer-facing product UI. Source-aware labels beside modeled figures are
 * handled separately by ModeledDataLabel.
 */
export function ReviewDisclosure(_: { children: ReactNode; neutral?: ReactNode }) {
  return null;
}
