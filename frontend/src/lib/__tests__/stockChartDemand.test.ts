import { StockChartDemand } from '../../pages/stocks/global/chartDemand';

describe('visible Stocks demand', () => {
  const setup = () => { const send = jest.fn().mockResolvedValue({}); let n = 0;
    return { send, demand: new StockChartDemand(send, () => `visit-${++n}`) }; };
  test('closing aborts the pending read, releases once, and never posts a trade', () => {
    const { send, demand } = setup(), visit = demand.open('BYBIT:AAPLXUSDT', { Authorization: 'Bearer fixture' });
    visit.accept('csrf'); demand.close(); demand.close();
    expect(visit.signal.aborted).toBe(true); expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toMatchObject({ method: 'DELETE', credentials: 'omit', keepalive: true,
      headers: { Authorization: 'Bearer fixture', 'X-Stocks-Token': 'csrf', 'X-Stocks-View': 'visit-1' } });
  });
  test('switch and logout release only the old authenticated visit', () => {
    const { send, demand } = setup();
    demand.open('A', { Authorization: 'Bearer alice' }).accept('alice-csrf');
    const bob = demand.open('B', { Authorization: 'Bearer bob' });
    expect(send.mock.calls[0][1].headers.Authorization).toBe('Bearer alice');
    expect(bob.headers['X-Stocks-View']).toBe('visit-2');
    demand.close(); expect(send).toHaveBeenCalledTimes(1); // No unacknowledged/anonymous release.
  });
  test('late response from a closed visit cannot replace the next CSRF credential', () => {
    const { send, demand } = setup(), old = demand.open('A', {});
    demand.close(); const current = demand.open('A', {}); old.accept('obsolete'); current.accept('current');
    demand.close(); expect(send.mock.calls[0][1].headers['X-Stocks-Token']).toBe('current');
    expect(send.mock.calls[0][1].headers['X-Stocks-View']).toBe('visit-2');
  });
});
