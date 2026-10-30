import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import { LOCALES, readLocale } from '../../../test-utils/i18nSource';
import { copyDemoText } from '../../pages/copy-trading-bolt/copyDemoText';
import { futuresObserverText } from '../../pages/copy-trading-bolt/futuresObserverText';

/**
 * The exchange is shown to people who are not building it. A screen that
 * names the WebSocket, the backend, the database, an env var or a fixture is
 * telling the reader about our plumbing instead of about their money — and
 * "demo", "sandbox" and "synthetic data" are worse, because a reader who
 * sees them on a screen that is in fact live draws the wrong conclusion.
 *
 * This guard is the standing version of a sweep done by hand once. It reads
 * the rendered copy — the seven dictionaries, and string/JSX text in the
 * components — and fails on the vocabulary below. It deliberately does NOT
 * look at identifiers, imports, types, CSS classes or comments: naming a
 * variable `nativeDemoApi` is fine. The dated Copy ROI scenario that carried
 * a «Демо · симуляция» disclosure until 22.10.2026 00:00 UTC is removed with
 * every practice notice (owner, 2026-10-22); no exemption is left.
 */

const root = resolve(__dirname, '../../../..');

/** Words that describe how the exchange is built rather than what it does. */
const PLUMBING = [
  /websocket/i, /веб-?сокет/i,
  /бэкенд|backend|фронтенд/i,
  /эндпоинт|endpoint/i,
  /база данных|в базе данных/i,
  /деплой|deployment/i,
  /синтетическ|synthetic data/i,
  /фикстур|fixture/i,
  /песочниц|sandbox/i,
  /демо|\bdemo\b/i,
  /симуляци|simulation/i,
  /заглушк|\bmock\b/i,
  /снапшот|снимк(ам|ов|и) /i,
  /захардкож|hardcoded/i,
  /\bstale\b/i,
  /server-side/i,
  /\bbcrypt\b/i,
];

/**
 * Practice / training / simulation / demo / test notices, in all seven
 * languages (owner, 2026-10-22, on the live «Учебный рынок · Торговля пока
 * недоступна» banner: «я подальшому забороняю такі надписи, біржа не приймає
 * трейдерів чи реальних грошей, біржа торгується до презентації, тому її
 * інтерфейс має бути чистий»; then «щоб більше ніколи, ні для якого актива не
 * появлялись … і схожих»). No screen may call a market, an account, a figure
 * or a badge practice, training, simulated, demo or test.
 */
const PRACTICE_NOTICES = [
  /учебн|тренировочн|(^|[^а-яё])практик[аиуе]?([^а-яё]|$)|симулир|тестов(ый|ая|ое|ые) (рынок|режим|сч[её]т|торг)/i,
  /Торговля пока недоступна|Рынок открыт/,
  /\bpractice\b|\bsimulated\b|\btraining mode\b|\bpaper trading\b|\btest market\b|Trading is currently unavailable/i,
  /práctica|simulad[oa]|simulación|Trading no disponible por ahora/i,
  /अभ्यास|सिमुल|प्रैक्टिस|डेमो/,
  /練習|シミュレ|デモ/,
  /연습|시뮬레|데모|모의 (거래|투자|시장)/,
  /练习|模拟|演示/,
];

/**
 * «Trading (temporarily) unavailable», in all seven languages — the same kind
 * of line (owner, 2026-10-22, on «Торговля CFD временно недоступна»:
 * «виправляй»). Only Stocks' own `stocks.tradingUnavailable` still says it:
 * Codex's switched-off work, exempt as below, to go before Stocks is switched on.
 */
const TRADING_UNAVAILABLE = [
  /торгов(ля|ли|ать)[^.]{0,40}(недоступн|не доступн|приостановлен|закрыт|не работает)/i,
  /\btrad(ing|e)\b[^.]{0,40}\b(unavailable|not available|disabled|suspended|closed)\b/i,
  /(negociación|trading|operar)[^.]{0,40}(no (está |estará )?disponible|suspendid|cerrad)/i,
  /ट्रेडिंग[^।]{0,40}(अनुपलब्ध|उपलब्ध नहीं|बंद)/,
  /取引(?!量|額|条件)[^。]{0,20}(利用できません|ご利用いただけません|停止|休止)|取引できません/,
  /거래[^.]{0,20}(이용할 수 없|할 수 없|중단|중지)/,
  /交易(?!量|额|对|所)[^。]{0,10}(暂不可用|暂未开放|不可用|暂停|关闭)/,
  // …and its «coming soon» form: trading or quotes that «will be available» («TradFi скоро появится · Торговля
  // традиционными активами станет доступна…», «Котировки CFD скоро появятся»).
  /(торгов(ля|ли|ать)|котировк|цены)[^.]{0,60}(скоро появ|станет доступн|будет доступн|появятся)/i,
  /\b(trading|quotes|prices)\b[^.]{0,40}\b(coming soon|will be available|available soon)\b/i,
  /(negociación|cotizaciones|precios)[^.]{0,40}(pronto|estará(n)? disponible)/i,
  /(ट्रेडिंग|कोटेशन|कोट्स|कीमतें|कीमत)[^।]{0,40}(जल्द|उपलब्ध होगी|उपलब्ध होंगी)/,
  /(取引|相場|価格|気配)(?!量|額)[^。]{0,20}(近日|まもなく|予定です)/,
  /(거래|시세|가격)[^.]{0,20}(곧 |예정)/,
  /(交易|报价|价格)(?!量|额)[^。]{0,10}(即将|敬请期待)/,
  // …and «not yet / for now» about the product itself (owner, 2026-10-22, «Этот актив пока не торгуется» on the
  // phone: «ти мав всі знайти і видалити»): deposits, convert, borrow, reserves, the card, an asset.
  /пока (не (торгу|подключ|определ|подтвержд|доступ)|недоступ)|не торгуется|ещё не (подключ|торгу)|еще не (подключ|торгу)/i,
  /\bnot (available|trading) yet\b|\bnot available\b[^.]{0,40}\byet\b|\bnot connected yet\b|\bare connected yet\b/i,
  /aún no (está |están )?disponible|todavía no (hay|se negocia)/i,
];
const saysTradingUnavailable = (text: string) => TRADING_UNAVAILABLE.some((r) => r.test(text));

/**
 * Only a dictionary value gets this one. A deploy-time variable's name on a
 * screen is a leak; the same shape inside a component is almost always an
 * order status or a colour constant that the reader never sees.
 */
const ENV_VAR_NAME = /[A-Z][A-Z0-9]{3,}_[A-Z0-9_]{3,}/;

/**
 * Two things stay, and both are deliberate.
 *
 * API keys are a product the user creates, uses and revokes on a settings
 * page of their own — the word is the feature's name, not a leak. The admin
 * console's test-balance section is staff-only and must keep saying plainly
 * that the funds it credits are not real; making that read like a normal
 * balance would be the dangerous edit, not the honest one.
 */
const ALLOWED = [
  /API[- ]?(key|ключ|кунж|कुंज|キー|키|密钥|клав)/i,
  /claves? API|API कुंज|API 密钥|APIキー|API 키/i,
  /Manage API keys|Управление API-ключами/i,
];

const allowed = (text: string) => ALLOWED.some((r) => r.test(text));



/** Every `'key': 'value'` row of a dictionary, values only. */
function localeStrings(source: string): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  const re = /^\s*'([a-zA-Z0-9._]+)':\s*\n?\s*(['"])((?:[^\\]|\\.)*?)\2,?\s*$/gm;
  for (const m of source.matchAll(re)) rows.push({ key: m[1], value: m[3] });
  return rows;
}

describe.each(LOCALES)('%s dictionary', (code) => {
  test('speaks about the product, not about the plumbing', () => {
    const offenders = localeStrings(readLocale(code))
      .filter(({ key, value }) => !allowed(value)
        && ([...PLUMBING, ...PRACTICE_NOTICES, ENV_VAR_NAME].some((r) => r.test(value))
          || (!key.startsWith('stocks.') && saysTradingUnavailable(value))))
      .map(({ key, value }) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});

/** Source files whose copy reaches a screen. Tests and generated output are not copy. */
function uiFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') uiFiles(path, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

/**
 * Only text a reader can see. A quoted string in a `.tsx` file is far more
 * often an identifier than a sentence, so everything that is recognisably
 * NOT copy is dropped before the vocabulary is applied: module paths, CSS
 * class lists, translation keys, enum members, and the code fragments that
 * fall out of scanning dense single-line JSX for `>text<`.
 */
const NOT_COPY = [
  /^[./@#]/,                                   // module paths, selectors
  /^[a-z0-9]+$/,                               // status values: 'stale', 'loading'
  /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+$/,   // translation keys
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,           // enum members
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?: [a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/, // class lists
  /[=;{}]|=>|&&|\|\||\?\.|\breturn\b|\bconst\b/,   // code, not prose
];

/** The candidate with surrounding punctuation and whitespace removed. */
const core = (value: string) => value.trim().replace(/^[\s,:;.[\]()]+|[\s,:;.[\]()]+$/g, '');

const isCopy = (value: string) => {
  const text = core(value);
  return text.length >= 4 && /[A-Za-zА-Яа-яЁё]/.test(text) && !NOT_COPY.some((r) => r.test(text));
};

function visibleStrings(source: string): string[] {
  const out: string[] = [];
  for (const line of source.split('\n')) {
    if (/^\s*(import|export)\s/.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const m of line.matchAll(/>([^<>{}\n]{4,300})</g)) out.push(m[1].trim());
    for (const m of line.matchAll(/(['"`])((?:[^'"`\\\n]|\\.){4,300}?)\1/g)) out.push(m[2]);
  }
  return out.filter(isCopy);
}

test('hardcoded component copy speaks about the product, not about the plumbing', () => {
  const offenders: string[] = [];
  for (const path of uiFiles(resolve(root, 'frontend/src'))) {
    const rel = relative(root, path).replace(/\\/g, '/');
    // This is the customer presentation contract. The ADMIN-only console
    // must identify simulated data, destructive deletion scope and deployment
    // controls honestly; it is not part of customer product copy.
    if (rel.startsWith('frontend/src/pages/admin/')) continue;
    // The separate, loopback-only mobile review must label its fixtures and
    // unavailable auth honestly. Its entry and build are isolated from the
    // production app; only this exact directory is outside customer copy.
    if (rel.startsWith('frontend/src/mobile-review/')) continue;
    // #644 is an explicitly isolated demo, not a live-money screen. Its exact
    // dictionary must disclose demo funds; the positive contract below protects it.
    if (rel === 'frontend/src/pages/copy-trading-bolt/copyDemoText.ts') continue;
    // Exact, isolated review dictionary: require truthful demo disclosures separately.
    if (rel === 'frontend/src/pages/copy-trading-bolt/futuresObserverText.ts') continue;
    // lib/customerError.ts holds no copy at all. Its string literals are
    // the SERVER's own sentences, listed so that each can be answered in
    // the customer's language instead — reading them as product copy would
    // flag the very phrases the module exists to keep off the screen. What
    // it actually shows is the `serverError.*` wording in the seven
    // dictionaries, which __tests__/customerFacingErrors.test.ts checks
    // against this same vocabulary, in every language.
    if (rel === 'frontend/src/lib/customerError.ts') continue;
    for (const text of visibleStrings(readFileSync(path, 'utf8'))) {
      if (allowed(text)) continue;
      if (PLUMBING.some((r) => r.test(text))) offenders.push(`${rel}: ${text.slice(0, 120)}`);
    }
  }
  expect(offenders).toEqual([]);
});

/** As `isCopy`, but any script counts as text: the practice vocabulary is also Hindi, Japanese, Korean and Chinese. */
const isAnyCopy = (value: string) => {
  const text = core(value);
  return text.length >= 2 && /\p{L}/u.test(text) && !NOT_COPY.some((r) => r.test(text));
};

test('no component copy, in any of the seven languages, is a practice / training / simulation / demo notice, and no badge says so', () => {
  const offenders: string[] = [];
  for (const path of uiFiles(resolve(root, 'frontend/src'))) {
    const rel = relative(root, path).replace(/\\/g, '/');
    // Staff-only screens and the isolated loopback review are not customer copy (as above).
    if (rel.startsWith('frontend/src/pages/admin/') || rel.startsWith('frontend/src/mobile-review/')) continue;
    if (rel === 'frontend/src/pages/copy-trading-bolt/copyDemoText.ts') continue;
    // Exact, isolated review dictionary: require truthful demo disclosures separately.
    if (rel === 'frontend/src/pages/copy-trading-bolt/futuresObserverText.ts') continue;
    // The server's own sentences, mapped to neutral `serverError.*` wording (see above).
    if (rel === 'frontend/src/lib/customerError.ts') continue;
    // Stocks is Codex's work in progress and switched off on the exchange (VITE_STOCKS_ENABLED unset);
    // the owner has said not to interfere with it. Its «тестовый счёт» wording must go before it is
    // switched on — recorded in docs/AI_HANDOFF.md (2026-10-22). Nothing else is exempt.
    if (rel.startsWith('frontend/src/pages/stocks/')) continue;
    const source = readFileSync(path, 'utf8');
    const candidates: string[] = [];
    for (const line of source.split('\n')) {
      if (/^\s*(import|export)\s/.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const m of line.matchAll(/>([^<>{}\n]{2,300})</g)) candidates.push(m[1].trim());
      for (const m of line.matchAll(/(['"`])((?:[^'"`\\\n]|\\.){2,300}?)\1/g)) candidates.push(m[2]);
    }
    for (const text of candidates.filter(isAnyCopy)) {
      // The dictionaries get the trading vocabulary in their own test above, where Stocks' keys are exempt.
      const trading = !rel.startsWith('frontend/src/lib/i18n/locales/') && saysTradingUnavailable(text);
      if (!allowed(text) && (PRACTICE_NOTICES.some((r) => r.test(text)) || trading)) offenders.push(`${rel}: ${text.slice(0, 120)}`);
    }
    for (const m of source.matchAll(/>\s*(SIM|DEMO|TEST|PRACTICE|ДЕМО|ТЕСТ)\s*</g)) offenders.push(`${rel}: badge «${m[1]}»`);
  }
  expect(offenders).toEqual([]);
});

test('isolated copy review keeps mandatory demo disclosure in every language and stays separately gated', () => {
  const vocabulary = { en: /\bdemo\b/i, ru: /демо/i, es: /\bdemo\b/i, zh: /模拟/, hi: /डेमो/, ja: /デモ/, ko: /데모/ };
  expect(Object.keys(copyDemoText).sort()).toEqual([...LOCALES].sort());
  for (const lang of LOCALES) {
    expect(copyDemoText[lang].title).toMatch(vocabulary[lang]);
    expect(copyDemoText[lang].notice).toMatch(vocabulary[lang]);
    expect(copyDemoText[lang].pnl).toMatch(vocabulary[lang]);
  }
  const app = readFileSync(resolve(root, 'frontend/src/App.tsx'), 'utf8');
  expect(app).toContain("import.meta.env.VITE_COPY_DEMO_REVIEW === 'true'");
  const consumers = uiFiles(resolve(root, 'frontend/src')).filter(path =>
    readFileSync(path, 'utf8').includes('copyDemoText')).map(path => relative(root, path).replace(/\\/g, '/')).sort();
  expect(consumers).toEqual(['frontend/src/pages/CopyDemoPage.tsx', 'frontend/src/pages/copy-trading-bolt/copyDemoText.ts']);
});

test('isolated Futures observer keeps truthful no-copy warnings in seven languages and remains flagged OFF', () => {
  const vocabulary = { en: /demo/i, ru: /демо/i, es: /demo/i, zh: /模拟/, hi: /डेमो/, ja: /デモ/, ko: /데모/ };
  expect(Object.keys(futuresObserverText).sort()).toEqual([...LOCALES].sort());
  for (const lang of LOCALES) {
    expect(futuresObserverText[lang].title).toMatch(vocabulary[lang]);
    expect(futuresObserverText[lang].warning.length).toBeGreaterThan(30);
    expect(futuresObserverText[lang].noTrade.length).toBeGreaterThan(6);
    expect(futuresObserverText[lang].disclaimer.length).toBeGreaterThan(25);
  }
  const app = readFileSync(resolve(root, 'frontend/src/App.tsx'), 'utf8');
  expect(app).toContain("import.meta.env.VITE_COPY_FUTURES_DEMO_OBSERVER_REVIEW === 'true'");
  const consumers = uiFiles(resolve(root, 'frontend/src')).filter(path =>
    readFileSync(path, 'utf8').includes('futuresObserverText')).map(path => relative(root, path).replace(/\\/g, '/')).sort();
  expect(consumers).toEqual([
    'frontend/src/pages/CopyFuturesObserverPage.tsx',
    'frontend/src/pages/copy-trading-bolt/futuresObserverText.ts',
  ]);
});

test('the practice vocabulary catches every former notice and leaves ordinary wording alone', () => {
  const hit = (text: string) => PRACTICE_NOTICES.some((r) => r.test(text));
  for (const text of ['Учебный рынок', 'Торговля пока недоступна', 'Рынок открыт', 'Этот аккаунт работает только в тренировочном режиме.',
    'Practice market', 'This account works in practice mode only.', 'Trading is currently unavailable', 'Mercado de práctica',
    'अभ्यास बाज़ार', '練習用市場', '연습용 시장', '练习市场', 'Демо · симуляция', 'Demo · simulated', '이 브라우저에 모의 거래 데이터를 저장할 수 없습니다.',
    'Не удалось сохранить данные практики в браузере.'])
    expect({ text, hit: hit(text) || PLUMBING.some((r) => r.test(text)) }).toEqual({ text, hit: true });
  for (const text of ['Рынки', 'Купить', 'Дата листинга', 'Данные временно недоступны', 'Торговля акциями пока недоступна.', 'Market', 'Price', '市场', '价格'])
    expect({ text, hit: hit(text) }).toEqual({ text, hit: false });
});

test('the «trading unavailable / coming soon» vocabulary catches the former CFD, TradFi and home lines in every language and leaves data wording alone', () => {
  for (const text of ['Торговля CFD временно недоступна.', 'CFD trading temporarily unavailable.', 'La negociación de CFD no está disponible temporalmente.',
    'CFD ट्रेडिंग अस्थायी रूप से अनुपलब्ध है।', 'CFD取引は一時的に利用できません。', 'CFD 거래를 일시적으로 이용할 수 없습니다.', 'CFD 交易暂不可用。',
    'Торговля пока недоступна', 'Trading is currently unavailable',
    'Торговля традиционными активами станет доступна в одном из следующих обновлений.', 'Котировки CFD скоро появятся', 'CFD quotes are coming soon',
    'Las cotizaciones de CFD llegarán pronto', 'CFD कोट्स जल्द आ रहे हैं', 'CFD の気配値は近日公開', 'CFD 시세가 곧 제공됩니다', 'CFD 报价即将上线',
    'Этот актив пока не торгуется', 'This asset is not trading yet', 'Este activo todavía no se negocia',
    'Пополнение пока недоступно: адреса кошельков ещё не подключены.', 'Deposits are not available yet: no wallet addresses are connected.',
    'Конвертация пока недоступна', 'Convert is not available yet', 'Заём пока недоступен', 'Ни одна сеть пока не подключена.',
    'No networks are connected yet.', 'Todavía no hay redes conectadas.', 'Пока недоступно', 'Aún no disponible',
    'Карта пока недоступна для этого аккаунта.', 'The card is not available for this account yet.',
    'Условия досрочного возврата основной суммы пока не определены.', 'Направление пока не подтверждено.', 'Лимитное закрытие пока недоступно в приватном режиме'])
    expect({ text, hit: saysTradingUnavailable(text) }).toEqual({ text, hit: true });
  for (const text of ['Данные временно недоступны', 'Не удалось обновить данные. Показаны последние полученные значения.', 'График временно недоступен',
    'Цена сейчас недоступна, поэтому расчёт не подтверждён.', 'Data temporarily unavailable', 'Trading', 'Торговля', '交易', '取引', '거래',
    '等面积：交易量不可用', '等面積：取引量は取得できません', '資金・取引条件を確認できませんでした。データを更新してください。', 'Эта страница недоступна для вашего аккаунта.',
    'Операций пока нет', 'Депозитов пока нет.', 'Сделок по этой паре ещё не было.', 'Исходная заявка пока не найдена.', 'La fecha de listado aún no está confirmada', 'Data temporarily unavailable'])
    expect({ text, hit: saysTradingUnavailable(text) }).toEqual({ text, hit: false });
});

// Owner, 2026-10-22: the order forms say nothing when an order cannot be placed — the button is disabled.
test('the Spot and Futures order forms have no «not trading yet» / «Недоступно» line', () => {
  const spot = readFileSync(resolve(root, 'frontend/src/components/OrderForm.tsx'), 'utf8');
  const futures = readFileSync(resolve(root, 'frontend/src/components/FuturesOrderForm.tsx'), 'utf8');
  expect(spot).not.toMatch(/assetNotTradingYet|assetPurchaseUnavailable|assetOrderTypeUnavailable/);
  expect(spot).toContain('<button type="submit" disabled={submitting || orderBlocked}');
  expect(futures).not.toContain("t('analytics.unavailable')");
  expect(futures).toContain('disabled={!canSubmit || protectionBreachFor(\'BUY\') || !reducible(\'BUY\')}');
});
