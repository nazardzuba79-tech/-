import { setup, actor, key } from '../../../private-trading/native/testing/liveFixture';
import { futuresCopyCommitGuard, FuturesCopyGuardError } from '../FuturesCopyCommitGuard';

const limits = (action: 'OPEN' | 'CLOSE', positionId?: string) => ({
  action, symbol: 'BTCUSDT', ...(positionId ? { positionId } : {}),
  requestedQuantity: '0.1', sourcePrice: '50000',
  maxDeviationBps: '100', maxFillUsdt: '5100',
  maxTotalExposureUsdt: '7000', maxLeverage: '5',
});
const command = (keyValue: string) => ({
  kind: 'OPEN' as const, symbol: 'BTCUSDT', side: 'LONG' as const,
  type: 'MARKET' as const, quantity: '0.1', leverage: '2',
  marginType: 'CROSS' as const, idempotencyKey: keyValue,
});
describe('Native Demo internal, atomic copy replay commit guard', () => {
  test('opens with confirmed book fill; duplicate request is idempotent', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    const id = key();
    const v = await f.service.command(actor, command(id), { commitGuard: futuresCopyCommitGuard(limits('OPEN')) });
    expect(v.positions).toHaveLength(1);
    expect(v.events.filter(e => e.kind === 'OPEN')).toHaveLength(1);
    expect(v.revision).toBe(2);
    const again = await f.service.command(actor, command(id), { commitGuard: futuresCopyCommitGuard(limits('OPEN')) });
    expect(again.revision).toBe(v.revision); expect(f.repo.row?.revision).toBe(2);
  });
  test('slippage refusal rolls back the entire native financial state and journal', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    const before = structuredClone(f.repo.row);
    await expect(f.service.command(actor, command(key()), {
      commitGuard: futuresCopyCommitGuard({ ...limits('OPEN'), sourcePrice: '1000', maxDeviationBps: '10' }),
    })).rejects.toMatchObject({ code: 'COPY_SLIPPAGE_EXCEEDED' });
    expect(f.repo.row).toEqual(before);
  });
  test('per-fill notional refusal commits neither order nor demo P&L', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    const before = structuredClone(f.repo.row);
    await expect(f.service.command(actor, command(key()), {
      commitGuard: futuresCopyCommitGuard({ ...limits('OPEN'), maxFillUsdt: '100' }),
    })).rejects.toMatchObject({ code: 'COPY_FILL_NOTIONAL_EXCEEDED' });
    expect(f.repo.row).toEqual(before);
  });
  test('portfolio exposure and leverage caps refuse without a partial commit', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    const before = structuredClone(f.repo.row);
    await expect(f.service.command(actor, command(key()), {
      commitGuard: futuresCopyCommitGuard({ ...limits('OPEN'), maxTotalExposureUsdt: '1000' }),
    })).rejects.toMatchObject({ code: 'COPY_TOTAL_EXPOSURE_EXCEEDED' });
    expect(f.repo.row).toEqual(before);
    await expect(f.service.command(actor, command(key()), {
      commitGuard: futuresCopyCommitGuard({ ...limits('OPEN'), maxLeverage: '1' }),
    })).rejects.toMatchObject({ code: 'COPY_LEVERAGE_EXCEEDED' });
    expect(f.repo.row).toEqual(before);
  });
  test('no executable depth never commits a resting fake market order', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    f.market.asks = [];
    const before = structuredClone(f.repo.row);
    await expect(f.service.command(actor, command(key()), {
      commitGuard: futuresCopyCommitGuard(limits('OPEN')),
    })).rejects.toMatchObject({ code: 'market_data_invalid' });
    expect(f.repo.row).toEqual(before);
  });
  test('cannot add risk into a manually opened position', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    await f.service.command(actor, command(key()));
    const before = structuredClone(f.repo.row);
    await expect(f.service.command(actor, command(key()), {
      commitGuard: futuresCopyCommitGuard(limits('OPEN')),
    })).rejects.toMatchObject({ code: 'COPY_FOLLOWER_POSITION_NOT_ISOLATED' });
    expect(f.repo.row).toEqual(before);
  });
  test('resting manual LIMIT orders block new copied exposure', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT',
      side: 'LONG', type: 'LIMIT', price: '1000', quantity: '0.1',
      leverage: '2', marginType: 'CROSS', idempotencyKey: key() });
    expect(f.repo.row!.snapshot.orders.some(o => o.status === 'OPEN')).toBe(true);
    const before = structuredClone(f.repo.row);
    await expect(f.service.command(actor, command(key()), {
      commitGuard: futuresCopyCommitGuard(limits('OPEN')),
    })).rejects.toMatchObject({ code: 'COPY_FOLLOWER_POSITION_NOT_ISOLATED' });
    expect(f.repo.row).toEqual(before);
  });
  test('one valid copied position can be partially closed with the same guard', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    const open = await f.service.command(actor, command(key()), {
      commitGuard: futuresCopyCommitGuard(limits('OPEN')),
    });
    const positionId = open.positions[0].id;
    f.step();
    const close = await f.service.command(actor, { kind: 'CLOSE', positionId,
      quantity: '0.1', idempotencyKey: key() }, {
      commitGuard: futuresCopyCommitGuard({ ...limits('CLOSE', positionId), maxFillUsdt: '5100' }),
    });
    expect(close.positions).toHaveLength(0);
    expect(close.events.some(e => e.kind === 'CLOSE' && e.positionId === positionId)).toBe(true);
  });
  test('protective partial CLOSE remains possible when price/exposure/leverage exceed entry-only caps', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    const opened = await f.service.command(actor, command(key()), {
      commitGuard: futuresCopyCommitGuard(limits('OPEN')),
    });
    const positionId = opened.positions[0].id;
    f.step();
    const close = { kind: 'CLOSE' as const, positionId, quantity: '0.05', idempotencyKey: key() };
    // With the previous guard, this valid risk-reducing exit failed at
    // COPY_FILL_NOTIONAL_EXCEEDED (or leverage/exposure on partial close).
    const reduced = await f.service.command(actor, close, {
      commitGuard: futuresCopyCommitGuard({
        ...limits('CLOSE', positionId), requestedQuantity: '0.05',
        maxFillUsdt: '100', maxTotalExposureUsdt: '1000', maxLeverage: '1',
        sourcePrice: '1', maxDeviationBps: '0', riskReducingExit: true,
      }),
    });
    expect(reduced.positions).toHaveLength(1);
    expect(Number(reduced.positions[0].quantity)).toBeCloseTo(0.05);
    expect(reduced.events.some(e => e.kind === 'CLOSE' && e.positionId === positionId)).toBe(true);
    // A non-protective CLOSE still requires source-price/slippage admission.
    const before = structuredClone(f.repo.row);
    await expect(f.service.command(actor, {
      kind: 'CLOSE', positionId, quantity: '0.05', idempotencyKey: key(),
    }, {
      commitGuard: futuresCopyCommitGuard({
        ...limits('CLOSE', positionId), requestedQuantity: '0.05',
        sourcePrice: '1', maxDeviationBps: '0',
      }),
    })).rejects.toMatchObject({ code: 'COPY_SLIPPAGE_EXCEEDED' });
    expect(f.repo.row).toEqual(before);
  });
  test('disabled copy gate blocks a command before NativeDemo commit', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    const before = structuredClone(f.repo.row);
    await expect(f.service.command(actor, command(key()), {
      commitGuard: futuresCopyCommitGuard({ ...limits('OPEN'), stillEnabled: () => false }),
    })).rejects.toMatchObject({ code: 'COPY_EXECUTION_DISABLED' });
    expect(f.repo.row).toEqual(before);
  });
});
