import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');

test('Users admin places reversible hide between Open and Delete and masks hidden identity', () => {
  const page = readFileSync(resolve(root, 'pages/admin/AdminUsersPage.tsx'), 'utf8');
  const css = readFileSync(resolve(root, 'pages/admin/adminPracticality.css'), 'utf8');
  expect(page).toContain('api.hideAdminUser(user.id)');
  expect(page).toContain('api.unhideAdminUser(user.id)');
  expect(page).toContain('<option value="hidden">Скрытые</option>');
  expect(page).toContain('data-hidden-account');
  expect(page).toContain('Скрытый аккаунт');
  expect(page.indexOf('admin-hide-button')).toBeGreaterThan(page.indexOf('admin-open-button'));
  expect(page.indexOf('admin-delete-button')).toBeGreaterThan(page.indexOf('admin-hide-button'));
  expect(css).toMatch(/admin-hide-button[^}]*margin-left:\s*24px/);
  expect(css).toMatch(/admin-delete-button[^}]*margin-left:\s*20px/);
});
