import { readFileSync } from 'fs';
import { resolve } from 'path';

const frontend = resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(resolve(frontend, 'src', file), 'utf8');

test('normal Futures load has one app lazy boundary and no FuturesRoute waterfall', () => {
  const app = read('App.tsx');
  expect(app).toContain("const FuturesPage = lazy(() => import('./pages/FuturesPage')");
  expect(app).not.toContain("import('./pages/FuturesRoute')");
  expect(app).toContain("const PrivateTradingPage = lazy(() => import('./pages/private-trading/PrivateTradingPage')");
  expect(app).toContain("<Route path=\"/futures\" element={<RequireAuth><FuturesEntry /></RequireAuth>} />");
});

test('admin pagination is absent when there is only one page', () => {
  const pagination = read('pages/admin/AdminPagination.tsx');
  expect(pagination).toContain('totalPages <= 1');
  expect(pagination).toContain('if (total === 0 || totalPages <= 1) return null');
});
