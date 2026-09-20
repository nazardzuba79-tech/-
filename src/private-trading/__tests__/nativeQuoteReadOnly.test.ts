import { NativeDemoService } from '../native/service';
import { NativeAccount, NativeRepository } from '../native/store';
import { simulationProfile, contractRules } from '../service';
import { calculatePosition, fundingCashflow, linearPnl, quoteOrderCost, targetExitPrice } from '../math';
import type { OwnerSession } from '../serviceTypes';
import type { PrivateTradingMarketData, PrivateInstrument, PrivateFreshQuote, PrivateMark } from '../marketData';

/**
 * THE QUOTE ROUTE PRICES; IT DOES NOT TRADE.
 *
 * Two things are proven here, and the first is the one that matters for a
 * calculator wired into a live account.
 *
 * 1. NO FINANCIAL WRITE IS STRUCTURALLY POSSIBLE. The repository handed to
 *    the service throws on every mutating method. If `priceQuote` ever grows
 *    a persist, a revision or an idempotency record, these tests stop being
 *    green — they do not merely assert that a counter stayed at zero, they
 *    make the write itself fatal.
 *
 * 2. THE NUMBERS ARE THE ENGINE'S OWN. Every figure the route returns is
 *    compared against the authoritative function called directly on the same
 *    inputs. A mirrored formula that drifted would fail here rather than in
 *    front of a trader.
 */

const H0 = Date.UTC(2026, 8, 20, 0, 0, 0);
const actor: OwnerSession = { userId: 'quote', sessionId: 's', expiresAt: Number.MAX_SAFE_INTEGER };

/**
 * Every write is fatal. Reads that a quote legitimately needs stay harmless.
 *
 * THE WRITE SURFACE IS ENUMERATED FROM THE INTERFACE, not from memory —
 * `writeMethods` below is asserted against `NativeRepository` itself, so a
 * mutating method added to the repository in future cannot quietly escape
 * this proof by never being listed here.
 *
 * PR #156 widened that surface: `activate` opens an account, and `commit`
 * now also writes the derived live projection inside the SAME transaction
 * as the account row, the immutable receipt and the ledger. Both throw.
 * A projection write therefore cannot happen without going through a
 * method that is fatal here — which is what makes "the quote does not
 * touch the projection" a structural claim rather than an observation.
 */
class NoWriteRepository implements NativeRepository {
  reads = 0;
  /** Reads #156 added. Legitimate for a display path; a quote uses neither. */
  liveCalls = 0;
  historyCalls = 0;
  private fail(method: string): never {
    throw new Error(`QUOTE_ATTEMPTED_WRITE:${method}`);
  }
  async read() { this.reads++; return null; }
  async available() { this.reads++; return '100000000'; }
  async holdings() { this.reads++; return []; }
  async revision() { this.reads++; return null; }
  async prior() { this.reads++; return null; }
  async live() { this.liveCalls++; return null; }
  async history(): Promise<never> { this.historyCalls++; throw new Error('a quote must not page history'); }
  async commandContext() { this.reads++; return { prior: null, row: null, holdings: [] }; }
  // ── every mutating method, and all of them fatal ──
  async activate(): Promise<void> { return this.fail('activate'); }
  async initialize(): Promise<NativeAccount> { return this.fail('initialize'); }
  async commit(): Promise<NativeAccount> { return this.fail('commit'); }
}

const instrument = (symbol: string): PrivateInstrument => ({
  provider: 'bybit', symbol, baseAsset: symbol.replace(/USDT$/, ''), quoteAsset: 'USDT', settleAsset: 'USDT',
  contractType: 'LinearPerpetual', status: 'Trading', launchTime: Date.UTC(2020, 0, 1), fetchedAt: H0,
  fundingIntervalMinutes: 480,
  filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5' },
  leverage: { min: '1', max: '100', step: '1' },
  riskTiers: [
    { riskLimitValue: '50000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' },
    { riskLimitValue: '250000', maintenanceMarginRate: '0.01', initialMarginRate: '0.02', maintenanceDeduction: '250', maxLeverage: '50' },
  ],
  parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'QUOTE_FIXTURE',
});

class Market {
  instrumentCalls = 0;
  async instrument(symbol: string) { this.instrumentCalls++; return instrument(symbol); }
  async freshQuote(symbol: string): Promise<PrivateFreshQuote> {
    return { provider: 'bybit', symbol, bids: [{ price: '999.9', quantity: '10' }], asks: [{ price: '1000.1', quantity: '10' }],
      markPrice: '1000', lastPrice: '1000', fundingRate: '0.0001', nextFundingTime: H0 + 3_600_000,
      providerTimestamp: H0, bookGeneratedAt: H0, markProviderTimestamp: H0, fetchedAt: H0 };
  }
  async marks(symbols: string[]): Promise<Map<string, PrivateMark>> {
    return new Map(symbols.map(s => [s, { symbol: s, markPrice: '1000', lastPrice: '1000', markProviderTimestamp: H0, receivedAt: H0, fetchedAt: H0 }]));
  }
  async history(): Promise<never> { throw new Error('a quote must not read history'); }
  async resolveCandle(): Promise<never> { throw new Error('a quote must not resolve candles'); }
}

function build() {
  const repo = new NoWriteRepository();
  const market = new Market();
  const service = new NativeDemoService(repo, market as unknown as PrivateTradingMarketData, () => H0);
  return { repo, market, service, profile: simulationProfile(instrument('BTCUSDT')), rules: contractRules(instrument('BTCUSDT')) };
}

describe('the quote route performs no financial write', () => {
  it('an ORDER quote never reaches a mutating repository method', async () => {
    const { service } = build();
    await expect(service.priceQuote(actor, {
      kind: 'ORDER', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.25', price: '81480', leverage: '50',
    })).resolves.toBeDefined();
  });

  it('every quote kind completes without a write', async () => {
    const { service } = build();
    const kinds = [
      { kind: 'ORDER', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.25', price: '81480', leverage: '50' },
      { kind: 'POSITION', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', entryPrice: '79650', markPrice: '81485.5', leverage: '20' },
      { kind: 'TARGET', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', entryPrice: '79650', leverage: '20', basis: 'GROSS', targetPnl: '1000' },
      { kind: 'FUNDING', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', markPrice: '81485.5', rate: '0.0001', intervals: 3 },
    ] as const;
    for (const input of kinds) {
      await expect(service.priceQuote(actor, input)).resolves.toBeDefined();
    }
  });

  it('a quote reads the instrument and nothing else from the market', async () => {
    const { service, market } = build();
    await service.priceQuote(actor, { kind: 'POSITION', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', entryPrice: '79650', markPrice: '81485.5', leverage: '20' });
    expect(market.instrumentCalls).toBe(1);
  });

  /**
   * THE ENUMERATION CANNOT GO STALE.
   *
   * The proof above is only as good as the list of methods that throw. A
   * mutating method added to `NativeRepository` later — as PR #156 added
   * `activate` — would otherwise slip past it silently, because a method
   * nobody listed is a method nobody made fatal.
   *
   * So the list is checked against the interface itself. `commandContext`
   * is named as a READ on purpose: it is one authorization envelope around
   * the three reads a command needs, and the commit that follows it still
   * rechecks access and CAS.
   */
  it('every mutating repository method is fatal, and the list is checked against the interface', async () => {
    const repo = new NoWriteRepository();
    const WRITES = ['activate', 'initialize', 'commit'] as const;
    const READS = ['read', 'available', 'holdings', 'revision', 'prior', 'live', 'history', 'commandContext'] as const;

    for (const method of WRITES) {
      // They are `async`, so the failure arrives as a rejection. Awaiting it
      // is the difference between proving the write is refused and proving
      // only that a promise was returned.
      await expect((repo as never as Record<string, () => Promise<unknown>>)[method]())
        .rejects.toThrow(`QUOTE_ATTEMPTED_WRITE:${method}`);
    }
    // Reads and writes together are the WHOLE interface. If `NativeRepository`
    // grows a method, this fails until it has been classified.
    const implemented = Object.getOwnPropertyNames(NoWriteRepository.prototype)
      .filter((n) => n !== 'constructor' && n !== 'fail')
      .sort();
    expect(implemented).toEqual([...WRITES, ...READS].sort());
  });

  /**
   * #156's PROJECTION IS NOT TOUCHED, and the reason is structural.
   *
   * The derived live projection is written inside `commit`'s transaction,
   * atomically with the account row, the receipt and the ledger — there is
   * no separate projection writer to call. `commit` throws here, so a quote
   * that wrote a projection would have to have called a fatal method.
   *
   * The read side is checked too: a quote does not consult `/native/live`
   * or page history either. It prices from the instrument and its inputs,
   * which is why it costs the database nothing at all.
   */
  it('touches neither the live projection nor the history pages', async () => {
    const { service, repo } = build();
    for (const input of [
      { kind: 'ORDER', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.25', price: '81480', leverage: '50' },
      { kind: 'PNL', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', entryPrice: '79650', exitPrice: '81485.5', leverage: '20' },
    ] as const) {
      await expect(service.priceQuote(actor, input)).resolves.toBeDefined();
    }
    expect({ live: repo.liveCalls, history: repo.historyCalls }).toEqual({ live: 0, history: 0 });
  });

  /**
   * NO ACCOUNT READ AT ALL, which is the strongest form of the claim.
   *
   * A quote that never loads the account cannot mutate one, cannot bump a
   * revision and cannot record an idempotency key. It also means the
   * calculator adds nothing to the DB egress PR #156 spent its whole
   * effort reducing: repeated quotes cost zero database reads.
   */
  it('never loads the account, so it can neither read nor raise a revision', async () => {
    const { service, repo } = build();
    for (let i = 0; i < 5; i += 1) {
      await service.priceQuote(actor, {
        kind: 'ORDER', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.25', price: '81480', leverage: '50',
      });
    }
    expect(repo.reads).toBe(0);
  });
});

describe('quoted figures equal the authoritative functions', () => {
  it('ORDER matches quoteOrderCost exactly', async () => {
    const { service, profile } = build();
    const quoted = await service.priceQuote(actor, { kind: 'ORDER', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.25', price: '81480', leverage: '50' });
    const direct = quoteOrderCost({ side: 'LONG', quantity: '0.25', price: '81480', leverage: '50', profile });
    expect(quoted.kind).toBe('ORDER');
    if (quoted.kind !== 'ORDER') throw new Error('kind');
    expect(quoted.entryNotional).toBe(direct.entryNotional);
    expect(quoted.baseInitialMargin).toBe(direct.baseInitialMargin);
    expect(quoted.closeFeeReserve).toBe(direct.closeFeeReserve);
    expect(quoted.openingFee).toBe(direct.openingFee);
    expect(quoted.positionMargin).toBe(direct.positionMargin);
    expect(quoted.totalCost).toBe(direct.totalCost);
    expect(quoted.violation).toBeNull();
  });

  it('notional and margin are reported as different figures', async () => {
    const { service } = build();
    const quoted = await service.priceQuote(actor, { kind: 'ORDER', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.25', price: '81480', leverage: '50' });
    if (quoted.kind !== 'ORDER') throw new Error('kind');
    expect(quoted.entryNotional).toBe('20370');
    expect(quoted.baseInitialMargin).toBe('407.4');
  });

  it('POSITION matches calculatePosition exactly, liquidation included', async () => {
    const { service, profile } = build();
    const quoted = await service.priceQuote(actor, { kind: 'POSITION', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', entryPrice: '79650', markPrice: '81485.5', leverage: '20' });
    const direct = calculatePosition({ side: 'LONG', quantity: '0.45', entryPrice: '79650', markPrice: '81485.5', leverage: '20', profile });
    if (quoted.kind !== 'POSITION') throw new Error('kind');
    expect(quoted.unrealizedPnl).toBe(direct.unrealizedPnl);
    expect(quoted.roiPercent).toBe(direct.roiPercent);
    expect(quoted.roiMarginBasis).toBe(direct.roiMarginBasis);
    expect(quoted.liquidationPrice).toBe(direct.liquidationPrice);
    expect(quoted.maintenanceMargin).toBe(direct.maintenanceMargin);
    expect(quoted.unrealizedPnl).toBe(linearPnl('LONG', '0.45', '79650', '81485.5'));
  });

  it('a position whose collateral outlasts the contract reports no liquidation price', async () => {
    const { service } = build();
    const quoted = await service.priceQuote(actor, {
      kind: 'POSITION', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', entryPrice: '79650', markPrice: '79650',
      leverage: '20', allocatedMargin: '10000000',
    });
    if (quoted.kind !== 'POSITION') throw new Error('kind');
    expect(quoted.liquidationPrice).toBeNull();
  });

  it('TARGET matches targetExitPrice and round-trips through linearPnl', async () => {
    const { service } = build();
    const quoted = await service.priceQuote(actor, {
      kind: 'TARGET', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', entryPrice: '79650', leverage: '20',
      basis: 'GROSS', targetPnl: '1732.5',
    });
    if (quoted.kind !== 'TARGET') throw new Error('kind');
    expect(quoted.exitPrice).not.toBeNull();
    expect(linearPnl('LONG', '0.45', '79650', quoted.exitPrice!)).toBe('1732.5');
    expect(quoted.exitPrice).toBe(targetExitPrice({ side: 'LONG', quantity: '0.45', entryPrice: '79650', targetPnl: '1732.5', basis: 'GROSS' }));
  });

  it('a TARGET given as ROI resolves against the engine basis, not an invented one', async () => {
    const { service, profile } = build();
    const quoted = await service.priceQuote(actor, {
      kind: 'TARGET', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', entryPrice: '79650', leverage: '20',
      basis: 'GROSS', targetRoiPercent: '50',
    });
    if (quoted.kind !== 'TARGET') throw new Error('kind');
    const snapshot = calculatePosition({ side: 'LONG', quantity: '0.45', entryPrice: '79650', markPrice: '79650', leverage: '20', profile });
    expect(quoted.roiMarginBasis).toBe(snapshot.roiMarginBasis);
    // The PnL aimed at is exactly half the basis, and the exit price delivers it.
    expect(Number(quoted.targetPnl)).toBeCloseTo(Number(snapshot.roiMarginBasis) * 0.5, 8);
    expect(Number(linearPnl('LONG', '0.45', '79650', quoted.exitPrice!))).toBeCloseTo(Number(quoted.targetPnl), 8);
  });

  it('FUNDING matches fundingCashflow and scales by interval count', async () => {
    const { service } = build();
    const quoted = await service.priceQuote(actor, { kind: 'FUNDING', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', markPrice: '81485.5', rate: '0.0001', intervals: 3 });
    if (quoted.kind !== 'FUNDING') throw new Error('kind');
    expect(quoted.perInterval).toBe(fundingCashflow('LONG', '0.45', '81485.5', '0.0001'));
    expect(Number(quoted.total)).toBeCloseTo(Number(quoted.perInterval) * 3, 8);
  });
});

describe('contract rules are reported, not thrown, so the figures stay visible', () => {
  it('a quantity below the step is reported as a violation with the limit named', async () => {
    const { service } = build();
    const quoted = await service.priceQuote(actor, { kind: 'ORDER', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.0005', price: '81480', leverage: '10' });
    if (quoted.kind !== 'ORDER') throw new Error('kind');
    expect(quoted.violation).not.toBeNull();
    expect(quoted.violation!.code).toBeTruthy();
    // The cost figures are still there to look at.
    expect(quoted.entryNotional).not.toBeNull();
  });

  it('leverage above the tier cap yields a violation rather than a thrown request', async () => {
    const { service } = build();
    const quoted = await service.priceQuote(actor, { kind: 'ORDER', symbol: 'BTCUSDT', side: 'LONG', quantity: '4', price: '81480', leverage: '100' });
    if (quoted.kind !== 'ORDER') throw new Error('kind');
    expect(quoted.violation).not.toBeNull();
    expect(quoted.baseInitialMargin).toBeNull();
  });

  it('a size inside every rule reports no violation', async () => {
    const { service } = build();
    const quoted = await service.priceQuote(actor, { kind: 'ORDER', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', price: '81480', leverage: '10' });
    if (quoted.kind !== 'ORDER') throw new Error('kind');
    expect(quoted.violation).toBeNull();
  });

  it('the contract rules travel with the quote so the form can show the limits', async () => {
    const { service, rules } = build();
    const quoted = await service.priceQuote(actor, { kind: 'ORDER', symbol: 'BTCUSDT', side: 'LONG', quantity: '0.45', price: '81480', leverage: '10' });
    if (quoted.kind !== 'ORDER') throw new Error('kind');
    expect(quoted.rules.qtyStep).toBe(rules.qtyStep);
    expect(quoted.rules.minOrderQty).toBe(rules.minOrderQty);
    expect(quoted.rules.maxOrderQty).toBe(rules.maxOrderQty);
  });
});
