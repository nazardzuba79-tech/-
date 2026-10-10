import { readFileSync } from 'fs';
import { resolve } from 'path';

const frontend = resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(resolve(frontend, file), 'utf8');

describe('mobile round 3: scoped fixes without trading changes', () => {
  const header = read('src/pages/home/HomeHeader.tsx');
  const largeText = read('src/pages/trade-terminal/FuturesMobileLargeText.css');
  const walletUi = read('src/pages/wallet-v3/ui.tsx');
  const withdrawModal = read('src/pages/wallet-v3/WithdrawModal.tsx');
  const walletCss = read('src/pages/wallet-v3/wallet.css');

  test('both homepage Trading Bots links use a localized label', () => {
    const expected: Record<string, string> = {
      ru: 'Торговые боты',
      en: 'Trading bots',
      es: 'Bots de trading',
      zh: '交易机器人',
      hi: 'ट्रेडिंग बॉट',
      ja: '取引ボット',
      ko: '트레이딩 봇',
    };
    for (const [lang, label] of Object.entries(expected)) {
      expect(header).toContain(`${lang}: '${label}'`);
    }
    expect(header.match(/<TradingBotIcon\/>{HOME_BOTS_LABEL\[lang\] \?\? HOME_BOTS_LABEL\.ru}<\/Link>/g)).toHaveLength(2);
    expect(header).toContain('const { lang, t } = useLanguage();');
  });

  test('wallet withdrawal validation wraps through scoped CSS without changing protected shared UI', () => {
    expect(walletUi).toContain('<p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-4 text-neg">');
    expect(withdrawModal).toContain('<div className="wallet-withdraw-address-field">');
    expect(walletCss).toContain('.vx-wallet-modal-root .wallet-withdraw-address-field > p.text-neg {');
    expect(walletCss).toContain('line-height: 1.4;');
    expect(walletCss).toContain('.vx-wallet-modal-root .wallet-withdraw-address-field > p.text-neg > span {');
    expect(walletCss).toContain('min-width: 0;');
    expect(walletCss).toContain('overflow-wrap: break-word;');
  });

  test('narrow Futures order tickets place captions in document flow', () => {
    expect(largeText).toContain('@container fo-panel (max-width: 12em)');
    expect(largeText).toContain('.fo-form .fo-field > .fo-fieldCaption');
    expect(largeText).toContain('position:static;');
    expect(largeText).toContain('flex-direction:column;');
    expect(largeText).toContain('min-height:48px;');
    expect(largeText).not.toContain('overflow-x:hidden !important');
  });
});
