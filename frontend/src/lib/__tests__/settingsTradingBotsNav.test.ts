import { readFileSync } from 'fs';
import { resolve } from 'path';

const frontend = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(frontend, path), 'utf8').replace(/\r\n/g, '\n');

test('Settings header exposes the existing Trading Bots route on desktop and mobile in every supported language', () => {
  const nav = read('src/pages/settings-arctic/ArcticTopNav.tsx');
  const app = read('src/App.tsx');

  expect(app).toContain('<Route path="/trading-bots"');
  expect(nav.match(/to="\/trading-bots"/g)).toHaveLength(2);
  expect(nav).not.toContain('this app has no live page');
  expect(nav).not.toContain('only a "coming soon" teaser');

  for (const [lang, label] of Object.entries({
    ru: 'Торговые боты',
    en: 'Trading bots',
    es: 'Bots de trading',
    zh: '交易机器人',
    ja: '取引ボット',
    ko: '트레이딩 봇',
    hi: 'ट्रेडिंग बॉट',
  })) {
    expect(nav).toContain(`${lang}: '${label}'`);
  }
});
