import { readFileSync } from 'fs';
import { resolve } from 'path';

/** Owner policy 2026-10-23 (PR #596): new testers are credited through «Тестовое начисление» (demo top-up) only.
 * Existing Balance accounts are neither moved nor disabled; the Spot form only says where test funds go. */
const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

test('the Spot balance adjustment points test credits to «Тестовое начисление» and says Spot funds are withdrawable', () => {
  const spot = read('pages/admin/AdminBalanceAdjustment.tsx');
  expect(spot).toContain('<p className="admin-muted" data-tester-credit-policy>Тестовым пользователям средства начисляйте через «Тестовое начисление». Средства спотового счёта пользователь может запросить к выводу.</p>');
  // Shown before any input, in every phase of the dialog.
  expect(spot.indexOf('data-tester-credit-policy')).toBeLessThan(spot.indexOf("{phase === 'edit' &&"));
});

test('«Тестовое начисление» stays the demo ledger credit and never touches the Spot balance', () => {
  const actions = read('pages/admin/AdminAccountActions.tsx');
  expect(actions).toContain('>Тестовое начисление</button>');
  expect(actions).toContain('<p>Счёт: тестовый. Средства и резервы спотового счёта не изменятся.</p>');
  expect(actions).toContain('await api.demoTopUp(profile.id, asset.trim().toUpperCase(), amount.trim(), reason.trim());');
});
