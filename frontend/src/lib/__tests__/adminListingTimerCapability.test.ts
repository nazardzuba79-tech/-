import { readFileSync } from 'fs';
import { resolve } from 'path';
import { listingPublicationAllowed, listingTimerSupported } from '../../pages/admin/listingTimerCapability';
import type { AdminListing } from '../../pages/admin/adminListingsApi';

/**
 * The admin page sends a first publication — hidden («staged») until
 * «Запустить таймер», or with the timer — only when the API proves it runs the
 * timer: the API deployed before the timer (2e7acf1) drops the staged flag and
 * would publish at once (scripts/qa-listing-timer-api.cjs: 2/10 there, 10/10
 * on main and PR #578). Owner, PR #585: a new listing stays private until its
 * separate approval, so against such an API the first publication is not sent.
 */
const listing = (extra: Record<string, unknown> = {}) => ({ id: 'qtx', draftRevision: 1, activeVersion: null, active: null, versions: [], ...extra }) as unknown as AdminListing;

test('the timer is supported only when the API returns the countdown key (null counts); an empty or unread list fails closed', () => {
  expect(listingTimerSupported(null)).toBe(false);
  expect(listingTimerSupported([])).toBe(false);
  expect(listingTimerSupported([listing()])).toBe(false);
  expect(listingTimerSupported([listing(), listing({ countdown: null })])).toBe(true);
  expect(listingTimerSupported([listing({ countdown: { state: 'staged', updatedAt: 1, updatedBy: 'a' } })])).toBe(true);
});

test('a first publication needs the timer; a listing that is already public may be re-published on either API', () => {
  expect(listingPublicationAllowed(listing(), false)).toBe(false);
  expect(listingPublicationAllowed(listing(), true)).toBe(true);
  expect(listingPublicationAllowed(listing({ activeVersion: 1 }), false)).toBe(true);
  expect(listingPublicationAllowed(listing({ activeVersion: 1 }), true)).toBe(true);
});

test('every way to a first publication goes through the same rule: button, its handler, the confirmation and its handler', () => {
  const page = readFileSync(resolve(__dirname, '../../pages/admin/AdminListingsPage.tsx'), 'utf8');
  expect(page).toContain('const timerSupported = listingTimerSupported(listings);');
  expect(page).toContain('const publicationBlocked = Boolean(current && !listingPublicationAllowed(current, timerSupported));');
  expect(page).toContain('disabled={busy || !draftIsSaved || historicalMode || publicationBlocked} onClick={openPublish} data-publish');
  expect(page).toMatch(/function openPublish\(\) \{\s*if \(!current \|\| busy \|\| !draftIsSaved \|\| !listingPublicationAllowed\(current, timerSupported\)\) return;/);
  expect(page).toMatch(/async function confirmPublish\(\) \{\s*if \([^)]*[\s\S]*?\|\| !listingPublicationAllowed\(publishing\.listing, timerSupported\)\) return;\s*setBusy\(true\);/);
  expect(page).toContain('disabled={busy || !draftIsSaved || !listingPublicationAllowed(publishing.listing, timerSupported)} onClick={() => void confirmPublish()} data-confirm-publish');
  expect(page).toContain('listingTimerStatus(listing, Date.now() + clockOffsetMs, timerSupported)');
  expect(page).toMatch(/if \(!timerSupported\) \{\s*const status = listingTimerStatus\(listing, serverNow\);\s*return status && \{ \.\.\.status, actions: \[\] \};/);
  expect(page).toContain('data-publish-needs-timer>Первая публикация закрыта: сервер API пока без таймера листинга и показал бы рынок на бирже сразу. Черновик и предпросмотр доступны.');
});
