import express from 'express';
import request from 'supertest';
import { nativeDemoRoutes } from '../native/routes';
import { DemoEngineError } from '../native/engine';
import { ContractRuleError } from '../math';
import type { NativeDemoService } from '../native/service';
import type { OwnerSession } from '../serviceTypes';

/**
 * A refusal has to carry a reason the client can localize, and a sentence
 * that names the cause it actually had.
 *
 * The defect: an order the account could not afford came back reading as a
 * market-quantity limit. Margin and contract size are separate failures and
 * must stay separate all the way out of the router — the `code` for the
 * client's own wording, the `error` sentence as the last resort.
 */

const session = { userId: 'owner', sessionId: 's1' } as unknown as OwnerSession;

function app(throwing: unknown) {
  const service = {
    state: async () => { throw throwing; },
    command: async () => { throw throwing; },
  } as unknown as NativeDemoService;
  const server = express();
  server.use(express.json());
  server.use('/native', nativeDemoRoutes(service, () => session));
  return server;
}
const state = (throwing: unknown) => request(app(throwing)).get('/native/state');

describe('native engine refusals reaching the client', () => {
  it('reports a margin shortfall as a margin shortfall', async () => {
    const res = await state(new DemoEngineError('INSUFFICIENT_DEMO_MARGIN'));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_DEMO_MARGIN');
    // The owner's own wording for this refusal. It names the money, in the
    // second person, so the trader reads what is wrong with THEIR order
    // rather than a status about the system.
    expect(res.body.error).toBe('Вам не хватает средств для размещения этого ордера.');
    // Not a size limit, and not the word "demo" in front of the owner.
    expect(res.body.error).not.toMatch(/количеств|MARKET|демо/i);
  });

  it('keeps the fill-time shortfall distinct from the placement-time one', async () => {
    const fill = await state(new DemoEngineError('INSUFFICIENT_FILL_MARGIN'));
    const place = await state(new DemoEngineError('INSUFFICIENT_DEMO_MARGIN'));
    expect(fill.body.code).not.toBe(place.body.code);
    expect(fill.body.error).not.toBe(place.body.error);
  });

  it('names the contract limit it broke, with the value that limit allows', async () => {
    const res = await state(new ContractRuleError('INVALID_ORDER_SIZE', {
      limit: 'maxMarketOrderQty', allowed: '120', actual: '500',
    }));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'INVALID_ORDER_SIZE', limit: 'maxMarketOrderQty', allowed: '120', actual: '500',
    });
    expect(res.body.error).toContain('Максимальное количество рыночного ордера');
    expect(res.body.error).toContain('120');
    expect(res.body.error).toContain('500');
    // A size refusal is not dressed up as a funding problem either.
    expect(res.body.error).not.toMatch(/средств/i);
  });

  it('gives every size rule its own limit name rather than one shared sentence', async () => {
    const limits = ['minOrderQty', 'maxOrderQty', 'maxMarketOrderQty', 'minNotionalValue', 'qtyStep'];
    const sentences = new Set<string>();
    for (const limit of limits) {
      const res = await state(new ContractRuleError('INVALID_ORDER_SIZE', { limit, allowed: '1', actual: '2' }));
      expect(res.body.limit).toBe(limit);
      sentences.add(res.body.error);
    }
    expect(sentences.size).toBe(limits.length);
  });

  it('never answers with a bare internal code, and logs the ones it has no wording for', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await state(new DemoEngineError('SOME_CODE_NOBODY_MAPPED_YET'));
      expect(res.status).toBe(409);
      // The code travels for the client and the logs; the sentence does not
      // become one.
      expect(res.body.code).toBe('SOME_CODE_NOBODY_MAPPED_YET');
      expect(res.body.error).toBe('Операция не выполнена. Проверьте параметры ордера.');
      expect(res.body.error).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
      expect(warn).toHaveBeenCalledWith('[native] unmapped engine error', 'SOME_CODE_NOBODY_MAPPED_YET');
    } finally {
      warn.mockRestore();
    }
  });

  it('carries a code on every refusal, so the client can say why in its own language', async () => {
    for (const thrown of [
      new DemoEngineError('CLOSE_EXCEEDS_POSITION'),
      new DemoEngineError('LIMIT_PRICE_REQUIRED'),
      new ContractRuleError('INVALID_QUANTITY_STEP', { limit: 'qtyStep', allowed: '0.01', actual: '0.015' }),
    ]) {
      const res = await state(thrown);
      expect(typeof res.body.code).toBe('string');
      expect(res.body.code.length).toBeGreaterThan(0);
    }
  });
});
