export interface CfdTickerFreshnessRow {
  status?: string;
  stale?: boolean;
  executionAllowed?: boolean;
  displayOnly?: boolean;
  providerTimestamp?: number | null;
  fetchedAt?: number | null;
  maxQuoteAgeMs?: number;
  referenceValidUntil?: number;
  referenceLabel?: string;
}

/** Browser clocks do not refresh source data. Between polls, locally expire
 * both executable quotes and display-only references so the UI never keeps a
 * formally expired observation green just because its next HTTP poll is later.
 * Any corrupted/non-array state fails closed to an empty row set rather than
 * throwing inside the polling timer. */
export function ageCfdTickerRows<T extends CfdTickerFreshnessRow>(rows: T[] | unknown, now = Date.now()): T[] {
  if (!Array.isArray(rows)) return [];
  let changed = false;
  const next = rows.map((row) => {
    let stale = row.stale === true;
    let executionAllowed = row.executionAllowed === true;
    let status = row.status;
    let referenceLabel = row.referenceLabel;

    if (row.displayOnly === true) {
      if (typeof row.referenceValidUntil === 'number' && Number.isFinite(row.referenceValidUntil) && now > row.referenceValidUntil) {
        stale = true; executionAllowed = false; status = 'stale';
        if (referenceLabel && !referenceLabel.startsWith('Last known')) referenceLabel = `Last known · ${referenceLabel}`;
      }
    } else if (row.status === 'live') {
      const age = row.maxQuoteAgeMs;
      const times = [row.providerTimestamp, row.fetchedAt];
      const expired = typeof age !== 'number' || !Number.isFinite(age) || age < 250 || age > 10_000
        || times.some(t => typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || t > now + 1000 || now - t > age);
      if (expired) { stale = true; executionAllowed = false; status = 'stale'; }
    }

    if (stale !== row.stale || executionAllowed !== row.executionAllowed || status !== row.status || referenceLabel !== row.referenceLabel) {
      changed = true;
      return { ...row, stale, executionAllowed, status, ...(referenceLabel === undefined ? {} : { referenceLabel }) } as T;
    }
    return row as T;
  });
  return changed ? next : rows as T[];
}
