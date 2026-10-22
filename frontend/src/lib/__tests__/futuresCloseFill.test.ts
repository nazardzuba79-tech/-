import { closeEventIds, closeFillFromEvents, closeFillFromFills, closeFillFromResponse } from '../futuresCloseFill';

/**
 * The «Позиция закрыта» card states what the close filled: the summed
 * quantity and its volume-weighted price, exactly as the engine reported
 * the fills. Nothing usable means no price line, never a guess.
 */
describe('close fill', () => {
  test('volume-weighted price and summed quantity, decimal exact', () => {
    // (84037.5 × 0.4 + 84035 × 0.1) / 0.5 = 84037
    expect(closeFillFromFills([{ price: '84037.5', quantity: '0.4' }, { price: '84035', quantity: '0.1' }]))
      .toEqual({ quantity: '0.5', averagePrice: '84037' });
    expect(closeFillFromFills([{ price: '0.1', quantity: '3' }])).toEqual({ quantity: '3', averagePrice: '0.1' });
  });
  test('the real engine answer: trades of the close response', () => {
    expect(closeFillFromResponse({ order: { id: 'o1' }, trades: [{ price: '100', quantity: '1' }, { price: '102', quantity: '1' }] }))
      .toEqual({ quantity: '2', averagePrice: '101' });
    expect(closeFillFromResponse({ order: { id: 'o1' } })).toBeUndefined();
    expect(closeFillFromResponse(undefined)).toBeUndefined();
    expect(closeFillFromResponse({ trades: [] })).toBeUndefined();
  });
  test('unusable fills are skipped; nothing usable gives no fill', () => {
    expect(closeFillFromFills([{ price: null, quantity: '1' }, { price: 'abc', quantity: '1' }, { price: '5', quantity: '0' }])).toBeUndefined();
    expect(closeFillFromFills([{ price: '5', quantity: '-2' }])).toEqual({ quantity: '2', averagePrice: '5' });
  });
  test('the simulation journal: only CLOSE events of this position that are new', () => {
    const e = (id: string, positionId: string, kind: string, price: string | null, quantity: string) => ({ id, kind, positionId, price, quantity });
    const before = [e('a', 'p1', 'CLOSE', '10', '1'), e('b', 'p2', 'CLOSE', '20', '1'), e('c', 'p1', 'OPEN', '9', '2')];
    const seen = closeEventIds(before, 'p1');
    expect([...seen]).toEqual(['a']);
    const after = [...before, e('d', 'p1', 'CLOSE', '12', '1'), e('f', 'p1', 'FUNDING', null, '0'), e('g', 'p2', 'CLOSE', '30', '1')];
    expect(closeFillFromEvents(after, 'p1', seen)).toEqual({ quantity: '1', averagePrice: '12' });
    expect(closeFillFromEvents(before, 'p1', seen)).toBeUndefined();
  });
});
