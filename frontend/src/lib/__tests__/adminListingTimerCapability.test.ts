import { readFileSync } from 'fs';
import { resolve } from 'path';
import { listingTimerSupported } from '../../pages/admin/listingTimerCapability';
import type { AdminListing } from '../../pages/admin/adminListingsApi';

/**
 * The admin page offers a hidden («staged») first publication and the timer
 * buttons only when the API proves it runs the timer: the API deployed before
 * the timer (2e7acf1) drops the staged flag and would publish at once
 * (scripts/qa-listing-timer-api.cjs: 2/10 there, 10/10 on main and PR #578).
 */
const listing = (extra: Record<string, unknown> = {}) => ({ id: 'qtx', draftRevision: 1, activeVersion: null, active: null, versions: [], ...extra }) as unknown as AdminListing;

test('the timer is supported only when the API returns the countdown key (null counts)', () => {
  expect(listingTimerSupported(null)).toBe(false);
  expect(listingTimerSupported([])).toBe(false);
  expect(listingTimerSupported([listing()])).toBe(false);
  expect(listingTimerSupported([listing(), listing({ countdown: null })])).toBe(true);
  expect(listingTimerSupported([listing({ countdown: { state: 'staged', updatedAt: 1, updatedBy: 'a' } })])).toBe(true);
});

test('the page sends «staged» and shows the timer buttons only on a timer-capable API, and says so otherwise', () => {
  const page = readFileSync(resolve(__dirname, '../../pages/admin/AdminListingsPage.tsx'), 'utf8');
  expect(page).toContain('const timerSupported = listingTimerSupported(listings);');
  expect(page).toContain('const staged = timerSupported && publishing.listing.activeVersion === null && !publishing.startTimer;');
  expect(page).toContain('listingTimerStatus(listing, Date.now() + clockOffsetMs, timerSupported)');
  expect(page).toMatch(/if \(!timerSupported\) \{\s*const status = listingTimerStatus\(listing, serverNow\);\s*return status && \{ \.\.\.status, actions: \[\] \};/);
  expect(page).toMatch(/publishing\.listing\.activeVersion === null && !timerSupported \? \(\s*<p className="listing-hint" role="alert" data-publish-timer-unsupported>Сервер API пока без таймера листинга: рынок и обратный отсчёт появятся на бирже сразу после публикации/);
});
