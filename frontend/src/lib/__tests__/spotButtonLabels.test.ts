import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { LOCALES, readDictionaries } from '../../../test-utils/i18nSource';
import { customerErrorText } from '../customerError';

/**
 * Spot action buttons say «Купить» / «Продать». Nothing else.
 *
 * They used to be built as `${t('trade.buy')} ${baseAsset}`, so the pair
 * leaked into the action: «Купить USELESS». The ticker is already on the
 * pair header, on the quantity field's suffix and on the balance line, and
 * a long symbol turned a two-word button into a wrapping one.
 *
 * The buttons are RENDERED here across several pairs rather than read as
 * source, because "never changes with the symbol" is a claim about output.
 * Futures is a separate component with position wording of its own and is
 * checked to still have it.
 */

const root = resolve(__dirname, '../../../..');
const frontend = resolve(root, 'frontend');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n');

const dictionaries = readDictionaries();
const t = (lang: (typeof LOCALES)[number]) => (key: string, params?: Record<string, string | number>) => {
  const template = dictionaries[lang][key] ?? key;
  return params ? template.replace(/\{(\w+)\}/g, (m: string, name: string) => String(params[name] ?? m)) : template;
};

// Everything the form imports, reduced to what a render needs. None of it
// feeds the button text — which is the point: the labels depend on the
// side and the dictionary, and on nothing else.
const stubs = (lang: (typeof LOCALES)[number]) => ({
  '../lib/api': { api: {} },
  // The real display boundary, not a stub: the form's failure text is
  // composed there now, and a stub would let the two drift apart.
  '../lib/customerError': { customerErrorText },
  '../lib/useMarketData': { useMarketTicker: () => ({ ticker: null }) },
  '../lib/i18n': { useLanguage: () => ({ t: t(lang), lang }) },
  '../lib/formatNumber': { formatPrice: String, formatAmount: String, formatCompact: String },
  '../lib/spotOrderBook': { formatSpotBookNumber: String },
  '../lib/toast': { useToast: () => ({ info() {}, error() {}, success() {} }) },
  '../lib/priceChange': { parseChangePercent: () => null },
  '../lib/spotOrderEntry': { positiveOrderNumber: () => null, orderFundingPrice: () => null, balancePercentageQuantity: () => '' },
  '../lib/spotOrderFeedback': { spotOrderFeedback: () => null },
});

function renderSpotForm(pair: string, lang: (typeof LOCALES)[number] = 'ru') {
  const imports: Record<string, unknown> = stubs(lang);
  const code = ts.transpileModule(read('frontend/src/components/OrderForm.tsx').replace(/import\.meta\.env/g, '({} as any)'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const output: Record<string, any> = {};
  new Function('exports', 'require', code)(output, (name: string) => name.endsWith('.css') ? {} : imports[name] ?? req(name));
  return renderToStaticMarkup(React.createElement(output.OrderForm, { pair, onPlaced: () => undefined }));
}

/** The text of every button that carries a side class. */
const actionLabels = (html: string) =>
  [...html.matchAll(/<button[^>]*class="[^"]*(?:order-form-tab|submit-btn)[^"]*"[^>]*>([\s\S]*?)<\/button>/g)]
    .map(m => m[1].replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").trim());

describe('Spot action buttons never carry the asset ticker', () => {
  const PAIRS = ['BTC/USDT', 'ETH/USDT', 'USELESS/USDT', 'SOL/USDC', 'DOGE/EUR'];

  it('reads «Купить» and «Продать» on every pair, with no symbol appended', () => {
    const seen = PAIRS.map(pair => actionLabels(renderSpotForm(pair)));

    for (const [index, labels] of seen.entries()) {
      expect(labels).toContain('Купить');
      expect(labels).toContain('Продать');
      // The base AND the quote of that very pair, so a swapped-in quote
      // asset would fail too.
      for (const symbol of PAIRS[index].split('/')) {
        expect(labels.some(label => label.includes(symbol))).toBe(false);
      }
    }
  });

  it('renders byte-identical action labels whatever the pair is', () => {
    const [first, ...rest] = PAIRS.map(pair => actionLabels(renderSpotForm(pair)));
    for (const labels of rest) expect(labels).toEqual(first);
    // Both tabs and the submit CTA — three buttons, not two.
    expect(first.length).toBe(3);
  });

  it('keeps the ticker where it belongs: on the quantity suffix and the balance line', () => {
    // Removing it from the action must not have removed it from the screen.
    const html = renderSpotForm('USELESS/USDT');
    expect(html).toContain('USELESS');
    expect(html).toContain('input-suffix');
  });

  it('carries no ticker placeholder in any language’s buy/sell strings', () => {
    for (const code of LOCALES) {
      for (const key of ['trade.buy', 'trade.sell']) {
        const value = dictionaries[code][key];
        expect(typeof value).toBe('string');
        // A locale must not reintroduce the symbol through the dictionary.
        expect(value).not.toMatch(/\{\s*\w+\s*\}/);
        expect(value).not.toMatch(/BTC|USDT|\{asset\}|\{symbol\}|\{base\}/);
      }
    }
  });

  it('renders the same two words in English, so this is not a RU-only fix', () => {
    const labels = actionLabels(renderSpotForm('USELESS/USDT', 'en'));
    expect(labels).toContain('Buy');
    expect(labels).toContain('Sell');
    expect(labels.some(label => label.includes('USELESS'))).toBe(false);
  });
});

describe('Futures keeps its own position wording', () => {
  const futures = read('frontend/src/components/FuturesOrderForm.tsx');

  it('still opens and closes positions rather than buying and selling', () => {
    // The Spot fix must not have been applied globally. The keys sit inside
    // the reduce-only ternary, so they are matched as keys, not as calls.
    for (const key of ['futures.buyLong', 'futures.sellShort', 'futures.closeShort', 'futures.closeLong']) {
      expect(futures).toContain(`'${key}'`);
    }
    expect(dictionaries.ru['futures.buyLong']).toBe('Открыть Лонг');
    expect(dictionaries.ru['futures.sellShort']).toBe('Открыть Шорт');
  });

  it('does not build its labels from the Spot keys', () => {
    expect(futures).not.toContain("t('trade.buy')");
    expect(futures).not.toContain("t('trade.sell')");
  });
});

describe('the Wallet page drops the gainers tape, and only the Wallet page', () => {
  it('hides it on Wallet', () => {
    expect(read('frontend/src/pages/WalletPage.tsx')).toMatch(/<Nav\s+active="\/wallet"\s+hideTicker\s*\/>/);
  });

  it('leaves Trade and Futures with theirs', () => {
    for (const page of ['frontend/src/pages/TradePage.tsx', 'frontend/src/pages/FuturesPage.tsx']) {
      const source = read(page);
      if (!source.includes('<Nav')) continue;
      expect(source).not.toContain('hideTicker');
    }
  });

  it('keeps the strip itself, so no other page loses it', () => {
    const nav = read('frontend/src/components/Nav.tsx');
    expect(nav).toContain('TopGainersTicker');
    // Still conditional on the per-page flag, not deleted or hard-disabled.
    expect(nav).toContain('!hideTicker&&<TopGainersTicker');
  });
});
