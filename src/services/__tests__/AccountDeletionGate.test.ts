import { AccountDeletionGate } from '../AccountDeletionGate';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe('account deletion book coordination', () => {
  it('drains a service through post-commit publication before deletion and blocks later trades', async () => {
    const gate = new AccountDeletionGate(), trace: string[] = [];
    let publish!: () => void;
    const service = gate.guard({
      async internal() { trace.push('internal'); },
      async placeOrder() {
        await this.internal();
        trace.push('commit');
        await new Promise<void>(resolve => { publish = resolve; });
        trace.push('publish');
      },
    }, ['placeOrder', 'internal']);
    const order = service.placeOrder();
    await tick();
    const deletion = gate.run(true, async () => { trace.push('delete'); throw new Error('rollback'); });
    const caught = expect(deletion).rejects.toThrow('rollback');
    const later = gate.run(false, async () => { trace.push('later'); });
    await tick();
    expect(trace).toEqual(['internal', 'commit']);
    publish();
    await Promise.all([order, caught, later]);
    expect(trace).toEqual(['internal', 'commit', 'publish', 'delete', 'later']);
  });

  it('does not serialize normal trades but refuses new work after an unknown deletion outcome', async () => {
    const gate = new AccountDeletionGate();
    let release!: () => void;
    const active = gate.run(false, () => new Promise<void>(r => { release = r; }));
    await tick();
    await expect(gate.run(false, async () => 'concurrent')).resolves.toBe('concurrent');
    release(); await active;
    await gate.run(true, async () => { gate.haltUntilRestart(); });
    const work = jest.fn();
    await expect(gate.run(false, work)).rejects.toThrow('reconciliation');
    await expect(gate.run(true, work)).rejects.toThrow('reconciliation');
    expect(work).not.toHaveBeenCalled();
  });
});
