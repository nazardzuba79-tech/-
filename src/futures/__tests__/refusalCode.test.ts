import { futuresRefusalBody, futuresRefusalCode } from '../refusalCode';

describe('known engine refusals carry a code the client can translate', () => {
  it('names a thin book and a self-match', () => {
    expect(futuresRefusalCode(new Error('Insufficient market liquidity for requested quantity'))).toBe('INSUFFICIENT_LIQUIDITY');
    expect(futuresRefusalCode(new Error('Futures self-match is not allowed'))).toBe('SELF_MATCH');
  });

  it('gives an unknown refusal no code, so the client keeps its generic line rather than guessing', () => {
    for (const message of ['Invalid staged Futures match', 'reduceOnly fill exceeds the current opposing position', 'Insufficient USDT margin balance or reserved funds', '']) {
      expect(futuresRefusalCode(new Error(message))).toBeUndefined();
    }
    expect(futuresRefusalCode(null)).toBeUndefined();
    expect(futuresRefusalCode({ message: 'Insufficient market liquidity for requested quantity' })).toBeUndefined();
  });

  it('keeps the sentence byte-for-byte and adds the code beside it', () => {
    expect(futuresRefusalBody(new Error('Insufficient market liquidity for requested quantity')))
      .toEqual({ error: 'Insufficient market liquidity for requested quantity', code: 'INSUFFICIENT_LIQUIDITY' });
    expect(futuresRefusalBody(new Error('Something else'))).toEqual({ error: 'Something else' });
  });
});
