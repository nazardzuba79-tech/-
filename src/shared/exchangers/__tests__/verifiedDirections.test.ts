import { RECEIVE_PAIRS, RUB_METHODS } from '../catalog';
import { buildDirectionUrl, isDirectionUrl } from '../links';
import { VERIFIED_DIRECTIONS, VERIFIED_DIRECTIONS_CHECKED_ON, isVerifiedDirection } from '../verifiedDirections';

// Issue #694: without server data the page may only link to BestChange direction pages that were checked to exist.
describe('verified BestChange directions (links mode)', () => {
  const methods = RUB_METHODS.map((m) => m.urlname);
  const targets = new Set(RECEIVE_PAIRS.flatMap((p) => p.match.urlnames));

  test('every entry is a catalogue method and a catalogue receive urlname, with no duplicates', () => {
    expect(VERIFIED_DIRECTIONS_CHECKED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const [from, tos] of Object.entries(VERIFIED_DIRECTIONS)) {
      expect(methods).toContain(from);
      expect(tos.length).toBeGreaterThan(0);
      expect(new Set(tos).size).toBe(tos.length);
      for (const to of tos) expect(targets.has(to)).toBe(true);
    }
  });

  test('every listed direction builds a strictly valid BestChange link, without a partner id', () => {
    for (const [from, tos] of Object.entries(VERIFIED_DIRECTIONS)) {
      for (const to of tos) {
        const url = buildDirectionUrl(from, to);
        expect(url).toBe(`https://www.bestchange.ru/${from}-to-${to}.html`);
        expect(isDirectionUrl(url!)).toBe(true);
      }
    }
  });

  test('unknown, unchecked or look-alike directions are not verified', () => {
    expect(isVerifiedDirection('sbp', 'tether-trc20')).toBe(true);
    expect(isVerifiedDirection('sbp', 'usd-coin-erc20')).toBe(false); // answered 301: not offered
    expect(isVerifiedDirection('mir', 'tether-trc20')).toBe(false);   // answered 301: not offered
    expect(isVerifiedDirection('sbp', 'toncoin')).toBe(false);
    expect(isVerifiedDirection('toString', 'tether-trc20')).toBe(false);
    expect(isVerifiedDirection('__proto__', 'tether-trc20')).toBe(false);
    expect(isVerifiedDirection('tether-trc20', 'sbp')).toBe(false);
  });

  test('TRX (native) and USDT TRC-20 stay different directions', () => {
    expect(isVerifiedDirection('sbp', 'tron')).toBe(true);
    expect(isVerifiedDirection('sbp', 'tether-trc20')).toBe(true);
    expect(buildDirectionUrl('sbp', 'tron')).not.toBe(buildDirectionUrl('sbp', 'tether-trc20'));
  });
});
