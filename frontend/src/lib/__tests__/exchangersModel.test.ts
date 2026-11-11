import {
  DEFAULT_FILTERS,
  MANUAL_CHECK_MARKS,
  MARK_INFO,
  SORT_OPTIONS,
  bestOffer,
  crownEligible,
  directionHref,
  formatLimits,
  formatReserve,
  resultsStatusText,
  fallbackOptions,
  filterOffers,
  fitsConfirmed,
  methodOptionLabel,
  methodUrlname,
  networkDisplay,
  networkHint,
  offerAction,
  optionsFromDirectory,
  pickNetwork,
  queryFromDraft,
  reconcileDraft,
  sanitizeAmountInput,
  sortOffers,
  validateDirectoryBody,
  validateOffer,
  validateOffersBody,
  type CalculatorDraft,
} from '../../pages/exchangers/model';
import { OFFER_MARKS, type Offer, type OffersQuery } from '../../../../src/shared/exchangers/types';
import { parseRubAmount } from '../../../../src/shared/exchangers/amount';

/**
 * «Обменники» (Issue #694) page logic. Every row below is a made-up fixture
 * (exchanger ids 9000+, names «Обменник A…»): nothing here is a real offer,
 * rate or exchanger, and no fixture lives outside __tests__.
 */

const QUERY: OffersQuery = { method: 'sbp', asset: 'USDT', network: 'tron', amount: 10000 };

function rawOffer(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: String(id),
    exchanger: { id, name: `Обменник ${id}`, rating: null, reviews: { positive: 10, neutral: 1, claim: 0, closed: 0 } },
    rubPerUnit: 95,
    rankRubPerUnit: 96,
    receiveAmount: 105.26,
    minRub: 1000,
    maxRub: 500000,
    reserve: 50000,
    marks: [],
    fitsAmount: true,
    link: { kind: 'exchanger', url: `https://www.bestchange.ru/click.php?id=${id}` },
    ...over,
  };
}

function offer(id: number, over: Record<string, unknown> = {}): Offer {
  const o = validateOffer(rawOffer(id, over));
  if (!o) throw new Error(`fixture ${id} rejected`);
  return o;
}

function okBody(offers: unknown[], over: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    asOf: '2026-11-08T08:00:00.000Z',
    stale: false,
    query: { ...QUERY },
    directionLink: { url: 'https://www.bestchange.ru/sbp-to-tether-trc20.html' },
    offers,
    ...over,
  };
}

describe('offers response validation', () => {
  test('accepts the documented shape and keeps nulls as null', () => {
    const r = validateOffersBody(okBody([rawOffer(9001, { rankRubPerUnit: null, reserve: null, minRub: null, maxRub: null, receiveAmount: null, fitsAmount: null })]), QUERY);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.data.directionUrl).toBe('https://www.bestchange.ru/sbp-to-tether-trc20.html');
    expect(r.data.delayed).toBe(false);
    const [o] = r.data.offers;
    expect([o.rankRubPerUnit, o.reserve, o.minRub, o.maxRub, o.receiveAmount, o.fitsAmount]).toEqual([null, null, null, null, null, null]);
  });

  test('maps every documented non-OK body', () => {
    expect(validateOffersBody({ status: 'not_configured' }, QUERY)).toEqual({ kind: 'not_configured' });
    expect(validateOffersBody({ status: 'unavailable', retryAfter: 30 }, QUERY)).toEqual({ kind: 'unavailable', retryAfter: 30 });
    expect(validateOffersBody({ status: 'unavailable' }, QUERY)).toEqual({ kind: 'unavailable', retryAfter: null });
    expect(validateOffersBody({ status: 'rate_limited', retryAfter: 1e9 }, QUERY)).toEqual({ kind: 'rate_limited', retryAfter: 3600 });
    expect(validateOffersBody({ status: 'invalid' }, QUERY)).toEqual({ kind: 'invalid' });
  });

  test('rejects malformed bodies as error, never as an empty result', () => {
    for (const bad of [null, 'ok', [], {}, { status: 'ok' }, { status: 'weird' }, okBody('x' as unknown as unknown[]),
      okBody([], { stale: 'no' }), okBody([], { asOf: 'yesterday' }), okBody([], { query: { ...QUERY, amount: 5 } }),
      okBody([], { query: { ...QUERY, asset: 'TRX' } })]) {
      expect(validateOffersBody(bad, QUERY)).toEqual({ kind: 'error' });
    }
  });

  test('drops broken rows (bad numbers, mismatched ids, empty names) and duplicates', () => {
    const r = validateOffersBody(okBody([
      rawOffer(9001),
      rawOffer(9001),
      rawOffer(9002, { rubPerUnit: 0 }),
      rawOffer(9003, { rubPerUnit: Number.NaN }),
      rawOffer(9004, { id: '1' }),
      rawOffer(9005, { reserve: -1 }),
      rawOffer(9006, { exchanger: { id: 9006, name: '   ', rating: null, reviews: null } }),
      rawOffer(9007, { exchanger: { id: 9007, name: 'x', rating: null, reviews: { positive: 1.5, neutral: 0, claim: 0, closed: 0 } } }),
      rawOffer(9008, { fitsAmount: 'yes' }),
      rawOffer(9009, { rankRubPerUnit: '96' }),
    ]), QUERY);
    expect(r.kind === 'ok' && r.data.offers.map((o) => o.id)).toEqual(['9001']);
  });

  test('unknown marks are dropped, known ones kept once', () => {
    expect(offer(9001, { marks: ['manual', 'manual', 'evil', 42, 'verifying'] }).marks).toEqual(['manual', 'verifying']);
  });

  test('a direction link that fails the shared re-check becomes null', () => {
    for (const url of ['https://evil.example/sbp-to-tether-trc20.html', 'javascript:alert(1)', 'https://www.bestchange.ru/sbp-to-tether-trc20.html?p=1&token=abc']) {
      const r = validateOffersBody(okBody([], { directionLink: { url } }), QUERY);
      expect(r.kind === 'ok' && r.data.directionUrl).toBeNull();
    }
  });
});

describe('offer links are re-checked against the offer\'s own exchanger', () => {
  const MALICIOUS = [
    'javascript:alert(1)',
    'data:text/html,hi',
    'http://www.bestchange.ru/click.php?id=9001',
    '//www.bestchange.ru/click.php?id=9001',
    'https://www.bestchange.ru.evil.com/click.php?id=9001',
    'https://evil.com/click.php?id=9001',
    'https://user@www.bestchange.ru/click.php?id=9001',
    'https://www.bestchange.ru:444/click.php?id=9001',
    'https://www.bestchange.ru/click.php?id=9001#x',
    'https://www.bestchange.ru/click.php?id=9001&to=https://evil.com',
    'https://www.bestchange.ru/click.php?id=9002',
    'https://www.bestchange.ru/%2e%2e/click.php?id=9001',
    'https://www.xn--bestchang-x2a.ru/click.php?id=9001',
    'https://127.0.0.1/click.php?id=9001',
  ];

  test.each(MALICIOUS)('rejects %s at validation time', (url) => {
    expect(offer(9001, { link: { kind: 'exchanger', url } }).link).toBeNull();
  });

  test('a valid click link of this exchanger becomes «Перейти к обменнику»', () => {
    const o = offer(9001);
    expect(offerAction(o, null)).toEqual({ kind: 'exchanger', href: 'https://www.bestchange.ru/click.php?id=9001' });
  });

  test('offerAction re-checks even a link that skipped validation', () => {
    const forged = { ...offer(9001), link: { kind: 'exchanger' as const, url: 'javascript:alert(1)' } };
    expect(offerAction(forged, null)).toEqual({ kind: 'none' });
    const other = { ...offer(9001), link: { kind: 'exchanger' as const, url: 'https://www.bestchange.ru/click.php?id=9002' } };
    expect(offerAction(other, 'https://www.bestchange.ru/sbp-to-tether-trc20.html'))
      .toEqual({ kind: 'direction', href: 'https://www.bestchange.ru/sbp-to-tether-trc20.html' });
    expect(offerAction(other, 'https://evil.com/sbp-to-tether-trc20.html')).toEqual({ kind: 'none' });
  });

  test('section link: the server link when valid, else built from the catalogue, never anything else', () => {
    expect(directionHref('sbp', 'USDT', 'tron', 'https://www.bestchange.ru/sbp-to-tether-trc20.html?p=123'))
      .toBe('https://www.bestchange.ru/sbp-to-tether-trc20.html?p=123');
    expect(directionHref('sbp', 'USDT', 'tron', 'https://evil.com/x.html')).toBe('https://www.bestchange.ru/sbp-to-tether-trc20.html');
    expect(directionHref('tbank', 'TRX', 'tron', null)).toBe('https://www.bestchange.ru/tinkoff-to-tron.html');
    // Without the server's link only a direction that was checked to exist is offered: nothing is guessed.
    expect(directionHref('bc-some-bank', 'BTC', 'bitcoin', null)).toBeNull();
    expect(directionHref('sbp', 'USDC', 'ethereum', null)).toBeNull();
    expect(directionHref('sbp', 'TON', 'ton', null)).toBe('https://www.bestchange.ru/sbp-to-ton.html');
    expect(directionHref('bc-some-bank', 'BTC', 'bitcoin', 'https://www.bestchange.ru/some-bank-to-bitcoin.html')).toBe('https://www.bestchange.ru/some-bank-to-bitcoin.html');
    expect(directionHref('bc-Bad Name', 'BTC', 'bitcoin', null)).toBeNull();
    expect(directionHref('unknown', 'BTC', 'bitcoin', null)).toBeNull();
    expect(methodUrlname('card')).toBe('visa-mastercard-rub');
  });
});

describe('amount entry accepts a comma or a dot', () => {
  test.each([
    ['10000', 10000], ['10 000', 10000], ['10 000', 10000], ['1234,5', 1234.5], ['1234.56', 1234.56], ['1', 1],
  ])('%s → %s', (input, value) => {
    expect(parseRubAmount(input)).toBe(value);
    expect(queryFromDraft({ method: 'sbp', assetId: 'USDT', networkId: 'tron', amountText: input })?.amount).toBe(value);
  });

  test.each(['', '0', '0,5', '1,234.56', '1.234', '-5', '1e5', '100000001', 'abc', '10,'])('%s is refused', (input) => {
    expect(queryFromDraft({ method: 'sbp', assetId: 'USDT', networkId: 'tron', amountText: input })).toBeNull();
  });

  test('typing filter keeps digits, spaces and separators only', () => {
    expect(sanitizeAmountInput('1a0 0<script>0,5')).toBe('10 00,5');
  });

  test('a draft with an unsupported pair or method shape is never sent', () => {
    expect(queryFromDraft({ method: 'sbp', assetId: 'TRX', networkId: 'ethereum', amountText: '100' })).toBeNull();
    expect(queryFromDraft({ method: '../admin', assetId: 'USDT', networkId: 'tron', amountText: '100' })).toBeNull();
  });
});

describe('TRX and USDT TRC-20 stay separate', () => {
  test('labels and hints', () => {
    expect(networkDisplay('USDT', 'tron')).toBe('TRON (TRC-20)');
    expect(networkDisplay('TRX', 'tron')).toBe('TRON (Native)');
    expect(networkDisplay('USDT', 'ethereum')).toBe('Ethereum (ERC-20)');
    expect(networkDisplay('USDT', 'bsc')).toBe('BNB Smart Chain (BEP-20)');
    expect(networkDisplay('USDT', 'ton')).toBe('TON');
    expect(networkHint('TRX', 'tron', false)).toMatch(/Это не USDT TRC-20/);
    expect(networkHint('USDT', 'tron', true)).toMatch(/токен, а не монета TRX/);
  });

  test('the two pairs build different BestChange directions', () => {
    expect(directionHref('sbp', 'TRX', 'tron', null)).not.toBe(directionHref('sbp', 'USDT', 'tron', null));
  });

  test('switching from USDT to TRX picks TRX\'s own network, not USDT\'s token', () => {
    const { pairs } = fallbackOptions();
    expect(pickNetwork(pairs, 'TRX', 'ethereum')).toBe('tron');
    expect(pickNetwork(pairs, 'USDT', 'bitcoin')).toBe('tron');
    expect(pickNetwork(pairs, 'BTC', 'tron')).toBe('bitcoin');
  });
});

describe('directory', () => {
  const body = {
    status: 'ok',
    asOf: null,
    methods: [
      { id: 'sbp', label: 'СБП', kind: 'payment_system', available: true },
      { id: 'sberbank', label: 'Сбербанк', kind: 'bank', available: false },
      { id: 'bc-some-bank', label: 'Какой-то банк', kind: 'bank', available: true },
      { id: 'bc-../x', label: 'bad', kind: 'bank', available: true },
      { id: 'mir', label: 'Карта Мир', kind: 'wallet', available: true },
      { id: 'sbp', label: 'dup', kind: 'payment_system', available: true },
    ],
    assets: [
      { assetId: 'USDT', networkId: 'tron', available: true },
      { assetId: 'TRX', networkId: 'tron', available: false },
      { assetId: 'TRX', networkId: 'ethereum', available: true },
      { assetId: 'DOGE', networkId: 'doge', available: true },
    ],
  };

  test('keeps valid rows only', () => {
    const r = validateDirectoryBody(body);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.data.methods.map((m) => m.id)).toEqual(['sbp', 'sberbank', 'bc-some-bank']);
    expect(r.data.assets).toEqual([{ assetId: 'USDT', networkId: 'tron', available: true }, { assetId: 'TRX', networkId: 'tron', available: false }]);
    const opts = optionsFromDirectory(r.data);
    expect(methodOptionLabel(opts.methods[0])).toBe('СБП · платёжная система'); // the label the server sent in this fixture
    expect(methodOptionLabel(opts.methods[1])).toBe('Сбербанк · банк (нет предложений)');
    // An unavailable remembered choice moves to an available one.
    const draft: CalculatorDraft = { method: 'sberbank', assetId: 'TRX', networkId: 'tron', amountText: '5 000' };
    expect(reconcileDraft(draft, opts)).toEqual({ method: 'sbp', assetId: 'USDT', networkId: 'tron', amountText: '5 000' });
  });

  test('not_configured and failures', () => {
    expect(validateDirectoryBody({ status: 'not_configured' })).toEqual({ kind: 'not_configured' });
    expect(validateDirectoryBody({ status: 'ok', methods: {}, assets: [] , asOf: null})).toEqual({ kind: 'error' });
    expect(validateDirectoryBody(undefined)).toEqual({ kind: 'error' });
  });

  test('the fixed catalogue (no directory) labels SBP, banks and cards honestly', () => {
    const labels = fallbackOptions().methods.map(methodOptionLabel);
    expect(labels).toEqual([
      'Карта и СБП без P2P · платёжная система', 'Сбербанк · банк', 'Т-Банк · банк', 'Альфа-Банк · банк', 'ВТБ · банк', 'Карта банка и СБП · карта',
    ]);
    // Without server data only directions with a verified BestChange page are listed:
    // «Карта Мир» and USDC ERC-20 have none, so they are not offered (never shown as "no offers").
    const options = fallbackOptions();
    expect(options.methods.every((m) => m.available)).toBe(true);
    expect(options.pairs.map((p) => `${p.assetId}:${p.networkId}`)).toEqual([
      'USDT:tron', 'USDT:ethereum', 'USDT:bsc', 'USDT:ton', 'BTC:bitcoin', 'ETH:ethereum', 'TRX:tron', 'TON:ton', 'USDC:solana', 'LTC:litecoin', 'SOL:solana',
    ]);
    for (const m of options.methods) for (const p of options.pairs) expect(directionHref(m.id, p.assetId, p.networkId, null)).toMatch(/^https:\/\/www\.bestchange\.ru\/[a-z0-9-]+-to-[a-z0-9-]+\.html$/);
  });
});

describe('sorting and filtering with unknown values', () => {
  const offers = [
    offer(9001, { rubPerUnit: 97, rankRubPerUnit: null, reserve: null, minRub: null, exchanger: { id: 9001, name: 'Обменник A', rating: null, reviews: null } }),
    offer(9002, { rubPerUnit: 95, rankRubPerUnit: 99, reserve: 10, receiveAmount: 105, minRub: 5000 }),
    offer(9003, { rubPerUnit: 96, rankRubPerUnit: 96.5, reserve: 900000, minRub: 100, marks: ['verifying'],
      exchanger: { id: 9003, name: 'Обменник C', rating: 4, reviews: { positive: 500, neutral: 2, claim: 1, closed: 1 } } }),
    offer(9004, { rubPerUnit: 98, rankRubPerUnit: 98, reserve: 1000, fitsAmount: false, minRub: 20000, marks: ['manual'] }),
  ];
  const ids = (list: Offer[]) => list.map((o) => o.id);

  test('the default is BestChange\'s rate including commissions, offers that fit the amount first, unknown last', () => {
    expect(SORT_OPTIONS[0]).toEqual({ value: 'best', label: 'Лучший курс с учётом комиссий' });
    // 9003 and 9001 can serve the amount; 9004 is outside its limits and 9002's reserve (10) is short of 105.
    expect(offers.map(crownEligible)).toEqual([true, false, true, false]);
    expect(ids(sortOffers(offers, 'best'))).toEqual(['9003', '9001', '9004', '9002']);
  });

  test('the first row of the default sort is always the crowned offer', () => {
    // Better rankrate, but the amount is outside the limits / the reserve cannot pay the receive amount.
    const outside = offer(9201, { rankRubPerUnit: 90, fitsAmount: false });
    const short = offer(9202, { rankRubPerUnit: 91, receiveAmount: 105.26, reserve: 100 });
    const fits = offer(9203, { rankRubPerUnit: 97 });
    const fitsWorse = offer(9204, { rankRubPerUnit: 98, fitsAmount: null });
    const list = [outside, short, fitsWorse, fits];
    const sorted = sortOffers(list, 'best');
    expect(ids(sorted)).toEqual(['9203', '9204', '9201', '9202']);
    expect(sorted[0].id).toBe(bestOffer(list)?.id);
    // Without any offer that fits, rankrate order still holds and there is no crown.
    expect(ids(sortOffers([short, outside], 'best'))).toEqual(['9201', '9202']);
    expect(bestOffer([short, outside])).toBeNull();
    // The explicit one-column sorts are not regrouped.
    expect(ids(sortOffers(list, 'rate'))[0]).toBe('9201');
  });

  test('rate, reserve, minimum and reviews', () => {
    expect(ids(sortOffers(offers, 'rate'))).toEqual(['9002', '9003', '9001', '9004']);
    expect(ids(sortOffers(offers, 'reserve'))).toEqual(['9003', '9004', '9002', '9001']);
    expect(ids(sortOffers(offers, 'min'))).toEqual(['9003', '9002', '9004', '9001']);
    expect(ids(sortOffers(offers, 'reviews'))).toEqual(['9003', '9002', '9004', '9001']);
  });

  test('sorting never mutates the input', () => {
    const before = ids(offers);
    sortOffers(offers, 'reserve');
    expect(ids(offers)).toEqual(before);
  });

  test('«Подходит под сумму» needs limits AND reserve confirmed', () => {
    expect(offers.map(fitsConfirmed)).toEqual([false, false, true, false]);
    expect(ids(filterOffers(offers, { ...DEFAULT_FILTERS, fitsAmount: true }))).toEqual(['9003']);
  });

  test('«Есть отзывы», manual-check marks and name search', () => {
    expect(ids(filterOffers(offers, { ...DEFAULT_FILTERS, withReviews: true }))).toEqual(['9002', '9003', '9004']);
    expect(ids(filterOffers(offers, { ...DEFAULT_FILTERS, noManualCheck: true }))).toEqual(['9001', '9002']);
    expect(ids(filterOffers(offers, { ...DEFAULT_FILTERS, search: '  обменник c ' }))).toEqual(['9003']);
    expect(MANUAL_CHECK_MARKS).toEqual(['manual', 'verifying', 'cardverify']);
  });

  test('the estimate comes from the best offer whose limits do not exclude the amount', () => {
    expect(bestOffer(offers)?.id).toBe('9003');
    expect(bestOffer([offers[3]])).toBeNull();
    expect(bestOffer([])).toBeNull();
  });

  test('the estimate never comes from an offer whose reserve is short of the receive amount', () => {
    // 9101 has the better rate including commissions but can pay out only 500 of the 10 526,31 it would owe.
    const short = offer(9101, { rubPerUnit: 95, rankRubPerUnit: 95, receiveAmount: 10526.31, reserve: 500, fitsAmount: true });
    const covered = offer(9102, { rubPerUnit: 96, rankRubPerUnit: 96, receiveAmount: 10416.66, reserve: 50000, fitsAmount: true });
    expect(fitsConfirmed(short)).toBe(false);
    expect(bestOffer([short, covered])?.id).toBe('9102');
    expect(bestOffer([short])).toBeNull();
    // An unknown reserve is not treated as short.
    const unknownReserve = offer(9103, { rubPerUnit: 95, rankRubPerUnit: 95, receiveAmount: 10526.31, reserve: null, fitsAmount: true });
    expect(bestOffer([unknownReserve, covered])?.id).toBe('9103');
  });
});

test('every BestChange mark has Russian copy and no raw token reaches the page', () => {
  expect(Object.keys(MARK_INFO).sort()).toEqual([...OFFER_MARKS].sort());
  expect(OFFER_MARKS).toHaveLength(17);
  for (const mark of OFFER_MARKS) {
    const { label, description } = MARK_INFO[mark];
    for (const text of [label, description]) {
      expect(text).toMatch(/[А-Яа-яЁё]/);
      expect(text).not.toMatch(/[A-Za-z]/);
      expect(text).not.toMatch(/[\u0456\u0457\u0454\u0491\u0406\u0407\u0404\u0490]/);
    }
    expect(description.length).toBeGreaterThan(10);
  }
});

test('«delay» carries the meaning from BestChange\'s Russian API description, as a caution', () => {
  expect(MARK_INFO.delay).toEqual({ label: 'Возможна задержка', description: 'Обмен может задерживаться на некоторое время.', tone: 'caution' });
});

describe('reserve and limits formatting', () => {
  const NB = '\u00a0';
  test('a small crypto reserve keeps the asset\'s display decimals and is never shown as 0', () => {
    expect(formatReserve(0.0042, 'BTC')).toBe('0,0042');
    expect(formatReserve(0.00123456789, 'BTC')).toBe('0,001234');
    expect(formatReserve(0.012345678, 'ETH')).toBe('0,01234');
    expect(formatReserve(0.0000004, 'BTC')).toBe('< 0,000001');
    expect(formatReserve(0.004, 'USDT')).toBe('< 0,01');
    expect(formatReserve(0, 'BTC')).toBe('0,00');
    expect(formatReserve(12.5, 'USDT')).toBe('12,50');
    expect(formatReserve(Number.NaN, 'BTC')).toBe('—');
  });

  test('reserves are rounded down, also in the compact form', () => {
    expect(formatReserve(999.999999999, 'BTC')).toBe('999,999999');
    expect(formatReserve(12_349.99, 'USDT')).toBe(`12,34${NB}тыс.`);
    expect(formatReserve(1_239_999, 'USDT')).toBe(`1,23${NB}млн`);
    expect(formatReserve(1_230_000, 'USDT')).toBe(`1,23${NB}млн`);
  });

  test('the minimum is rounded up and the maximum down, so the range never includes a rejected amount', () => {
    expect(formatLimits(1000, 500000)).toBe(`1${NB}000${NB}₽ – 500${NB}000${NB}₽`);
    expect(formatLimits(1000.5, 500000.7)).toBe(`1${NB}001${NB}₽ – 500${NB}000${NB}₽`);
    expect(formatLimits(999.4, 1999.6)).toBe(`1${NB}000${NB}₽ – 1${NB}999${NB}₽`);
    // Whole roubles would empty the range: kopecks instead, still inside the limits.
    expect(formatLimits(100.25, 100.75)).toBe(`100,25${NB}₽ – 100,75${NB}₽`);
    expect(formatLimits(null, 500000.9)).toBe(`? – 500${NB}000${NB}₽`);
    expect(formatLimits(1000.01, null)).toBe(`1${NB}001${NB}₽ – ?`);
  });
});

test('the results status line is short: state, count and update time', () => {
  expect(resultsStatusText('idle', { shown: 0, total: 0 }, null, false)).toBe('');
  expect(resultsStatusText('loading', { shown: 0, total: 0 }, null, false)).toBe('Загружаем предложения обменников…');
  expect(resultsStatusText('ok', { shown: 3, total: 5 }, '12:34', false)).toBe('Показано 3 из 5 предложений. Обновлено в 12:34.');
  expect(resultsStatusText('ok', { shown: 3, total: 5 }, '12:34', true)).toBe('Показано 3 из 5 предложений. Обновлено в 12:34. Свежие курсы сейчас не получены.');
  expect(resultsStatusText('ok', { shown: 0, total: 5 }, null, false)).toBe('Под выбранные фильтры не подходит ни одно из 5 предложений.');
  expect(resultsStatusText('ok', { shown: 0, total: 0 }, null, false)).toBe('По этому направлению предложений нет.');
  for (const kind of ['not_configured', 'unavailable', 'rate_limited', 'invalid', 'error'] as const) {
    const text = resultsStatusText(kind, { shown: 0, total: 0 }, null, false);
    expect(text.replace('BestChange', '')).toMatch(/^[А-Я][^A-Za-z]+\.$/);
  }
});
