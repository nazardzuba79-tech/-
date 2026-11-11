import {
  ASSETS,
  dynamicMethodId,
  findAsset,
  findAssetNetwork,
  findRubMethod,
  inferMethodKind,
  isAssetId,
  isMethodIdShape,
  isNetworkId,
  isSupportedPair,
  isUrlname,
  NETWORKS,
  networkLabel,
  pairKey,
  RECEIVE_PAIRS,
  resolveReceiveCurrencies,
  resolveRubMethods,
  RUB_METHODS,
} from '../catalog';
import type { BestChangeCurrencyLike } from '../types';

// Test fixture only: synthetic directory rows with made-up ids, never used outside __tests__.
let nextId = 9000;
const cur = (p: Partial<BestChangeCurrencyLike> & { urlname: string; code: string }): BestChangeCurrencyLike => ({
  id: nextId++,
  name: p.code,
  crypto: true,
  cash: false,
  ...p,
});

describe('RUB_METHODS', () => {
  test('is exactly the documented fixed table', () => {
    expect(RUB_METHODS.map((m) => [m.id, m.urlname, m.label, m.kind])).toEqual([
      ['sbp', 'sbp', 'Карта и СБП без P2P', 'payment_system'],
      ['sberbank', 'sberbank', 'Сбербанк', 'bank'],
      ['tbank', 'tinkoff', 'Т-Банк', 'bank'],
      ['alfabank', 'alfaclick', 'Альфа-Банк', 'bank'],
      ['vtb', 'vtb', 'ВТБ', 'bank'],
      ['card', 'visa-mastercard-rub', 'Карта банка и СБП', 'card'],
      ['mir', 'mir', 'Карта Мир', 'card'],
    ]);
    expect(findRubMethod('tbank')?.urlname).toBe('tinkoff');
    expect(findRubMethod('cash')).toBeUndefined();
  });

  test('no Ukrainian letters anywhere in the catalogue copy', () => {
    const text = JSON.stringify({ RUB_METHODS, ASSETS, NETWORKS });
    expect(text).not.toMatch(/[\u0456\u0457\u0454\u0491\u0406\u0407\u0404\u0490]/);
  });

  test('method id shapes', () => {
    expect(isMethodIdShape('sbp')).toBe(true);
    expect(isMethodIdShape(dynamicMethodId('raiffeisen'))).toBe(true);
    expect(dynamicMethodId('raiffeisen')).toBe('bc-raiffeisen');
    for (const bad of ['', 'cash', 'bc-', 'bc-Raif', 'bc-../x', 'BC-raif', 'sbp ', null, 1]) expect(isMethodIdShape(bad)).toBe(false);
  });

  test('inferMethodKind defaults to bank', () => {
    expect(inferMethodKind('Райффайзенбанк')).toBe('bank');
    expect(inferMethodKind('Газпромбанк RUB')).toBe('bank');
    expect(inferMethodKind('Visa/MasterCard RUB')).toBe('card');
    expect(inferMethodKind('Карта Мир')).toBe('card');
    expect(inferMethodKind('ЮMoney')).toBe('payment_system');
    expect(inferMethodKind('СБП')).toBe('payment_system');  });

  test('«Мир» is recognised as a card on a Unicode word boundary only', () => {
    expect(inferMethodKind('Карта Мир RUB')).toBe('card');
    expect(inferMethodKind('Мир RUB')).toBe('card');
    expect(inferMethodKind('МИР')).toBe('card');
    expect(inferMethodKind('Банк (Мир)')).toBe('card');
    expect(inferMethodKind('Мирбанк')).toBe('bank');
    expect(inferMethodKind('Банк Мира')).toBe('bank');
  });
});

describe('resolveRubMethods', () => {
  test('keeps fixed methods present as non-crypto non-cash, adds *RUB extras, skips cash/crypto', () => {
    const dir = [
      cur({ urlname: 'sbp', code: 'SBPRUB', name: 'СБП', crypto: false }),
      cur({ urlname: 'tinkoff', code: 'TCSBRUB', name: 'Т-Банк', crypto: false }),
      cur({ urlname: 'vtb', code: 'VTBRUB', name: 'ВТБ', crypto: false, cash: true }), // cash: excluded
      cur({ urlname: 'mir', code: 'MIRCARDRUB', name: 'Мир', crypto: true }), // crypto: excluded
      cur({ urlname: 'raiffeisen', code: 'RFBRUB', name: 'Райффайзенбанк', crypto: false }),
      cur({ urlname: 'cash-ruble', code: 'CASHRUB', name: 'Наличные RUB', crypto: false, cash: true }),
      cur({ urlname: 'wire-usd', code: 'WIREUSD', name: 'Wire USD', crypto: false }),
      cur({ urlname: 'bad name', code: 'XRUB', name: 'X', crypto: false }),
      cur({ urlname: 'blank-rub', code: 'BLANKRUB', name: '   ', crypto: false }),
    ];
    const out = resolveRubMethods(dir);
    expect(out.map((m) => [m.id, m.label, m.kind, m.fixed])).toEqual([
      ['sbp', 'Карта и СБП без P2P', 'payment_system', true],
      ['tbank', 'Т-Банк', 'bank', true],
      ['bc-raiffeisen', 'Райффайзенбанк', 'bank', false],
    ]);
    expect(out[0].currencyId).toBe(dir[0].id);
  });

  test('a fixed urlname that is cash is not re-added as a dynamic extra', () => {
    const out = resolveRubMethods([cur({ urlname: 'vtb', code: 'VTBRUB', name: 'ВТБ', crypto: false, cash: true })]);
    expect(out).toEqual([]);
  });

  test('empty directory resolves to nothing (no invented methods)', () => {
    expect(resolveRubMethods([])).toEqual([]);
  });
});

describe('assets and networks', () => {
  test('catalogue pairs (v0 catalogue)', () => {
    expect(RECEIVE_PAIRS.map((p) => p.key)).toEqual([
      'USDT:tron',
      'USDT:ethereum',
      'USDT:bsc',
      'USDT:ton',
      'BTC:bitcoin',
      'ETH:ethereum',
      'TRX:tron',
      'TON:ton',
      'USDC:ethereum',
      'USDC:solana',
      'LTC:litecoin',
      'SOL:solana',
    ]);
    expect(new Set(RECEIVE_PAIRS.map((p) => p.key)).size).toBe(RECEIVE_PAIRS.length);
  });

  test('docs/EXCHANGERS_694.md states the real number of catalogue pairs', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const doc: string = require('fs').readFileSync(require('path').resolve(__dirname, '../../../../docs/EXCHANGERS_694.md'), 'utf8');
    expect(RECEIVE_PAIRS).toHaveLength(12);
    expect(doc).toContain(`v0 catalogue, ${RECEIVE_PAIRS.length} asset:network pairs`);
  });

  test('labels and decimals', () => {
    expect(findAssetNetwork('USDT', 'tron')?.label).toBe('USDT TRC-20');
    expect(findAssetNetwork('TRX', 'tron')?.label).toBe('TRX');
    expect(findAsset('BTC')?.displayDecimals).toBe(6);
    expect(findAsset('XRP')).toBeUndefined();
  });

  test('TRX:tron and USDT:tron are distinct everywhere', () => {
    expect(pairKey('TRX', 'tron')).toBe('TRX:tron');
    expect(pairKey('USDT', 'tron')).toBe('USDT:tron');
    expect(networkLabel('TRX', 'tron')).toBe('TRON (Native)');
    expect(networkLabel('USDT', 'tron')).toBe('TRON (TRC-20)');
    const trx = findAssetNetwork('TRX', 'tron')!;
    const usdt = findAssetNetwork('USDT', 'tron')!;
    expect(trx.native).toBe(true);
    expect(usdt.native).toBe(false);
    expect(trx.match.codes.some((c) => usdt.match.codes.includes(c))).toBe(false);
    expect(trx.match.urlnames.some((u) => usdt.match.urlnames.includes(u))).toBe(false);
  });

  test('no two pairs share a candidate code or urlname', () => {
    const codes = RECEIVE_PAIRS.flatMap((p) => p.match.codes.map((c) => c.toUpperCase()));
    const urlnames = RECEIVE_PAIRS.flatMap((p) => p.match.urlnames);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(urlnames).size).toBe(urlnames.length);
    for (const u of urlnames) expect(isUrlname(u)).toBe(true);
  });

  test('guards', () => {
    expect(isAssetId('USDT')).toBe(true);
    expect(isAssetId('usdt')).toBe(false);
    expect(isNetworkId('tron')).toBe(true);
    expect(isNetworkId('toString')).toBe(false);
    expect(isNetworkId('__proto__')).toBe(false);
    expect(isSupportedPair('USDT', 'tron')).toBe(true);
    expect(isSupportedPair('TRX', 'ethereum')).toBe(false);
    expect(isSupportedPair('BTC', 'tron')).toBe(false);
    expect(networkLabel('BTC', 'tron')).toBe('TRON');
    expect(networkLabel('ETH', 'ethereum')).toBe('Ethereum (Native)');
    expect(networkLabel('USDC', 'solana')).toBe('Solana (SPL)');
  });
});

describe('resolveReceiveCurrencies', () => {
  test('matches by code first, then urlname, crypto & non-cash only', () => {
    const usdtTrc = cur({ urlname: 'tether-trc20', code: 'USDTTRC20' });
    const trx = cur({ urlname: 'tron', code: 'TRX' });
    const btc = cur({ urlname: 'bitcoin', code: 'BTC' });
    const tonByUrlname = cur({ urlname: 'ton', code: 'TONCOIN' });
    const fiatEth = cur({ urlname: 'ethereum', code: 'ETH', crypto: false });
    const cashLtc = cur({ urlname: 'litecoin', code: 'LTC', cash: true });
    const map = resolveReceiveCurrencies([usdtTrc, trx, btc, tonByUrlname, fiatEth, cashLtc]);
    expect(map.get('USDT:tron')).toBe(usdtTrc);
    expect(map.get('TRX:tron')).toBe(trx);
    expect(map.get('BTC:bitcoin')).toBe(btc);
    expect(map.get('TON:ton')).toBe(tonByUrlname);
    expect(map.has('ETH:ethereum')).toBe(false);
    expect(map.has('LTC:litecoin')).toBe(false);
    expect(map.has('USDT:ethereum')).toBe(false); // unmatched pair hidden, never guessed
    expect(map.get('USDT:tron')!.id).not.toBe(map.get('TRX:tron')!.id);
  });

  test('code match is case-insensitive and wins over urlname', () => {
    const byCode = cur({ urlname: 'usdt-tron-x', code: 'usdttrc20' });
    const byUrl = cur({ urlname: 'tether-trc20', code: 'OTHER' });
    expect(resolveReceiveCurrencies([byUrl, byCode]).get('USDT:tron')).toBe(byCode);
  });

  test('one currency claimed by two pairs (TRX vs USDT TRC-20) is dropped for both', () => {
    // A directory row whose code says TRX but whose urlname says tether-trc20.
    const confused = cur({ urlname: 'tether-trc20', code: 'TRX' });
    const map = resolveReceiveCurrencies([confused]);
    expect(map.has('TRX:tron')).toBe(false);
    expect(map.has('USDT:tron')).toBe(false);
  });

  test('ambiguous duplicates hide the pair', () => {
    const a = cur({ urlname: 'bitcoin', code: 'BTC' });
    const b = cur({ urlname: 'bitcoin-2', code: 'BTC' });
    expect(resolveReceiveCurrencies([a, b]).has('BTC:bitcoin')).toBe(false);
  });

  test('rows with invalid ids or urlnames are ignored', () => {
    expect(resolveReceiveCurrencies([cur({ id: 0, urlname: 'bitcoin', code: 'BTC' })]).size).toBe(0);
    expect(resolveReceiveCurrencies([cur({ id: 1.5, urlname: 'bitcoin', code: 'BTC' })]).size).toBe(0);
    expect(resolveReceiveCurrencies([cur({ urlname: 'Bitcoin', code: 'BTC' })]).size).toBe(0);
  });
});
