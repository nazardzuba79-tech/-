import {
  BESTCHANGE_HOSTS,
  buildDirectionUrl,
  isBestChangeHost,
  isDirectionUrl,
  isExchangerClickUrl,
  normalizePartnerId,
  parseDirectionPath,
  parseStrictHttpsUrl,
  pickExchangerClickUrl,
} from '../links';

describe('parseStrictHttpsUrl', () => {
  test('accepts canonical https URLs', () => {
    expect(parseStrictHttpsUrl('https://www.bestchange.ru/click.php?id=1163')?.hostname).toBe('www.bestchange.ru');
    expect(parseStrictHttpsUrl('https://example.com/a/b.html')?.pathname).toBe('/a/b.html');
  });

  test.each([
    ['non-string', 42],
    ['empty', ''],
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: dressed as https', 'javascript://www.bestchange.ru/%0aalert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['http:', 'http://www.bestchange.ru/click.php?id=1'],
    ['upper-case scheme', 'HTTPS://www.bestchange.ru/click.php?id=1'],
    ['protocol-relative', '//www.bestchange.ru/click.php?id=1'],
    ['triple slash', 'https:///www.bestchange.ru/click.php?id=1'],
    ['backslash host separator', 'https://www.bestchange.ru\\click.php?id=1'],
    ['backslash after host', 'https:\\\\www.bestchange.ru/click.php?id=1'],
    ['leading space', ' https://www.bestchange.ru/click.php?id=1'],
    ['trailing newline', 'https://www.bestchange.ru/click.php?id=1\n'],
    ['tab inside', 'https://www.bestchange.ru/cli\tck.php?id=1'],
    ['non-ASCII host', 'https://www.bestсhange.ru/click.php?id=1'],
    ['punycode host', 'https://xn--bestchnge-x2a.ru/click.php?id=1'],
    ['punycode subdomain', 'https://xn--www-ed0a.bestchange.ru/click.php?id=1'],
    ['userinfo', 'https://user@www.bestchange.ru/click.php?id=1'],
    ['userinfo spoof', 'https://www.bestchange.ru@evil.com/click.php?id=1'],
    ['empty userinfo', 'https://:@www.bestchange.ru/click.php?id=1'],
    ['explicit port', 'https://www.bestchange.ru:8443/click.php?id=1'],
    ['default port', 'https://www.bestchange.ru:443/click.php?id=1'],
    ['IPv4 host', 'https://127.0.0.1/click.php?id=1'],
    ['integer IP host', 'https://2130706433/click.php?id=1'],
    ['IPv6 host', 'https://[::1]/click.php?id=1'],
    ['single-label host', 'https://localhost/click.php?id=1'],
    ['trailing-dot host', 'https://www.bestchange.ru./click.php?id=1'],
    ['upper-case host (non-canonical)', 'https://WWW.bestchange.ru/click.php?id=1'],
    ['fragment', 'https://www.bestchange.ru/click.php?id=1#x'],
    ['empty fragment', 'https://www.bestchange.ru/click.php?id=1#'],
    ['empty query', 'https://www.bestchange.ru/sbp-to-bitcoin.html?'],
    ['encoded slash', 'https://www.bestchange.ru/a%2Fb.html'],
    ['encoded dot', 'https://www.bestchange.ru/click%2Ephp?id=1'],
    ['dot segment', 'https://www.bestchange.ru/./click.php?id=1'],
    ['parent segment', 'https://www.bestchange.ru/x/../click.php?id=1'],
    ['no path (normalised)', 'https://www.bestchange.ru'],
    ['too long', `https://www.bestchange.ru/${'a'.repeat(2048)}`],
  ])('rejects %s', (_label, raw) => {
    expect(parseStrictHttpsUrl(raw)).toBeNull();
  });
});

describe('BESTCHANGE_HOSTS', () => {
  test('is exactly the four documented hosts', () => {
    expect([...BESTCHANGE_HOSTS].sort()).toEqual(['bestchange.com', 'bestchange.ru', 'www.bestchange.com', 'www.bestchange.ru']);
    expect(isBestChangeHost('www.bestchange.ru')).toBe(true);
    expect(isBestChangeHost('bestchange.app')).toBe(false);
    expect(isBestChangeHost('www.bestchange.pro')).toBe(false);
    expect(isBestChangeHost(undefined)).toBe(false);
  });
});

describe('isExchangerClickUrl', () => {
  test.each([
    'https://www.bestchange.ru/click.php?id=1163',
    'https://bestchange.ru/click.php?id=1163',
    'https://www.bestchange.com/click.php?id=1163',
    'https://bestchange.com/click.php?id=1163',
  ])('accepts %s for changer 1163 (number and string id)', (url) => {
    expect(isExchangerClickUrl(url, 1163)).toBe(true);
    expect(isExchangerClickUrl(url, '1163')).toBe(true);
  });

  test.each([
    ['other changer id', 'https://www.bestchange.ru/click.php?id=1164'],
    ['id prefix', 'https://www.bestchange.ru/click.php?id=11630'],
    ['leading zero', 'https://www.bestchange.ru/click.php?id=01163'],
    ['extra param', 'https://www.bestchange.ru/click.php?id=1163&to=https://evil.com'],
    ['param before id', 'https://www.bestchange.ru/click.php?x=1&id=1163'],
    ['duplicate id', 'https://www.bestchange.ru/click.php?id=1163&id=1163'],
    ['trailing ampersand', 'https://www.bestchange.ru/click.php?id=1163&'],
    ['upper-case key', 'https://www.bestchange.ru/click.php?ID=1163'],
    ['encoded id', 'https://www.bestchange.ru/click.php?id=%31163'],
    ['no query', 'https://www.bestchange.ru/click.php'],
    ['wrong path', 'https://www.bestchange.ru/click.php/x?id=1163'],
    ['path case', 'https://www.bestchange.ru/Click.php?id=1163'],
    ['nested path', 'https://www.bestchange.ru/a/click.php?id=1163'],
    ['fragment', 'https://www.bestchange.ru/click.php?id=1163#top'],
    ['userinfo', 'https://a@www.bestchange.ru/click.php?id=1163'],
    ['port', 'https://www.bestchange.ru:443/click.php?id=1163'],
    ['http', 'http://www.bestchange.ru/click.php?id=1163'],
    ['lookalike suffix host', 'https://bestchange.ru.evil.com/click.php?id=1163'],
    ['lookalike prefix host', 'https://evilbestchange.ru/click.php?id=1163'],
    ['sub-subdomain', 'https://a.www.bestchange.ru/click.php?id=1163'],
    ['unlisted mirror', 'https://www.bestchange.pro/click.php?id=1163'],
    ['api host', 'https://bestchange.app/click.php?id=1163'],
    ['punycode lookalike', 'https://xn--bestchnge-x2a.ru/click.php?id=1163'],
    ['IP host', 'https://93.184.216.34/click.php?id=1163'],
    ['protocol-relative', '//www.bestchange.ru/click.php?id=1163'],
    ['backslash', 'https://www.bestchange.ru\\click.php?id=1163'],
    ['javascript', 'javascript:alert(document.cookie)//https://www.bestchange.ru/click.php?id=1163'],
    ['data', 'data:text/html;base64,PHNjcmlwdD4='],
    ['encoded slash path', 'https://www.bestchange.ru/%2Fclick.php?id=1163'],
  ])('rejects %s', (_label, url) => {
    expect(isExchangerClickUrl(url, 1163)).toBe(false);
  });

  test.each([0, -1, 1.5, Number.NaN, Infinity, '', '0', '01', '1e3', ' 1163', '1163 ', '+1163', '9999999999999'])(
    'rejects invalid changer id %p',
    (id) => {
      expect(isExchangerClickUrl('https://www.bestchange.ru/click.php?id=1163', id as number)).toBe(false);
    },
  );

  test('non-string url is rejected', () => {
    expect(isExchangerClickUrl(undefined, 1)).toBe(false);
    expect(isExchangerClickUrl({ href: 'https://www.bestchange.ru/click.php?id=1' }, 1)).toBe(false);
  });
});

describe('pickExchangerClickUrl', () => {
  test('prefers ru, falls back to en, validates each', () => {
    expect(
      pickExchangerClickUrl({ ru: 'https://www.bestchange.ru/click.php?id=7', en: 'https://www.bestchange.com/click.php?id=7' }, 7),
    ).toBe('https://www.bestchange.ru/click.php?id=7');
    expect(pickExchangerClickUrl({ ru: 'https://evil.com/click.php?id=7', en: 'https://www.bestchange.com/click.php?id=7' }, 7)).toBe(
      'https://www.bestchange.com/click.php?id=7',
    );
    expect(pickExchangerClickUrl({ ru: 'https://www.bestchange.ru/click.php?id=8' }, 7)).toBeNull();
    expect(pickExchangerClickUrl({ de: 'https://www.bestchange.ru/click.php?id=7' }, 7)).toBeNull();
    expect(pickExchangerClickUrl(null, 7)).toBeNull();
    expect(pickExchangerClickUrl(['https://www.bestchange.ru/click.php?id=7'], 7)).toBeNull();
    expect(pickExchangerClickUrl('https://www.bestchange.ru/click.php?id=7', 7)).toBeNull();
  });

  test('ignores inherited properties', () => {
    const proto = { ru: 'https://www.bestchange.ru/click.php?id=7' };
    expect(pickExchangerClickUrl(Object.create(proto), 7)).toBeNull();
  });
});

describe('normalizePartnerId', () => {
  test('accepts 1-12 digits', () => {
    expect(normalizePartnerId('12345')).toBe('12345');
    expect(normalizePartnerId(12345)).toBe('12345');
    expect(normalizePartnerId('123456789012')).toBe('123456789012');
  });
  test.each(['', '1234567890123', '12a', ' 1', '1 ', '-1', '1.5', '١٢', null, undefined, -1, 1.5, {}])('rejects %p', (v) => {
    expect(normalizePartnerId(v)).toBeNull();
  });
});

describe('buildDirectionUrl / isDirectionUrl', () => {
  test('builds the documented direction page', () => {
    expect(buildDirectionUrl('sbp', 'tether-trc20')).toBe('https://www.bestchange.ru/sbp-to-tether-trc20.html');
    expect(buildDirectionUrl('visa-mastercard-rub', 'bitcoin', null)).toBe('https://www.bestchange.ru/visa-mastercard-rub-to-bitcoin.html');
    expect(buildDirectionUrl('sbp', 'tron', '')).toBe('https://www.bestchange.ru/sbp-to-tron.html');
  });

  test('appends ?p= for a valid partner id only', () => {
    expect(buildDirectionUrl('sberbank', 'bitcoin', '4242')).toBe('https://www.bestchange.ru/sberbank-to-bitcoin.html?p=4242');
    expect(buildDirectionUrl('sberbank', 'bitcoin', 4242)).toBe('https://www.bestchange.ru/sberbank-to-bitcoin.html?p=4242');
    expect(buildDirectionUrl('sberbank', 'bitcoin', 'abc')).toBeNull();
    expect(buildDirectionUrl('sberbank', 'bitcoin', '1&x=2')).toBeNull();
  });

  test.each([
    ['', 'bitcoin'],
    ['SBP', 'bitcoin'],
    ['-sbp', 'bitcoin'],
    ['sbp/../x', 'bitcoin'],
    ['sbp', 'bitcoin.html?x='],
    ['sbp', 'bit coin'],
    ['sbp', 'a'.repeat(64)],
    ['sbp', 'тинькофф'],
  ])('rejects bad urlnames %p -> %p', (from, to) => {
    expect(buildDirectionUrl(from, to)).toBeNull();
  });

  test('accepts direction pages on all BestChange hosts', () => {
    expect(isDirectionUrl('https://www.bestchange.ru/sbp-to-tether-trc20.html')).toBe(true);
    expect(isDirectionUrl('https://bestchange.com/sbp-to-tether-trc20.html?p=1')).toBe(true);
    expect(isDirectionUrl('https://www.bestchange.ru/tether-trc20-to-vtb.html')).toBe(true);
  });

  test.each([
    ['other param', 'https://www.bestchange.ru/sbp-to-bitcoin.html?x=1'],
    ['p plus other', 'https://www.bestchange.ru/sbp-to-bitcoin.html?p=1&x=2'],
    ['empty p', 'https://www.bestchange.ru/sbp-to-bitcoin.html?p='],
    ['non-digit p', 'https://www.bestchange.ru/sbp-to-bitcoin.html?p=abc'],
    ['empty query', 'https://www.bestchange.ru/sbp-to-bitcoin.html?'],
    ['fragment', 'https://www.bestchange.ru/sbp-to-bitcoin.html#x'],
    ['no -to-', 'https://www.bestchange.ru/sbp-bitcoin.html'],
    ['nested path', 'https://www.bestchange.ru/x/sbp-to-bitcoin.html'],
    ['wrong ext', 'https://www.bestchange.ru/sbp-to-bitcoin.htm'],
    ['encoded slash', 'https://www.bestchange.ru/sbp%2F-to-bitcoin.html'],
    ['lookalike host', 'https://www.bestchange.ru.evil.com/sbp-to-bitcoin.html'],
    ['http', 'http://www.bestchange.ru/sbp-to-bitcoin.html'],
    ['javascript', 'javascript:alert(1)'],
    ['click link', 'https://www.bestchange.ru/click.php?id=1'],
    ['empty sides', 'https://www.bestchange.ru/-to-.html'],
  ])('isDirectionUrl rejects %s', (_label, url) => {
    expect(isDirectionUrl(url)).toBe(false);
  });

  test('parseDirectionPath handles urlnames containing "-to-"', () => {
    expect(parseDirectionPath('/sbp-to-tether-trc20.html')).toEqual({ from: 'sbp', to: 'tether-trc20' });
    expect(parseDirectionPath('/x-to-y-to-z.html')).toEqual({ from: 'x', to: 'y-to-z' });
    expect(parseDirectionPath('/sbp.html')).toBeNull();
    expect(parseDirectionPath('sbp-to-x.html')).toBeNull();
  });
});
