import { readFileSync } from 'fs';
import { resolve } from 'path';

const frontend = resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(resolve(frontend, 'src', file), 'utf8');

test('normal Futures load has one route lazy boundary, not a second FuturesPage lazy import', () => {
  const route = read('pages/FuturesRoute.tsx');
  expect(route).toContain("import { FuturesPage } from './FuturesPage'");
  expect(route).not.toContain("lazy(() => import('./FuturesPage')");
  expect(route).toContain("lazy(() => import('./private-trading/PrivateTradingPage')");
});

test('admin pagination is absent when there is only one page', () => {
  const pagination = read('pages/admin/AdminPagination.tsx');
  expect(pagination).toContain('totalPages <= 1');
  expect(pagination).toContain('if (total === 0 || totalPages <= 1) return null');
});
