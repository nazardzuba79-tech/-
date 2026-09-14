import { hash } from '../store';

describe('private command request identity', () => {
  test('equivalent nested object keys preserve idempotence after JSON storage reorders keys', () => {
    const request = { id: 'position', marginDelta: '10', protection: { stopLoss: '90', takeProfit: '120' }, events: [{ id: 'a', amount: '1' }, { id: 'b', amount: '2' }] };
    const persisted = { events: [{ amount: '1', id: 'a' }, { amount: '2', id: 'b' }], protection: { takeProfit: '120', stopLoss: '90' }, marginDelta: '10', id: 'position' };
    expect(hash(request)).toBe(hash(persisted));
    expect(hash({ ...request, unused: undefined })).toBe(hash(request));
  });
  test('changed money, event ordering and null remain different commands', () => {
    const request = { amount: '10', events: ['a', 'b'] };
    expect(hash({ ...request, amount: '11' })).not.toBe(hash(request));
    expect(hash({ ...request, events: ['b', 'a'] })).not.toBe(hash(request));
    expect(hash({ ...request, optional: null })).not.toBe(hash(request));
  });
});
