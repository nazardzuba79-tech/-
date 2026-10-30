import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const ui = readFileSync(resolve(root, 'src/pages/copy-trading-bolt/components.tsx'), 'utf8');
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
  expect(lists).toContain("const FOLLOWING_KEY = 'voltex_copy_following'");
  expect(lists).toContain('NOT an account-bound copy subscription');
  expect(route).toContain('Internal synthetic Copy Trading data only');
  expect(route).not.toMatch(/router\.post\(['"]\/copy-trading\/subscribe/);
});
