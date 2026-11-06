import { orderDecimal, ticketQuantity, ticketTotal } from '../../../../frontend/src/lib/orderTicketNumbers';
describe('order draft numbers (no settlement changes)', () => {
  test.each([['2','2'], ['2,',null], ['2,5','2.5'], ['2.50','2.50'], ['',null], ['1e3',null], ['-1',null], ['1,2.3',null]])('complete decimal %s -> %s', (raw, expected) => expect(orderDecimal(raw!)).toBe(expected));
  test('amount estimates do not round to currency display precision', () => {
    expect(ticketTotal('2.50', 0.014)).toBe('0.035');
    expect(ticketQuantity('2,5', 0.014)).toBe('178.57142857');
    expect(ticketTotal('0', 0.014)).toBe('0');
  });
  test.each([0,NaN,Infinity,-1])('missing/invalid price %s invents no quantity', price => {
    expect(ticketQuantity('2,5', price)).toBe(''); expect(ticketTotal('2', price)).toBe('');
  });
});
