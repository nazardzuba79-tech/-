import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isStocksLocalPreviewHost, shouldMountGlobalStocks } from '../../pages/stocks/stockHostPolicy';

// Ported from #611 onto the one canonical hosted flag, VITE_STOCKS_CATALOGUE_VISIBLE.
const frontend = resolve(__dirname, '../../..');
const source = (path: string) => readFileSync(resolve(frontend, path), 'utf8');

describe('hosted Stocks release boundary (no provider or production API)', () => {
  test('the synthetic simulator stays restricted to 127.0.0.1', () => {
    expect(isStocksLocalPreviewHost('127.0.0.1')).toBe(true);
    for (const host of ['localhost', 'voltextech.net', 'preview.voltextech.net', undefined]) {
      expect(isStocksLocalPreviewHost(host)).toBe(false);
      expect(shouldMountGlobalStocks(host, true, false)).toBe(false);
    }
    expect(shouldMountGlobalStocks('127.0.0.1', true, false)).toBe(true);
  });

  test('the hosted flag opts into the professional terminal; nothing else does on a hosted domain', () => {
    for (const host of ['voltextech.net', 'preview.voltextech.net', '127.0.0.1']) expect(shouldMountGlobalStocks(host, false, true)).toBe(true);
    expect(shouldMountGlobalStocks('voltextech.net', false, false)).toBe(false);
  });

  test('the ordinary VOLTEX login protects both Stocks routes', () => {
    const app = source('src/App.tsx');
    expect(app).toContain('<Route path="/stocks" element={<RequireAuth><StocksPage /></RequireAuth>}/>');
    expect(app).toContain('<Route path="/stocks/:instrumentId" element={<RequireAuth><StocksPage /></RequireAuth>}/>');
    expect(app).toContain('loginPathFor(location)');
  });

  test('one default-OFF build flag, exclusive with every synthetic preview, same-origin only, old name refused', () => {
    const config = source('vite.config.ts');
    expect(config).toContain("const hostedStocks = process.env.VITE_STOCKS_CATALOGUE_VISIBLE === 'true';");
    expect(config).toContain("['VITE_STOCKS_GLOBAL_SIMULATOR','VITE_STOCKS_SIMULATOR','VITE_STOCKS_WIDGET_PREVIEW']");
    expect(config).toContain('if (hostedStocks && !!process.env.VITE_STOCKS_ORIGIN?.trim())');
    expect(config).toContain("if (process.env.VITE_STOCKS_HOSTED_PILOT !== undefined) throw new Error(");
    expect(config).toContain('__VOLTEX_STOCKS_CATALOGUE_VISIBLE__: hostedStocks');
  });

  test('the terminal is session-bound, trades only on the server\'s canTrade, and publishes no fixture data', () => {
    const catalogue = source('src/pages/stocks/global/GlobalStocksCatalogue.tsx');
    const terminal = source('src/pages/stocks/global/GlobalStocks.tsx');
    expect(catalogue).toContain("fetch('/__stocks_global/catalogue'");
    expect(catalogue).toContain('if (!getToken())');
    expect(catalogue).toContain('isAssetCatalogue(body)');
    expect(terminal).toContain("const API='/__stocks_global/'");
    expect(terminal).toContain('const canTrade=!!s.account?.id&&s.account.canTrade===true');
    expect(terminal).toContain('if(!mayTrade())return;');
    expect(terminal).toContain('session.current.capture()');
  });
});
