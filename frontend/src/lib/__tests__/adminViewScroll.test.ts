import { act, flush, createAdminWorkingFixture, page, user } from './adminWorkingViewHarness';

let f: ReturnType<typeof createAdminWorkingFixture>;
const frame = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); await flush(); });
beforeEach(() => {
  f = createAdminWorkingFixture();
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
  Object.defineProperty(window, 'scrollX', { configurable: true, writable: true, value: 0 });
  (window.scrollTo as jest.Mock).mockImplementation((x: number, y: number) => {
    Object.assign(window, { scrollX: x, scrollY: f.host.querySelector('[data-user-row]') ? y : 0 });
  });
});
afterEach(async () => { await f.dispose(); });

test('profile return restores nested table and window position only after async users data renders', async () => {
  const route = '/admin/users?page=2&search=payer';
  await f.mount('AdminUsersPage', route); await frame();
  const table = f.host.querySelector('.admin-table-desktop') as HTMLElement;
  await act(async () => {
    table.scrollTop = 400; table.scrollLeft = 80;
    table.dispatchEvent(new f.dom.window.Event('scroll'));
    Object.assign(window, { scrollY: 280 }); window.dispatchEvent(new f.dom.window.Event('scroll'));
    await flush();
  });
  await act(async () => { f.root.render(null); await flush(); });
  Object.assign(window, { scrollY: 0 }); (window.scrollTo as jest.Mock).mockClear();
  let deliver!: (value: unknown) => void;
  f.api.getAdminUsersPage.mockReturnValue(new Promise(resolve => { deliver = resolve; }));
  await f.mount('AdminUsersPage', route); await frame();
  expect(window.scrollTo).not.toHaveBeenCalled();
  await act(async () => { deliver(page([user('payer')])); await flush(); }); await frame();
  const restored = f.host.querySelector('.admin-table-desktop') as HTMLElement;
  expect(restored.scrollTop).toBe(400); expect(restored.scrollLeft).toBe(80);
  expect(window.scrollY).toBe(280);
});

test('view positions are discarded when the authenticated session changes', async () => {
  await f.mount(); await frame();
  const table = f.host.querySelector('.admin-table-desktop') as HTMLElement;
  await act(async () => { table.scrollTop = 400; table.dispatchEvent(new f.dom.window.Event('scroll')); Object.assign(window, { scrollY: 280 }); window.dispatchEvent(new f.dom.window.Event('scroll')); await flush(); });
  await act(async () => { f.root.render(null); f.setToken('other-admin'); await flush(); });
  await f.mount(); await frame();
  expect((f.host.querySelector('.admin-table-desktop') as HTMLElement).scrollTop).toBe(0);
  expect(window.scrollY).toBe(0);
});
