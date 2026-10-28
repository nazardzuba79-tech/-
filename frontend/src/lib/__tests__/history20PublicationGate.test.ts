import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listingHistoricalPublicationBlocked } from '../../pages/admin/listingHistoricalPublicationGate';
import { newListingMovement } from '../../pages/admin/listingMovementModel';
import { listingPublicationAllowed } from '../../pages/admin/listingTimerCapability';

const ordinary = newListingMovement('2');
const history = { ...ordinary, growth: 'historical-window' as const, afterGrowth: 'range' as const };
const privateTest = { settlement: 'SIMUSDT' as const, funding: { base: '100', quote: '1000' } };

test('ordinary listing publication stays unchanged', () => {
  expect(listingHistoricalPublicationBlocked({ simulationProgram: ordinary })).toBe(false);
});
test('only private SIMUSDT window can open History20 publication confirmation', () => {
  expect(listingHistoricalPublicationBlocked({ simulationProgram: history })).toBe(true);
  expect(listingHistoricalPublicationBlocked({ simulationProgram: history, privateTest })).toBe(false);
  expect(listingHistoricalPublicationBlocked({ simulationProgram: history, privateTest: { ...privateTest, settlement: 'USDT' as never } })).toBe(true);
});
test('historical continuation stays blocked even with private settings', () => {
  expect(listingHistoricalPublicationBlocked({ simulationProgram: { ...history, afterGrowth: 'historical' }, privateTest })).toBe(true);
});

// Exercise the actual UI handler, not a duplicate mock predicate. No HTTP or funding.
const source = readFileSync(resolve(__dirname, '../../pages/admin/AdminListingsPage.tsx'), 'utf8');
const start = source.indexOf('  function openPublish() {');
const end = source.indexOf('  async function confirmPublish()', start);
if (start < 0 || end < 0) throw new Error('Unable to locate exact openPublish handler');
const handler = source.slice(start, end);
function click(config: unknown, flags: { busy?: boolean; saved?: boolean; timerSupported?: boolean } = {}) {
  const setPublishing = jest.fn(), setFormError = jest.fn();
  new Function('current', 'busy', 'draftIsSaved', 'listingHistoricalPublicationBlocked',
    'listingPublicationAllowed', 'timerSupported', 'setFormError', 'setPublishing', 'newPublishKey', handler + '\nopenPublish();')(
    { id: 'synthetic-private', activeVersion: null, countdown: null, draft: config }, flags.busy ?? false, flags.saved ?? true,
    listingHistoricalPublicationBlocked, listingPublicationAllowed, flags.timerSupported ?? true,
    setFormError, setPublishing, () => 'synthetic-key'
  );
  return { setPublishing, setFormError };
}
test('actual private handler opens confirmation without publishing/funding', () => {
  const r = click({ simulationProgram: history, privateTest });
  expect(r.setPublishing).toHaveBeenCalledTimes(1);
  expect(r.setPublishing.mock.calls[0][0]).toMatchObject({ key: 'synthetic-key', listing: { draft: { privateTest } } });
  expect(r.setFormError).not.toHaveBeenCalled();
});
test('actual handler fails closed for public historical and busy/unsaved drafts', () => {
  expect(click({ simulationProgram: history }).setPublishing).not.toHaveBeenCalled();
  expect(click({ simulationProgram: history }).setFormError).toHaveBeenCalledTimes(1);
  expect(click({ simulationProgram: history, privateTest }, { busy: true }).setPublishing).not.toHaveBeenCalled();
  expect(click({ simulationProgram: history, privateTest }, { saved: false }).setPublishing).not.toHaveBeenCalled();
});

test('actual handler refuses first private and public publication through an API without timer support', () => {
  expect(click({ simulationProgram: history, privateTest }, { timerSupported: false }).setPublishing).not.toHaveBeenCalled();
  expect(click({ simulationProgram: ordinary }, { timerSupported: false }).setPublishing).not.toHaveBeenCalled();
});
