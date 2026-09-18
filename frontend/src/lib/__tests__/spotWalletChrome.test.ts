import { readFileSync } from 'fs';
import { resolve } from 'path';

const front = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(front, path), 'utf8');

describe('small Spot/Wallet chrome corrections', () => {
  it('keeps Spot Buy/Sell controls independent of the selected base ticker', () => {
    const source = read('src/components/OrderForm.tsx');

    expect(source).toContain("{t('trade.buy')}");
    expect(source).toContain("{t('trade.sell')}");
    expect(source).not.toContain("{t('trade.buy')} {baseAsset}");
    expect(source).not.toContain("{t('trade.sell')} {baseAsset}");
    expect(source).not.toContain("t('trade.sell')} ${baseAsset}");
    expect(source).not.toContain("t('trade.buy')} ${baseAsset}");
    expect(source).toContain("submitting ? t('auth.wait') : (side === 'BUY' ? t('trade.buy') : t('trade.sell'))");
  });

  it('hides the moving global ticker on Wallet only', () => {
    const wallet = read('src/pages/WalletPage.tsx');
    const trade = read('src/pages/TradePage.tsx');
    const futures = read('src/pages/FuturesPage.tsx');
    const nav = read('src/components/Nav.tsx');

    expect(wallet).toContain('<Nav active="/wallet" hideTicker />');
    expect(trade).not.toContain('hideTicker');
    expect(futures).not.toContain('hideTicker');
    expect(nav).toContain('!hideTicker&&<TopGainersTicker');
  });
});
