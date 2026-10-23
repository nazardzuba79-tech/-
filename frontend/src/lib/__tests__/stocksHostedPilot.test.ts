import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isStocksLocalPreviewHost, shouldMountGlobalStocks } from '../../pages/stocks/stockHostPolicy';

const frontend = resolve(__dirname, '../../..');
const source = (path: string) => readFileSync(resolve(frontend,path),'utf8');

describe('hosted Stocks private pilot release boundary (no provider or production API)', () => {
  test('simulator is still restricted to the existing 127.0.0.1 host', () => {
    expect(isStocksLocalPreviewHost('127.0.0.1')).toBe(true);
    for (const host of ['localhost', 'voltextech.net', 'preview.voltextech.net', undefined])
      expect(isStocksLocalPreviewHost(host)).toBe(false);
    expect(shouldMountGlobalStocks('127.0.0.1',true,false)).toBe(true);
    for (const host of ['localhost', 'voltextech.net', 'preview.voltextech.net', undefined])
      expect(shouldMountGlobalStocks(host,true,false)).toBe(false);
  });

  test('hosted mode opts into original professional terminal; never silently enables it by route flag alone', () => {
    for (const host of ['voltextech.net', 'preview.voltextech.net', '127.0.0.1'])
      expect(shouldMountGlobalStocks(host,false,true)).toBe(true);
    expect(shouldMountGlobalStocks('voltextech.net',false,false)).toBe(false);
  });

  test('normal VOLTEX login gate protects both hosted routes', () => {
    const app = source('src/App.tsx');
    expect(app).toContain('<Route path="/stocks" element={<RequireAuth><StocksPage /></RequireAuth>}/>');
    expect(app).toContain('<Route path="/stocks/:instrumentId" element={<RequireAuth><StocksPage /></RequireAuth>}/>');
    expect(app).toContain('loginPathFor(location)');
    expect(app).toContain('const stocksEnabled');
  });

  test('compile-time flag is default-OFF, mutually exclusive with all synthetic previews, and same-origin only', () => {
    const config = source('vite.config.ts');
    expect(config).toContain("const hostedStocksPilot = process.env.VITE_STOCKS_HOSTED_PILOT === 'true'");
    expect(config).toContain("process.env.VITE_STOCKS_ENABLED !== 'true'");
    expect(config).toContain("process.env.VITE_STOCKS_GLOBAL_SIMULATOR === 'true'");
    expect(config).toContain("process.env.VITE_STOCKS_SIMULATOR === 'true'");
    expect(config).toContain("process.env.VITE_STOCKS_WIDGET_PREVIEW === 'true'");
    expect(config).toContain("!!process.env.VITE_STOCKS_ORIGIN?.trim()");
    expect(config).toContain('__VOLTEX_STOCKS_HOSTED_PILOT__: hostedStocksPilot');
  });

  test('original gateway is session-bound and no fixture or fallback can publish market data', () => {
    const catalogue = source('src/pages/stocks/global/GlobalStocksCatalogue.tsx');
    const terminal = source('src/pages/stocks/global/GlobalStocks.tsx');
    expect(catalogue).toContain("fetch('/__stocks_global/catalogue'");
    expect(catalogue).toContain("if (!getToken())");
    expect(catalogue).toContain('isAssetCatalogue(body)');
    expect(terminal).toContain("const API='/__stocks_global/'");
    expect(terminal).toContain('const canTrade=!!s.account?.id&&s.account.canTrade===true');
    expect(terminal).toContain("if(!mayTrade())return;");
    expect(terminal).toContain('session.current.capture()');
    expect(terminal).toContain('rememberStockOrder(sessionStorage');
  });
});
