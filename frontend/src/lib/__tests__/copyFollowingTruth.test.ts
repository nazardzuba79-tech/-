import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const ui = readFileSync(resolve(root, 'src/pages/copy-trading-bolt/components.tsx'), 'utf8');
const page = readFileSync(resolve(root, 'src/pages/CopyTradingPage.tsx'), 'utf8');
const lists = readFileSync(resolve(root, 'src/pages/copy-trading-bolt/useCopyLists.ts'), 'utf8');
const route = readFileSync(resolve(root, '../src/api/routes/syntheticCopyTrading.ts'), 'utf8');

test('local watchlist never claims an actual copied order or verified server subscription', () => {
  for (const fragment of ['Вы копируете ${trader.name}', 'Копирование ${trader.name} остановлено',
    'Копируется</>', "label: 'Копирую'", "tab === 'following' ? 'Вы копируете'"]) {
    expect(ui).not.toContain(fragment);
  }
  expect(ui).toContain('Список наблюдения');
  expect(ui).toContain('Автоматическое копирование сделок не запущено');
  expect(ui).toContain('Наблюдать за трейдером');
  expect(ui).toContain('toggleFollowing(trader.id)');
  // Scope execution assertions to the actual button. A retained historical
  // comment elsewhere mentioning useCopyEligibility is not a dependency.
  const start = ui.indexOf('function CopyButton(');
  const end = ui.indexOf('/** The star', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  expect(ui.slice(start, end)).not.toMatch(/useCopyEligibility|CopyDepositDialog|showDepositRequirement|isCurrent\(\)/);
  expect(ui).not.toMatch(/import[^;]*(?:useCopyEligibility|CopyDepositDialog)/);
  expect(page).not.toMatch(/getPortfolioHistory|useCopyDepositCheck|CopyEligibilityProvider|depositCheck/);
  expect(lists).toContain("const FOLLOWING_KEY = 'voltex_copy_following'");
  expect(lists).toContain('NOT an account-bound copy subscription');
  expect(route).toContain('Internal synthetic Copy Trading data only');
  expect(route).not.toMatch(/router\.post\(['"]\/copy-trading\/subscribe/);
});
