import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');

test('Users admin keeps reversible visibility and masks hidden identity', () => {
  const page = readFileSync(resolve(root, 'pages/admin/AdminUsersPage.tsx'), 'utf8');
  expect(page).toContain('setAdminUserHidden(user.id, hidden)');
  expect(page).toContain('<option value="hidden">Скрытые</option>');
  expect(page).toContain('data-hidden-account');
  expect(page).toContain('Скрытый аккаунт');
  expect(page).toContain('changeVisibility(user, !user.adminHidden)');
});
