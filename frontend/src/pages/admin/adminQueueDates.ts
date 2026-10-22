import { adminDayBoundary } from './adminPresentation';

/** Inclusive calendar days in the displayed admin timezone, including DST. */
export function adminQueueDateBounds(from: string, to: string): { from?: string; to?: string } {
  // Invalid deep links remain invalid for the authoritative API validator;
  // never silently discard a requested filter and display a broader queue.
  return { ...(from ? { from: adminDayBoundary(from) ?? from } : {}), ...(to ? { to: adminDayBoundary(to, true) ?? to } : {}) };
}
