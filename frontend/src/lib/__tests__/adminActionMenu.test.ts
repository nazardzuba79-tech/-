import { act, flush, createAdminWorkingFixture, page, user } from '../../../test-utils/adminWorkingViewHarness';

let f: ReturnType<typeof createAdminWorkingFixture>;
beforeEach(() => { f = createAdminWorkingFixture(); });
afterEach(async () => { await f.dispose(); });
const menu = () => document.querySelector('[role="menu"]');
const items = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
async function key(target: Element, value: string) {
  await act(async () => { target.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: value, bubbles: true })); await flush(); });
}

test('opening and keyboard navigation do not mutate users; Escape restores focus, outside press closes', async () => {
  await f.mount();
  const button = f.host.querySelector<HTMLButtonElement>('[data-user-row] .admin-action-trigger')!;
  const before = f.fetcher.mock.calls.filter((c: any[]) => c[1]?.method === 'POST').length;
  await key(button, 'ArrowDown');
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(items()[0]);
  await key(items()[0], 'End');
  expect(document.activeElement).toBe(items().at(-1));
  await key(items().at(-1)!, 'Escape');
  expect(menu()).toBeNull(); expect(document.activeElement).toBe(button);
  await f.click(button);
  await act(async () => { document.body.dispatchEvent(new f.dom.window.Event('pointerdown', { bubbles: true })); await flush(); });
  expect(menu()).toBeNull();
  expect(f.fetcher.mock.calls.filter((c: any[]) => c[1]?.method === 'POST')).toHaveLength(before);
});

test('delete still opens its confirmation; hidden accounts expose only restoration without leaking identity', async () => {
  f.api.getAdminUsersPage.mockResolvedValue(page([user('visible'), user('hidden', { adminHidden: true })]));
  await f.mount();
  await f.click(f.host.querySelector('[data-user-row="hidden"] .admin-action-trigger'));
  expect(items().map(item => item.textContent)).toEqual(['Показать снова']);
  expect(f.host.querySelector('[data-user-row="hidden"]')?.textContent).not.toContain('hidden@example.invalid');
  await key(items()[0], 'Escape');
  await f.click(f.host.querySelector('[data-user-row="visible"] .admin-action-trigger'));
  await f.click(items().find(item => item.textContent === 'Удалить')!);
  expect(menu()).toBeNull(); expect(f.host.querySelector('dialog[open]')).not.toBeNull();
  expect(f.fetcher.mock.calls.filter((c: any[]) => c[1]?.method === 'DELETE')).toHaveLength(0);
});

test('More opens the existing spam manager and displays the server count without writes', async () => {
  f.api.getSpamEmails.mockResolvedValue({ entries: [{ email: 'spam@example.invalid', addedBy: 'admin', addedAt: '2026-10-06T10:00:00Z' }] });
  await f.mount();
  expect(f.host.querySelector('.admin-spam-panel')).toBeNull();
  await f.click(f.button('Ещё'));
  expect(menu()?.querySelector('.admin-action-count')?.textContent).toBe('1');
  await f.click(items()[0]);
  expect(f.host.querySelector('.admin-spam-panel')?.textContent).toContain('spam@example.invalid');
  await f.click(f.button('Закрыть'));
  expect(f.host.querySelector('.admin-spam-panel')).toBeNull();
  expect(f.fetcher.mock.calls.filter((c: any[]) => c[1]?.method === 'POST')).toHaveLength(0);
});
