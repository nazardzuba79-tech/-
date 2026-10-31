import { readFileSync } from 'fs';
import { resolve } from 'path';
import { futuresCopyText } from '../../pages/copy-trading-bolt/futuresCopyText';

const LOCALES = ['en', 'ru', 'es', 'zh', 'hi', 'ja', 'ko'] as const;
const root = resolve(__dirname, '../../../..');

test('Futures order copying speaks plainly in seven languages and discloses what matters', () => {
  const internal = /demo|sandbox|synthetic|simulat|test.only|демо|тестов|симулир|синтети|práctica|simulad|模拟|测试|डेमो|सिमुल|デモ|シミュレ|데모|모의|시뮬레/i;
  const nonWithdrawable = { en: /cannot be withdrawn/, ru: /без возможности вывода/, es: /no retirable/, zh: /不可提现/,
    hi: /निकाला नहीं जा सकता/, ja: /出金できません/, ko: /출금할 수 없습니다/ };
  expect(Object.keys(futuresCopyText).sort()).toEqual([...LOCALES].sort());
  const keys = Object.keys(futuresCopyText.en).sort(), reasons = Object.keys(futuresCopyText.en.reasons).sort();
  for (const lang of LOCALES) {
    const t = futuresCopyText[lang];
    expect(Object.keys(t).sort()).toEqual(keys);
    expect(Object.keys(t.reasons).sort()).toEqual(reasons);
    for (const v of [...Object.values(t).filter(v => typeof v === 'string'), ...Object.values(t.reasons)]) {
      expect(v).not.toMatch(internal); expect((v as string).trim().length).toBeGreaterThan(1);
    }
    expect(t.notice).toMatch(nonWithdrawable[lang]);
    expect(t.stopNote.length).toBeGreaterThan(20);
  }
});

test('the panel shows only server-confirmed rows and hides itself when the server refuses', () => {
  const panel = readFileSync(resolve(root, 'frontend/src/pages/copy-trading-bolt/FuturesCopyPanel.tsx'), 'utf8');
  expect(panel).toContain("if (!available) return null;");
  expect(panel).toContain("m.status === 'APPLIED'");
  expect(panel).not.toMatch(/localStorage/);
  // An unexpected answer (proxy, older API) must hide the panel, not crash the page.
  expect(panel).toContain("Array.isArray(v.mirrors)");
  expect(panel.match(/verified\(/g)?.length).toBe(2);
  const page = readFileSync(resolve(root, 'frontend/src/pages/CopyFuturesObserverPage.tsx'), 'utf8');
  // The "orders are not copied" notice is withdrawn exactly while copying is ON.
  expect(page).toContain('{!copying && <p className="observer-warning"');
});
