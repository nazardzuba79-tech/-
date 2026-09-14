import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { PrivateTradingStore, json, money, hash, AccountTx } from './store';
import { PrivateTradingMarketData, PrivateInstrument, PrivateFreshQuote, PrivateFundingEvent, assertPrivateFreshQuote, PRIVATE_QUOTE_MAX_AGE_MS } from './marketData';
import { amount, calculatePosition, consumeBook, decimal, quoteOrderCost, roiPercent, validateContractOrder } from './math';
import { replayScenario } from './replay';
import { ContractRules, ModelProfile, ReplayResult } from './types';
import { OwnerSession, PreviewResult, PrivateOrder, PrivatePosition, PrivateTradingError, TradeRequest } from './serviceTypes';
import { applyPrivateFunding, availablePrivateBook, cancelPrivateOrder, closePrivatePosition, fillPrivateOrder, updatePosition } from './liveEngine';

const number = (v: string) => new BigNumber(v);
const iso = (time: number) => new Date(time).toISOString();
const normalize = (symbol: string) => symbol.toUpperCase().replace(/[-/]USDT$/, 'USDT');
const activeOrder = (order: PrivateOrder) => ['OPEN', 'PARTIALLY_FILLED'].includes(order.status);
type StoredRequest = TradeRequest & { advance?: { id: string; version: number }; historyIntervalMinutes?: 1 | 5 | 15 | 60;
  instrumentSnapshot?: PrivateInstrument; frozenScenario?: { profile: ModelProfile; createdAt: number; capital: string } };
interface FundingPlan { symbol: string; intervalMs: number; through: number; from: number; events: PrivateFundingEvent[] }
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
const sameRequest = (a: unknown, b: unknown) => hash(canonical(a)) === hash(canonical(b));
export const contractRules = (instrument: PrivateInstrument): ContractRules => ({
  symbol: instrument.symbol, ...instrument.filters, minLeverage: instrument.leverage.min,
  maxLeverage: instrument.leverage.max, leverageStep: instrument.leverage.step,
});
export function simulationProfile(instrument: PrivateInstrument): ModelProfile {
  return {
    pricingModelVersion: 'VOLTEX_OBSERVED_DEPTH_IOC_NEXT_OPEN_V1', feeModelVersion: 'VOLTEX_STANDARD_55_20_BPS100_V1',
    riskModelVersion: `ENTRY_FIXED_ISOLATED_V1:${instrument.parameterVersion}`,
    takerFeeRate: '0.00055', makerFeeRate: '0.0002', liquidationFeeRate: '0', slippageBps: '2',
    riskTiers: instrument.riskTiers.map(t => ({ maxNotional: t.riskLimitValue, maintenanceRate: t.maintenanceMarginRate, deduction: t.maintenanceDeduction, maxLeverage: t.maxLeverage })),
    assumptions: [
      'VOLTEX isolated simulation: entry-based margin, Mark Price maintenance; current instrument risk parameters.',
      'Configured fee profile: taker 0.055%, maker 0.02%; observed-cross Limit fills use the conservative taker fee.',
      'Historical fills use next candle open with 2 bps modeled slippage; funding schedule uses current interval.',
      'Private live funding is chronological per contract; simultaneous credits settle before debits.',
      'This is a versioned simulation, not a claim of exact historical venue conditions.',
    ],
  };
}

export class PrivateTradingService {
  private jobs = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private unavailableSymbols = new Set<string>();
  private nextSymbol = 0;
  constructor(readonly store: PrivateTradingStore, readonly market: PrivateTradingMarketData | null) {}
  private data() { if (!this.market) throw new PrivateTradingError('market_unavailable', 'Котировки временно недоступны', 503); return this.market; }
  private async repeatedCommand(actor: OwnerSession, key: string, input: unknown): Promise<{ found: boolean; response?: unknown }> {
    await this.store.authorized(actor);
    const prior = await this.store.db.privateTradingCommand.findUnique({ where: { userId_key: { userId: actor.userId, key } } });
    if (!prior) return { found: false };
    if (prior.requestHash !== hash(input)) throw new PrivateTradingError('idempotency_conflict', 'Повторный запрос содержит другие параметры', 409);
    await this.store.authorized(actor);
    return { found: true, response: prior.response };
  }
  /** All provider requests finish before acquiring the private account row lock. */
  private async fundingPlan(positions: PrivatePosition[], symbol: string, instrument?: PrivateInstrument): Promise<FundingPlan> {
    const metadata = instrument ?? await this.data().instrument(symbol), intervalMs = metadata.fundingIntervalMinutes * 60_000;
    const through = Math.floor(Date.now() / intervalMs) * intervalMs;
    const active = positions.filter(p => p.symbol === symbol && p.status === 'OPEN');
    const from = Math.min(through + 1, ...active.map(p => Math.max(p.lastFundingAt, Date.parse(p.effectiveOpenedAt)) + 1));
    let events: PrivateFundingEvent[] = [];
    if (from <= through) {
      const funding = await this.data().funding(symbol, from, through);
      if (!funding.complete) throw new PrivateTradingError('funding_history_incomplete', 'Данные funding обновляются. Повторите действие позже', 503);
      events = funding.events;
    }
    return { symbol, intervalMs, through, from, events };
  }
  private fundingStillCurrent(plan: FundingPlan): void {
    if (Math.floor(Date.now() / plan.intervalMs) * plan.intervalMs > plan.through) throw new PrivateTradingError('funding_boundary_changed', 'Наступил расчёт funding. Обновите котировку', 409);
  }
  private async settleFunding(tx: AccountTx, plan: FundingPlan): Promise<void> {
    this.fundingStillCurrent(plan);
    const positions = tx.state.positions.filter(p => p.symbol === plan.symbol && p.status === 'OPEN');
    for (const position of positions) {
      const last = Math.max(position.lastFundingAt, Date.parse(position.effectiveOpenedAt));
      if (last >= plan.through) continue;
      if (last + 1 < plan.from) throw new PrivateTradingError('funding_position_changed', 'Позиция изменилась. Обновите расчёт', 409);
    }
    for (const event of [...plan.events].sort((a, b) => a.timestamp - b.timestamp)) {
      // Funding at one instant settles credits before debits. Collateral cannot depend on array insertion order.
      const credit = (p: PrivatePosition) => p.side === 'LONG' ? number(event.rate).lt(0) : number(event.rate).gt(0);
      const ordered = [...positions].sort((a, b) => Number(credit(b)) - Number(credit(a)) || a.id.localeCompare(b.id));
      for (const position of ordered) await applyPrivateFunding(tx, position, event);
    }
    for (const position of positions) {
      // complete=true proves the chosen model's settlement grid is fully covered.
      position.lastFundingAt = Math.max(position.lastFundingAt, plan.through);
    }
  }
  /** Stage one engine action before journaling, so an unfillable order cannot undo another position's risk close. */
  private async stageEngineAction(tx: AccountTx, run: (candidate: AccountTx) => Promise<void>): Promise<boolean> {
    const events: Parameters<AccountTx['entry']>[] = [];
    const candidate: AccountTx = { ...tx, state: structuredClone(tx.state), available: new BigNumber(tx.available), reserved: new BigNumber(tx.reserved),
      principal: new BigNumber(tx.principal), realized: new BigNumber(tx.realized), entry: async (...args) => { events.push(args); } };
    try { await run(candidate); } catch { return false; }
    // Database failures are deliberately not swallowed: the enclosing account transaction rolls back.
    for (const event of events) await tx.entry(...event);
    tx.state = candidate.state; tx.available = candidate.available; tx.reserved = candidate.reserved; tx.principal = candidate.principal; tx.realized = candidate.realized;
    return true;
  }
  private positionDto(position: PrivatePosition) {
    const timestamp = Date.parse(position.asOf);
    const live = position.mode === 'DEMO_LIVE' && position.status === 'OPEN';
    const fresh = Number.isFinite(timestamp) && timestamp <= Date.now() + 1000 && Date.now() - timestamp <= PRIVATE_QUOTE_MAX_AGE_MS;
    const valuationQuantity = position.status === 'OPEN' ? position.quantity : position.initialQuantity;
    return { ...position,
      notional: money(number(valuationQuantity).times(position.markPrice)),
      entryNotional: money(number(valuationQuantity).times(position.entryPrice)),
      ...(live ? { dataStatus: fresh && !this.unavailableSymbols.has(position.symbol) ? 'LIVE' as const : 'UNAVAILABLE' as const }
        : { dataStatus: undefined }),
    };
  }
  async getMarket(actor: OwnerSession, symbol: string) {
    await this.store.authorized(actor);
    const [quote, instrument] = await Promise.all([this.data().freshQuote(normalize(symbol)), this.data().instrument(normalize(symbol))]);
    await this.store.authorized(actor);
    return { ...quote, instrument: { ...instrument, ...contractRules(instrument) } };
  }
  async state(actor: OwnerSession) {
    const account = await this.store.read(actor);
    const [balance, previews] = await Promise.all([
      this.store.db.demoBalance.findUnique({ where: { userId_asset: { userId: actor.userId, asset: 'USDT' } } }),
      this.store.db.privateTradingPreview.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const positions = account.state.positions.filter(p => p.status === 'OPEN').map(p => this.positionDto(p));
    const history = account.state.positions.filter(p => p.status !== 'OPEN').map(p => this.positionDto(p));
    const scenarios = account.state.scenarios.map(s => ({ ...this.positionDto(s.position), version: s.version, issues: s.result.issues,
      allocatedCapital: s.allocatedCapital, scenarioEquity: s.result.scenarioEquity }));
    const sortHistory = <T extends PrivatePosition>(items: T[]) => items.sort((a, b) => Date.parse(b.effectiveClosedAt ?? b.effectiveOpenedAt) - Date.parse(a.effectiveClosedAt ?? a.effectiveOpenedAt));
    await this.store.authorized(actor);
    return {
      wallet: { available: account.available.toString(), reserved: account.reserved.toString(),
        demoAvailable: balance?.available.toString() ?? '0', allocatedCapital: account.principal.toString(),
        realizedPnl: account.realized.toString(),
        unrealizedPnl: positions.some(p => p.dataStatus === 'UNAVAILABLE') ? null : money(positions.reduce((sum, p) => sum.plus(p.unrealizedPnl), number('0'))),
      }, positions, orders: account.state.orders.filter(activeOrder), orderHistory: account.state.orders.filter(o => !activeOrder(o)),
      history: sortHistory(history), scenarios: sortHistory(scenarios),
      copyHistory: sortHistory([...positions, ...history, ...scenarios.filter(s => s.verification === 'VERIFIED')]),
      previews: previews.map(p => this.previewDto(p)),
    };
  }
  private previewDto(row: any) {
    const expired = row.status === 'READY' && new Date(row.expiresAt).getTime() <= Date.now();
    return { id: row.id, status: expired ? 'EXPIRED' : row.status, mode: row.mode, progress: row.progress,
      error: expired ? 'Расчёт истёк. Обновите котировку' : row.error,
      createdAt: row.createdAt, expiresAt: row.expiresAt,
      result: row.result ? { ...row.result, position: row.result.position ? this.positionDto(row.result.position) : null } : null };
  }
  async getPreview(actor: OwnerSession, id: string) {
    await this.store.authorized(actor);
    const row = await this.store.db.privateTradingPreview.findFirst({ where: { id, userId: actor.userId } });
    if (!row) throw new PrivateTradingError('not_found', 'Расчёт не найден', 404);
    await this.store.authorized(actor);
    return this.previewDto(row);
  }
  async preview(actor: OwnerSession, request: TradeRequest, scenario?: { id: string; version: number }) {
    await this.store.authorized(actor);
    request = { ...request, symbol: normalize(request.symbol) };
    let stored: StoredRequest = { ...request };
    // Model and creation time come from the persisted scenario, never from the browser.
    delete stored.instrumentSnapshot; delete stored.frozenScenario; delete stored.historyIntervalMinutes; delete stored.advance;
    if (scenario) {
      const account = await this.store.read(actor), original = account.state.scenarios.find(s => s.id === scenario.id);
      if (!original || original.version !== scenario.version || original.result.status !== 'OPEN') throw new PrivateTradingError('scenario_changed', 'Сценарий изменился. Обновите расчёт', 409);
      const originalRequest = original.request as StoredRequest;
      stored = { ...originalRequest, asOf: request.asOf, idempotencyKey: request.idempotencyKey, advance: scenario,
        capital: original.allocatedCapital, historyIntervalMinutes: originalRequest.historyIntervalMinutes ?? 1,
        frozenScenario: { profile: original.profile, createdAt: Date.parse(original.createdAt), capital: original.allocatedCapital } };
    }
    const prior = await this.store.db.privateTradingPreview.findFirst({ where: { userId: actor.userId, requestKey: request.idempotencyKey } });
    if (prior) {
      if (!sameRequest(prior.request, stored)) throw new PrivateTradingError('idempotency_conflict', 'Параметры запроса изменились', 409);
      await this.store.authorized(actor);
      return this.previewDto(prior);
    }
    const id = await this.store.transact(actor, null, {}, async tx => {
      const prior = await tx.db.privateTradingPreview.findFirst({ where: { userId: actor.userId, requestKey: request.idempotencyKey } });
      if (prior) {
        if (!sameRequest(prior.request, stored)) throw new PrivateTradingError('idempotency_conflict', 'Параметры запроса изменились', 409);
        return prior.id;
      }
      if (await tx.db.privateTradingPreview.count({ where: { userId: actor.userId, status: 'RUNNING' } }) >= 4) throw new PrivateTradingError('preview_busy', 'Дождитесь текущих расчётов', 409);
      if (await tx.db.privateTradingPreview.count({ where: { userId: actor.userId } }) >= 2000) throw new PrivateTradingError('preview_limit', 'Достигнут лимит сохранённых расчётов', 409);
      if (request.mode === 'HISTORICAL_REPLAY') {
        const running = await tx.db.privateTradingPreview.count({ where: { userId: actor.userId, status: 'RUNNING', mode: 'HISTORICAL_REPLAY' } });
        if (running) throw new PrivateTradingError('replay_busy', 'Дождитесь завершения текущего расчёта', 409);
      }
      const id = randomUUID();
      await tx.db.privateTradingPreview.create({ data: {
        id, userId: actor.userId, requestKey: request.idempotencyKey, session: json(actor), mode: request.mode,
        status: 'RUNNING', request: json(stored), expiresAt: new Date(Date.now() + 30 * 60_000),
      } });
      tx.state.session = actor;
      return id;
    });
    if (request.mode === 'DEMO_LIVE') await this.runPreview(id);
    else void this.runPreview(id);
    return this.getPreview(actor, id);
  }
  private async runPreview(id: string) {
    if (this.jobs.has(id)) return;
    const abort = new AbortController(); this.jobs.set(id, abort);
    let guard: NodeJS.Timeout | undefined;
    try {
      const row = await this.store.db.privateTradingPreview.findUniqueOrThrow({ where: { id } });
      if (row.status !== 'RUNNING') return;
      if (row.expiresAt.getTime() <= Date.now()) {
        await this.store.db.privateTradingPreview.updateMany({ where: { id, status: 'RUNNING' }, data: { status: 'EXPIRED', error: 'Расчёт истёк. Создайте новый запрос' } });
        return;
      }
      const actor = row.session as unknown as OwnerSession;
      const request = row.request as unknown as StoredRequest;
      await this.store.authorized(actor);
      // A revoked owner session cancels even a long historical page fetch.
      guard = setInterval(() => { void this.store.authorized(actor).catch(() => abort.abort()); }, 2_000); guard.unref();
      const instrument = request.advance && request.instrumentSnapshot ? request.instrumentSnapshot : await this.data().instrument(request.symbol, abort.signal);
      const profile = request.frozenScenario?.profile ?? simulationProfile(instrument);
      let result: PreviewResult;
      if (request.mode === 'DEMO_LIVE') {
        const account = await this.store.read(actor);
        const quote = await this.data().freshQuote(request.symbol, abort.signal);
        const book = availablePrivateBook(structuredClone(account.state), quote);
        const best = request.type === 'LIMIT' ? request.limitPrice! : request.side === 'LONG' ? quote.asks[0].price : quote.bids[0].price;
        let quantity = this.quantity(request, best, instrument, profile);
        validateContractOrder({ rules: contractRules(instrument), quantity, price: best, leverage: request.leverage, market: request.type === 'MARKET', profile });
        let price = best, previewQuantity = quantity, crossedLimitCost: string | null = null;
        if (request.type === 'MARKET') {
          const side = request.side === 'LONG' ? 'BUY' : 'SELL';
          if (!request.quantity && request.margin) {
            // Find a representable quantity whose swept cost fits the requested margin budget.
            let lower = number('0'), upper = number(quantity).div(instrument.filters.qtyStep).integerValue(BigNumber.ROUND_FLOOR);
            for (let step = 0; lower.lt(upper) && step < 128; step++) {
              const middle = lower.plus(upper).plus(1).div(2).integerValue(BigNumber.ROUND_FLOOR), size = amount(middle.times(instrument.filters.qtyStep));
              const swept = consumeBook(side, size, book);
              const within = swept.averagePrice && number(quoteOrderCost({ side: request.side, quantity: swept.filledQuantity, price: swept.averagePrice, leverage: request.leverage, profile }).totalCost).lte(request.margin);
              if (within) lower = middle; else upper = middle.minus(1);
            }
            quantity = amount(lower.times(instrument.filters.qtyStep));
            validateContractOrder({ rules: contractRules(instrument), quantity, price: best, leverage: request.leverage, market: true, profile });
          }
          const swept = consumeBook(side, quantity, book);
          if (!swept.averagePrice) throw new PrivateTradingError('liquidity_unavailable', 'Недостаточно ликвидности для расчёта', 503);
          price = swept.averagePrice; previewQuantity = swept.filledQuantity;
        } else {
          const swept = consumeBook(request.side === 'LONG' ? 'BUY' : 'SELL', quantity, book, request.limitPrice);
          if (swept.averagePrice) {
            price = swept.averagePrice; previewQuantity = swept.filledQuantity;
            const filledCost = quoteOrderCost({ side: request.side, quantity: previewQuantity, price, leverage: request.leverage, profile }).totalCost;
            const remainingCost = number(swept.remainingQuantity).gt(0) ? quoteOrderCost({ side: request.side, quantity: swept.remainingQuantity, price: request.limitPrice!, leverage: request.leverage, profile }).totalCost : '0';
            crossedLimitCost = money(number(filledCost).plus(remainingCost));
          }
        }
        this.validateProtection(request, price, instrument);
        const cost = quoteOrderCost({ side: request.side, quantity: previewQuantity, price, leverage: request.leverage, profile });
        // Opening leverage must also fit the Mark Price tier used by maintenance risk.
        quoteOrderCost({ side: request.side, quantity: previewQuantity, price: quote.markPrice, leverage: request.leverage, profile });
        const reserve = request.type === 'LIMIT' ? money(BigNumber.maximum(crossedLimitCost ?? '0', quoteOrderCost({ side: request.side, quantity, price: request.limitPrice!, leverage: request.leverage, profile }).totalCost)) : cost.totalCost;
        if (request.margin && number(reserve).gt(request.margin)) throw new PrivateTradingError('margin_budget_exceeded', 'Исполнение превышает указанную маржу. Уменьшите количество', 409);
        const metric = calculatePosition({ side: request.side, quantity: previewQuantity, entryPrice: price, markPrice: quote.markPrice,
          leverage: request.leverage, allocatedMargin: cost.positionMargin, openingFees: cost.openingFee, profile });
        const position = this.blankPosition(id, { ...request, quantity: previewQuantity }, price, profile);
        Object.assign(position, { allocatedMargin: cost.positionMargin, initialMarginBasis: cost.positionMargin,
          liquidationPrice: metric.liquidationPrice, unrealizedPnl: metric.unrealizedPnl, roiPercent: metric.roiPercent,
          markPrice: quote.markPrice, asOf: iso(quote.markProviderTimestamp), openingFees: cost.openingFee, netPnl: metric.netPnl, dataStatus: 'LIVE' });
        result = { position, cost: { required: reserve, initialMargin: cost.baseInitialMargin, fee: cost.openingFee, closeFeeReserve: cost.closeFeeReserve },
          request: { ...request, quantity }, profile, quote,
          consent: { slippageBps: request.type === 'MARKET' ? '5' : '0', slippagePercent: request.type === 'MARKET' ? '0.05' : '0', quantity,
            minimumFillQuantity: request.type === 'MARKET' ? previewQuantity : '0',
            maxRequired: request.margin ?? (request.type === 'MARKET' ? money(number(cost.totalCost).times('1.0005')) : reserve),
            maxAveragePrice: request.side === 'LONG' ? request.type === 'LIMIT' ? request.limitPrice! : amount(number(price).times('1.0005')) : null,
            minAveragePrice: request.side === 'SHORT' ? request.type === 'LIMIT' ? request.limitPrice! : amount(number(price).times('0.9995')) : null },
          issues: number(previewQuantity).lt(quantity) ? [request.type === 'MARKET' ? 'Частичное исполнение: остаток рыночного ордера будет отменён' : 'Частичное исполнение: остаток останется лимитным ордером'] : [], assumptions: profile.assumptions };
      } else {
        const start = Date.parse(request.effectiveOpenedAt!), requestedEnd = Date.parse(request.asOf ?? iso(Date.now()));
        if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || start >= requestedEnd || requestedEnd > Date.now() || start < instrument.launchTime) throw new PrivateTradingError('invalid_history_range', 'Проверьте даты и период существования контракта');
        const intervalMinutes = request.historyIntervalMinutes ?? (requestedEnd - start <= 30 * 86400_000 ? 1 : 5);
        const intervalMs = intervalMinutes * 60_000;
        const end = Math.floor(requestedEnd / intervalMs) * intervalMs;
        const data = await this.data().history({ symbol: request.symbol, startTime: Math.floor(start / intervalMs) * intervalMs, endTime: end, intervalMinutes, signal: abort.signal,
          onProgress: p => { void this.store.db.privateTradingPreview.updateMany({ where: { id, status: 'RUNNING' }, data: { progress: Math.min(90, p.pages * 3) } }).catch(() => {}); },
        });
        if (request.advance && request.instrumentSnapshot) {
          const interval = instrument.fundingIntervalMinutes * 60_000;
          data.expectedFundingTimestamps = [];
          for (let at = Math.ceil(start / interval) * interval; at < end; at += interval) data.expectedFundingTimestamps.push(at);
          const fundingTimes = new Set(data.fundingEvents.map(event => event.timestamp));
          data.issues = data.issues.filter(issue => issue !== 'funding_history_gap');
          if (data.expectedFundingTimestamps.some(at => !fundingTimes.has(at))) data.issues.push('funding_history_gap');
          data.complete = data.issues.length === 0;
        }
        const entry = data.tradeCandles.find(c => c.timestamp > start)?.open;
        if (!entry) throw new PrivateTradingError('history_incomplete', 'Недостаточно истории для выбранного входа', 409);
        const quantity = this.quantity(request, request.manualEntryPrice ?? entry, instrument, profile);
        validateContractOrder({ rules: contractRules(instrument), quantity, price: request.manualEntryPrice ?? entry, leverage: request.leverage, market: true, profile });
        this.validateProtection(request, request.manualEntryPrice ?? entry, instrument);
        for (const event of request.events ?? []) {
          if (event.kind === 'CLOSE' && !decimal(event.quantity, 'close_quantity', true).mod(instrument.filters.qtyStep).isZero()) throw new PrivateTradingError('invalid_quantity_step', 'Количество закрытия не соответствует шагу контракта');
          if (event.kind === 'TPSL') for (const price of [event.takeProfit, event.stopLoss]) {
            if (price !== null && !decimal(price, 'trigger_price', true).mod(instrument.filters.tickSize).isZero()) throw new PrivateTradingError('invalid_trigger_step', 'Цена TP/SL не соответствует шагу контракта');
          }
        }
        const cost = quoteOrderCost({ side: request.side, quantity, price: request.manualEntryPrice ?? entry, leverage: request.leverage, profile });
        const capital = request.frozenScenario?.capital ?? request.capital ?? money(number(cost.totalCost).times('1.01'));
        const replay = replayScenario({ scenarioId: request.advance?.id ?? id, symbol: request.symbol, side: request.side, quantity,
          leverage: request.leverage, createdAt: request.frozenScenario?.createdAt ?? row.createdAt.getTime(), evaluatedAt: Date.now(), requestedOpenedAt: start, requestedClosedAt: request.effectiveClosedAt ? Date.parse(request.effectiveClosedAt) : undefined,
          asOf: end, allocatedCapital: capital, manualEntryPrice: request.manualEntryPrice, takeProfit: request.takeProfit, stopLoss: request.stopLoss, events: request.events, data, profile,
        });
        result = { position: this.historicalPosition(id, { ...request, quantity }, replay, profile), replay,
          request: { ...request, quantity, capital, asOf: iso(end), historyIntervalMinutes: intervalMinutes, instrumentSnapshot: instrument } as StoredRequest, profile,
          cost: { required: capital, initialMargin: cost.baseInitialMargin, fee: cost.openingFee, closeFeeReserve: cost.closeFeeReserve },
          issues: replay.issues, assumptions: [...profile.assumptions, ...replay.assumptions],
          scenarioId: request.advance?.id, scenarioVersion: request.advance?.version,
        };
      }
      if (abort.signal.aborted) throw new PrivateTradingError('cancelled', 'Расчёт отменён', 409);
      await this.store.authorized(actor);
      const status = result.replay && result.replay.verification !== 'VERIFIED' ? result.replay.verification : 'READY';
      // Publishing a result reuses the same final owner/session checks as financial commands.
      // Cancellation wins through the conditional status update, including after a restart.
      await this.store.transact(actor, null, {}, async tx => {
        if (abort.signal.aborted) throw new PrivateTradingError('cancelled', 'Расчёт отменён', 409);
        await tx.db.privateTradingPreview.updateMany({ where: { id, status: 'RUNNING' }, data: { result: json(result), status, progress: 100,
          expiresAt: new Date(Date.now() + (request.mode === 'DEMO_LIVE' ? 60_000 : 30 * 60_000)) } });
        return { id, status };
      });
    } catch (error) {
      const message = error instanceof PrivateTradingError ? error.message : 'Расчёт недоступен. Проверьте параметры или повторите позже.';
      const incomplete = error instanceof PrivateTradingError && error.code === 'history_incomplete';
      const revoked = error instanceof PrivateTradingError && ['private_access_denied', 'session_expired', 'cancelled'].includes(error.code);
      await this.store.db.privateTradingPreview.updateMany({ where: { id, status: 'RUNNING' }, data: { status: abort.signal.aborted || revoked ? 'CANCELLED' : incomplete ? 'INCOMPLETE' : 'FAILED', error: message } }).catch(() => {});
    } finally { if (guard) clearInterval(guard); this.jobs.delete(id); }
  }
  private quantity(request: TradeRequest, price: string, instrument: PrivateInstrument, profile: ModelProfile) {
    if (request.quantity) return request.quantity;
    if (!request.margin) throw new PrivateTradingError('size_required', 'Укажите количество или маржу');
    const unit = quoteOrderCost({ side: request.side, quantity: instrument.filters.qtyStep, price, leverage: request.leverage, profile });
    return amount(decimal(request.margin, 'margin', true).div(unit.totalCost).integerValue(BigNumber.ROUND_FLOOR).times(instrument.filters.qtyStep));
  }
  private validateProtection(request: Pick<TradeRequest, 'side' | 'takeProfit' | 'stopLoss'>, entry: string, instrument: PrivateInstrument) {
    for (const [kind, value] of [['tp', request.takeProfit], ['sl', request.stopLoss]] as const) {
      if (!value) continue;
      const price = decimal(value, kind, true);
      if (!price.mod(instrument.filters.tickSize).isZero()) throw new PrivateTradingError('invalid_trigger_step', 'Цена TP/SL не соответствует шагу контракта');
      const above = kind === 'tp' ? request.side === 'LONG' : request.side === 'SHORT';
      if (above ? !price.gt(entry) : !price.lt(entry)) throw new PrivateTradingError('invalid_trigger_price', 'Проверьте направление цены TP/SL');
    }
  }
  private blankPosition(id: string, request: TradeRequest, entry: string, profile: ModelProfile): PrivatePosition {
    return { id, mode: request.mode, symbol: request.symbol, side: request.side, leverage: request.leverage, quantity: request.quantity!, initialQuantity: request.quantity!,
      entryPrice: entry, markPrice: entry, allocatedMargin: '0', initialMarginBasis: '0', realizedMarginBasis: '0', liquidationPrice: null,
      unrealizedPnl: '0', realizedGross: '0', netPnl: '0', roiPercent: null, openingFees: '0', closingFees: '0', fundingNet: '0',
      takeProfit: request.takeProfit ?? null, stopLoss: request.stopLoss ?? null, status: 'OPEN', createdAt: iso(Date.now()),
      effectiveOpenedAt: request.effectiveOpenedAt ?? iso(Date.now()), effectiveClosedAt: null, asOf: iso(Date.now()), profile,
      verification: 'VERIFIED', lastFundingAt: Date.now(), lastBookTimestamp: 0, lastFillAt: Date.now(),
    };
  }
  private historicalPosition(id: string, request: TradeRequest, replay: ReplayResult, profile: ModelProfile) {
    if (!replay.entryPrice || !replay.valuationPrice || !replay.effectiveOpenedAt || replay.status === 'NOT_OPENED') {
      throw new PrivateTradingError('history_incomplete', 'Нет подтверждённой цены входа или оценки для этого сценария', 409);
    }
    const p = this.blankPosition(id, request, replay.entryPrice, profile);
    Object.assign(p, { id: replay.scenarioId, scenarioId: replay.scenarioId, quantity: replay.remainingQuantity, initialQuantity: request.quantity,
      markPrice: replay.valuationPrice, allocatedMargin: replay.remainingCollateral, initialMarginBasis: replay.roiMarginBasis,
      unrealizedPnl: replay.unrealizedPnl, realizedGross: replay.realizedGross, netPnl: replay.netPnl, roiPercent: replay.roiPercent,
      openingFees: replay.openingFees, closingFees: replay.closingFees, fundingNet: replay.fundingNet, liquidationPrice: replay.liquidationPrice,
      status: replay.status, verification: replay.verification,
      effectiveOpenedAt: iso(replay.effectiveOpenedAt), effectiveClosedAt: replay.effectiveClosedAt ? iso(replay.effectiveClosedAt) : null,
      asOf: iso(replay.asOf), createdAt: iso(replay.createdAt),
    });
    return p;
  }
  async cancelPreview(actor: OwnerSession, id: string) {
    await this.store.authorized(actor);
    const cancelled = await this.store.db.privateTradingPreview.updateMany({ where: { id, userId: actor.userId, status: { in: ['RUNNING', 'READY', 'INCOMPLETE', 'AMBIGUOUS'] } }, data: { status: 'CANCELLED' } });
    if (!cancelled.count) throw new PrivateTradingError('not_found', 'Расчёт недоступен', 404);
    this.jobs.get(id)?.abort(); await this.store.authorized(actor); return { status: 'CANCELLED' };
  }
  async confirm(actor: OwnerSession, id: string, key: string) {
    const repeated = await this.repeatedCommand(actor, `confirm:${key}`, { id });
    if (repeated.found) return repeated.response;
    let finalQuote: PrivateFreshQuote | undefined;
    let funding: FundingPlan | undefined;
    await this.store.authorized(actor);
    const read = await this.store.db.privateTradingPreview.findFirst({ where: { id, userId: actor.userId } });
    if (read?.status === 'READY' && read.result && read.mode === 'DEMO_LIVE') {
      if (read.expiresAt.getTime() <= Date.now()) throw new PrivateTradingError('preview_expired', 'Обновите расчёт перед подтверждением', 409);
      const result = read.result as unknown as PreviewResult;
      if (!result.consent) throw new PrivateTradingError('preview_changed', 'Обновите расчёт с допустимой ценой исполнения', 409);
      const account = await this.store.read(actor);
      const instrument = await this.data().instrument(result.request.symbol);
      if (!sameRequest(simulationProfile(instrument), result.profile)) throw new PrivateTradingError('preview_changed', 'Параметры контракта изменились. Обновите расчёт', 409);
      funding = await this.fundingPlan(account.state.positions, result.request.symbol, instrument);
      finalQuote = await this.data().freshQuote(result.request.symbol);
    }
    return this.store.transact(actor, `confirm:${key}`, { id }, async tx => {
      const row = await tx.db.privateTradingPreview.findFirst({ where: { id, userId: actor.userId } });
      if (!row || row.status !== 'READY' || !row.result) throw new PrivateTradingError('preview_not_ready', 'Нужен завершённый подтверждённый расчёт', 409);
      if (row.expiresAt.getTime() < Date.now()) throw new PrivateTradingError('preview_expired', 'Обновите расчёт перед подтверждением', 409);
      const result = row.result as unknown as PreviewResult, request = result.request;
      if (request.mode === 'DEMO_LIVE') {
        if (!finalQuote || !funding || !result.consent || !sameRequest(result, read?.result)) throw new PrivateTradingError('preview_changed', 'Обновите расчёт перед подтверждением', 409);
        assertPrivateFreshQuote(finalQuote, request.symbol);
        const consent = result.consent;
        if (consent.quantity !== request.quantity) throw new PrivateTradingError('preview_changed', 'Количество изменилось. Обновите расчёт', 409);
        const execution = consumeBook(request.side === 'LONG' ? 'BUY' : 'SELL', request.quantity!, availablePrivateBook(tx.state, finalQuote), request.limitPrice);
        const executionCost = execution.averagePrice ? quoteOrderCost({ side: request.side, quantity: execution.filledQuantity, price: execution.averagePrice, leverage: request.leverage, profile: result.profile }).totalCost : '0';
        const restingCost = request.type === 'LIMIT' && number(execution.remainingQuantity).gt(0)
          ? quoteOrderCost({ side: request.side, quantity: execution.remainingQuantity, price: request.limitPrice!, leverage: request.leverage, profile: result.profile }).totalCost : '0';
        const required = money(number(executionCost).plus(restingCost));
        if (number(execution.filledQuantity).lt(consent.minimumFillQuantity) || number(required).gt(consent.maxRequired)
          || (execution.averagePrice && ((consent.maxAveragePrice && number(execution.averagePrice).gt(consent.maxAveragePrice))
            || (consent.minAveragePrice && number(execution.averagePrice).lt(consent.minAveragePrice))))) {
          throw new PrivateTradingError('preview_changed', 'Цена, ликвидность или стоимость вышли за подтверждённые пределы. Обновите расчёт', 409);
        }
        await this.settleFunding(tx, funding);
        const contracts = new Set([...tx.state.positions.filter(p => p.status === 'OPEN').map(p => p.symbol), ...tx.state.orders.filter(activeOrder).map(o => o.symbol), request.symbol]);
        if (contracts.size > 4) throw new PrivateTradingError('active_contract_limit', 'Одновременно доступны четыре активных тестовых контракта. Закройте позицию или отмените ордер по одному из них', 409);
        if (tx.state.positions.filter(p => p.status === 'OPEN').length + tx.state.orders.filter(activeOrder).length >= 20) throw new PrivateTradingError('active_limit', 'Достигнут лимит активных тестовых позиций', 409);
        if (tx.state.orders.length >= 2000 || tx.state.positions.length >= 1000) throw new PrivateTradingError('history_limit', 'Достигнут лимит приватной истории', 409);
        const order: PrivateOrder = { id: randomUUID(), positionId: randomUUID(), symbol: request.symbol, side: request.side, type: request.type,
          quantity: request.quantity!, remainingQuantity: request.quantity!, filledQuantity: '0', limitPrice: request.limitPrice ?? null,
          status: 'OPEN', createdAt: iso(Date.now()), reserved: '0', leverage: request.leverage,
          takeProfit: request.takeProfit ?? null, stopLoss: request.stopLoss ?? null, profile: result.profile, lastBookTimestamp: 0 };
        if (request.type === 'LIMIT') {
          const reserve = consent.maxRequired;
          if (tx.available.lt(reserve)) throw new PrivateTradingError('insufficient_margin', 'Недостаточно демо-маржи', 409);
          tx.available = tx.available.minus(reserve); tx.reserved = tx.reserved.plus(reserve); order.reserved = reserve;
          await tx.entry('ORDER_RESERVED', reserve, `order:${order.id}`);
        }
        tx.state.orders.push(order);
        await fillPrivateOrder(tx, order, finalQuote, `confirm:${id}`);
        if (order.type === 'MARKET' && number(order.filledQuantity).isZero()) throw new PrivateTradingError('liquidity_unavailable', 'Доступной ликвидности недостаточно', 503);
      } else {
        const replay = result.replay!;
        if (replay.verification !== 'VERIFIED' || !replay.entryPrice) throw new PrivateTradingError('unverified_scenario', 'Неполный сценарий нельзя подтвердить', 409);
        const previous = result.scenarioId ? tx.state.scenarios.find(s => s.id === result.scenarioId) : undefined;
        if (result.scenarioId && (!previous || previous.version !== result.scenarioVersion)) throw new PrivateTradingError('scenario_changed', 'Сценарий изменился. Обновите расчёт', 409);
        const previousJournal = previous?.result.journal ?? [];
        if (previous && (!sameRequest(previous.profile, result.profile) || previous.allocatedCapital !== result.cost.required
          || previous.createdAt !== result.position.createdAt || previous.result.asOf >= replay.asOf
          || !sameRequest(previousJournal, replay.journal.slice(0, previousJournal.length)))) {
          throw new PrivateTradingError('scenario_history_changed', 'История или модель сценария изменились. Создайте отдельный расчёт', 409);
        }
        if (!previous) {
          if (tx.state.scenarios.length >= 100) throw new PrivateTradingError('scenario_limit', 'Достигнут лимит приватных сценариев', 409);
          if (tx.available.lt(result.cost.required)) throw new PrivateTradingError('insufficient_capital', 'Недостаточно демо-капитала для сценария', 409);
          tx.available = tx.available.minus(result.cost.required); tx.reserved = tx.reserved.plus(result.cost.required);
          await tx.entry('SCENARIO_ALLOCATION', result.cost.required, `scenario:${replay.scenarioId}`, undefined, replay.scenarioId);
          tx.state.scenarios.push({ id: replay.scenarioId, request, result: replay, position: result.position, profile: result.profile, allocatedCapital: result.cost.required, createdAt: result.position.createdAt, version: 1 });
        } else { previous.result = replay; previous.position = result.position; previous.request = request; previous.version++; }
        // Scenario equity stays in its own escrow, never becoming spendable DEMO_LIVE profit.
        // An advance can append new immutable events, never rewrite a prior simulated fill.
        await tx.entry('SCENARIO_SNAPSHOT', '0', `snapshot:${id}`, replay.asOf, replay.scenarioId, { netPnl: replay.netPnl, version: previous?.version ?? 1 });
        for (const event of replay.journal.slice(previousJournal.length)) await tx.entry(event.kind, event.amount, event.id, event.effectiveAt, replay.scenarioId);
      }
      tx.state.session = actor;
      await tx.db.privateTradingPreview.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
      return { status: 'CONFIRMED', previewId: id };
    }, () => { if (finalQuote) assertPrivateFreshQuote(finalQuote, finalQuote.symbol); if (funding) this.fundingStillCurrent(funding); });
  }
  async cancelOrder(actor: OwnerSession, id: string, key: string) {
    return this.store.transact(actor, `cancel:${key}`, { id }, async tx => {
      const order = tx.state.orders.find(o => o.id === id); if (!order) throw new PrivateTradingError('not_found', 'Ордер не найден', 404);
      await cancelPrivateOrder(tx, order, id); return { order };
    });
  }
  async close(actor: OwnerSession, id: string, quantity: string | undefined, key: string) {
    const repeated = await this.repeatedCommand(actor, `close:${key}`, { id, quantity });
    if (repeated.found) return repeated.response;
    const account = await this.store.read(actor), position = account.state.positions.find(p => p.id === id);
    if (!position) throw new PrivateTradingError('not_found', 'Позиция не найдена', 404);
    const instrument = await this.data().instrument(position.symbol);
    if (quantity && !decimal(quantity, 'quantity', true).mod(instrument.filters.qtyStep).isZero()) throw new PrivateTradingError('invalid_quantity_step', 'Количество не соответствует шагу контракта');
    const funding = await this.fundingPlan(account.state.positions, position.symbol, instrument);
    const quote = await this.data().freshQuote(position.symbol);
    return this.store.transact(actor, `close:${key}`, { id, quantity }, async tx => {
      const current = tx.state.positions.find(p => p.id === id)!;
      if (!current) throw new PrivateTradingError('not_found', 'Позиция не найдена', 404);
      await this.settleFunding(tx, funding);
      await closePrivatePosition(tx, current, quantity ?? current.quantity, quote);
      return { position: this.positionDto(current) };
    }, () => { assertPrivateFreshQuote(quote, position.symbol); this.fundingStillCurrent(funding); });
  }
  async edit(actor: OwnerSession, id: string, input: { takeProfit?: string | null; stopLoss?: string | null; marginDelta?: string; leverage?: string }, key: string) {
    const repeated = await this.repeatedCommand(actor, `edit:${key}`, { id, ...input });
    if (repeated.found) return repeated.response;
    const account = await this.store.read(actor), position = account.state.positions.find(p => p.id === id);
    if (!position) throw new PrivateTradingError('not_found', 'Позиция не найдена', 404);
    const instrument = await this.data().instrument(position.symbol);
    const funding = await this.fundingPlan(account.state.positions, position.symbol, instrument);
    const quote = await this.data().freshQuote(position.symbol);
    return this.store.transact(actor, `edit:${key}`, { id, ...input }, async tx => {
      const p = tx.state.positions.find(x => x.id === id)!;
      if (!p || p.status !== 'OPEN') throw new PrivateTradingError('position_closed', 'Позиция уже закрыта', 409);
      await this.settleFunding(tx, funding);
      if (updatePosition(p, quote)?.liquidatable) throw new PrivateTradingError('liquidation_pending', 'Позиция подлежит проверке риска', 409);
      const next = { side: p.side, takeProfit: input.takeProfit === undefined ? p.takeProfit : input.takeProfit, stopLoss: input.stopLoss === undefined ? p.stopLoss : input.stopLoss };
      this.validateProtection(next, quote.markPrice, instrument);
      let delta = decimal(input.marginDelta ?? '0');
      if (delta.decimalPlaces()! > 18 || delta.abs().gte('1e18')) throw new PrivateTradingError('invalid_margin_precision', 'Маржа должна соответствовать точности счёта');
      if (input.leverage) {
        validateContractOrder({ rules: contractRules(instrument), quantity: p.quantity, price: p.entryPrice, leverage: input.leverage, market: true, profile: p.profile });
        if (input.leverage !== p.leverage) {
          // An entry remainder was reserved at the old leverage and must not enlarge the edited position at that rate.
          for (const order of tx.state.orders.filter(o => o.positionId === p.id && activeOrder(o))) await cancelPrivateOrder(tx, order, `edit:${key}:${order.id}`);
        }
        const before = quoteOrderCost({ side: p.side, quantity: p.quantity, price: p.entryPrice, leverage: p.leverage, profile: p.profile });
        const after = quoteOrderCost({ side: p.side, quantity: p.quantity, price: p.entryPrice, leverage: input.leverage, profile: p.profile });
        delta = delta.plus(after.positionMargin).minus(before.positionMargin); p.leverage = input.leverage;
      }
      if (delta.gt(tx.available) || number(p.allocatedMargin).plus(delta).lte(0)) throw new PrivateTradingError('insufficient_margin', 'Недостаточно демо-маржи', 409);
      tx.available = tx.available.minus(delta); tx.reserved = tx.reserved.plus(delta);
      p.allocatedMargin = money(number(p.allocatedMargin).plus(delta)); p.initialMarginBasis = money(number(p.initialMarginBasis).plus(delta));
      p.takeProfit = next.takeProfit; p.stopLoss = next.stopLoss;
      updatePosition(p, quote);
      if (calculatePosition({ ...p }).liquidatable) throw new PrivateTradingError('unsafe_margin', 'Изменение маржи приведёт к ликвидации', 409);
      await tx.entry('MARGIN_CHANGE', money(delta), id, undefined, undefined, { positionId: id, leverage: p.leverage });
      tx.state.session = actor; return { position: this.positionDto(p) };
    }, () => { assertPrivateFreshQuote(quote, position.symbol); this.fundingStillCurrent(funding); });
  }
  async advance(actor: OwnerSession, id: string, asOf: string, key: string) {
    await this.store.authorized(actor);
    const prior = await this.store.db.privateTradingPreview.findFirst({ where: { userId: actor.userId, requestKey: key } });
    if (prior) {
      const request = prior.request as unknown as StoredRequest;
      if (request.advance?.id !== id || Date.parse(request.asOf ?? '') !== Date.parse(asOf)) throw new PrivateTradingError('idempotency_conflict', 'Параметры запроса изменились', 409);
      await this.store.authorized(actor);
      return this.previewDto(prior);
    }
    const account = await this.store.read(actor), scenario = account.state.scenarios.find(s => s.id === id);
    if (!scenario) throw new PrivateTradingError('not_found', 'Сценарий не найден', 404);
    if (scenario.result.status !== 'OPEN' || Date.parse(asOf) <= scenario.result.asOf) throw new PrivateTradingError('scenario_closed', 'Можно продолжить только открытый сценарий', 409);
    return this.preview(actor, { ...scenario.request, asOf, idempotencyKey: key }, { id, version: scenario.version });
  }
  async card(actor: OwnerSession, positionId: string) {
    const account = await this.store.read(actor), original = account.state.positions.find(x => x.id === positionId);
    let quote: PrivateFreshQuote | undefined, funding: FundingPlan | undefined;
    if (original?.status === 'OPEN') {
      funding = await this.fundingPlan(account.state.positions, original.symbol);
      quote = await this.data().freshQuote(original.symbol);
    }
    return this.store.transact(actor, null, {}, async tx => {
      const p = tx.state.positions.find(x => x.id === positionId) ?? tx.state.scenarios.find(x => x.id === positionId)?.position;
      if (!p || p.verification !== 'VERIFIED') throw new PrivateTradingError('not_found', 'Подтверждённая позиция не найдена', 404);
      if (p.mode === 'DEMO_LIVE' && p.status === 'OPEN') {
        if (!quote || !funding) throw new PrivateTradingError('position_changed', 'Обновите позицию', 409);
        await this.settleFunding(tx, funding); updatePosition(p, quote);
      }
      const id = randomUUID();
      const payload = { id, symbol: p.symbol, side: p.side, leverage: p.leverage, mode: p.mode, status: p.status,
        quantity: p.status === 'OPEN' ? p.quantity : p.initialQuantity,
        pnl: p.mode === 'HISTORICAL_REPLAY' || p.status !== 'OPEN' ? p.netPnl : p.unrealizedPnl, netPnl: p.netPnl, unrealizedPnl: p.unrealizedPnl,
        roiPercent: p.roiPercent, entryPrice: p.entryPrice, valuationPrice: p.markPrice,
        usdPnl: null, asOf: p.asOf, label: p.mode === 'HISTORICAL_REPLAY' ? 'Исторический тест' : 'Симуляция',
        pnlKind: p.mode === 'HISTORICAL_REPLAY' ? 'NET_SCENARIO' : p.status === 'OPEN' ? 'UNREALIZED' : 'NET_REALIZED', pricingModelVersion: p.profile.pricingModelVersion,
      };
      if (await tx.db.privateTradingCard.count({ where: { userId: actor.userId } }) >= 2000) throw new PrivateTradingError('card_limit', 'Достигнут лимит сохранённых карточек', 409);
      await tx.db.privateTradingCard.create({ data: { id, userId: actor.userId, payload: json(payload) } });
      return payload;
    }, () => { if (quote) assertPrivateFreshQuote(quote, quote.symbol); if (funding) this.fundingStillCurrent(funding); });
  }
  async getCard(actor: OwnerSession, id: string) {
    await this.store.authorized(actor);
    const card = await this.store.db.privateTradingCard.findFirst({ where: { id, userId: actor.userId } });
    if (!card) throw new PrivateTradingError('not_found', 'Карточка не найдена', 404);
    await this.store.authorized(actor);
    return card.payload;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch(() => {}); }, 3_000); this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; for (const job of this.jobs.values()) job.abort(); }
  async tick() {
    if (!this.store.config().enabled || !this.store.config().ownerId) { for (const job of this.jobs.values()) job.abort(); return; }
    if (this.ticking) return;
    this.ticking = true;
    try {
      const account = await this.store.db.privateTradingAccount.findUnique({ where: { userId: this.store.config().ownerId } });
      if (!account) return;
      const state = account.state as any, actor = state.session as OwnerSession | null;
      if (!actor) return;
      await this.store.authorized(actor);
      const pending = await this.store.db.privateTradingPreview.findMany({ where: { userId: actor.userId, status: 'RUNNING' }, take: 1 });
      if (pending[0]) void this.runPreview(pending[0].id);
      const symbols = [...new Set<string>([...state.positions.filter((p: PrivatePosition) => p.status === 'OPEN').map((p: PrivatePosition) => p.symbol), ...state.orders.filter(activeOrder).map((o: PrivateOrder) => o.symbol)])];
      // New accounts are capped at four active contracts. Round-robin also drains any older oversized state.
      const batch = symbols.length ? Array.from({ length: Math.min(4, symbols.length) }, (_, i) => symbols[(this.nextSymbol + i) % symbols.length]) : [];
      this.nextSymbol = symbols.length ? (this.nextSymbol + batch.length) % symbols.length : 0;
      const plans = await Promise.all(batch.map(async symbol => {
        try {
          return { symbol, funding: await this.fundingPlan(state.positions, symbol) };
        } catch { this.unavailableSymbols.add(symbol); return null; }
      }));
      // Fetch depth after all funding loads, preserving the full freshness window for the one account lock.
      const snapshots = await Promise.all(plans.map(async plan => {
        if (!plan) return null;
        try { return { ...plan, quote: await this.data().freshQuote(plan.symbol) }; }
        catch { this.unavailableSymbols.add(plan.symbol); return null; }
      }));
      const prepared = snapshots.filter((snapshot): snapshot is NonNullable<typeof snapshot> => {
        if (!snapshot) return false;
        try { assertPrivateFreshQuote(snapshot.quote, snapshot.symbol); this.fundingStillCurrent(snapshot.funding); return true; }
        catch { this.unavailableSymbols.add(snapshot.symbol); return false; }
      });
      if (!prepared.length) return;
      const healthy = new Set<string>();
      try {
        await this.store.transact(actor, null, {}, async tx => {
          for (const { symbol, quote, funding } of prepared) {
            assertPrivateFreshQuote(quote, symbol); this.fundingStillCurrent(funding);
            if (!await this.stageEngineAction(tx, candidate => this.settleFunding(candidate, funding))) continue;
            let riskReady = true;
            const blockedPositions = new Set<string>();
            for (const id of tx.state.positions.filter(p => p.status === 'OPEN' && p.symbol === symbol).map(p => p.id)) {
              const success = await this.stageEngineAction(tx, async candidate => {
                const p = candidate.state.positions.find(p => p.id === id)!;
                const metric = updatePosition(p, quote)!;
                if (metric.liquidatable) await closePrivatePosition(candidate, p, p.quantity, quote, 'LIQUIDATION');
                else if (p.takeProfit && (p.side === 'LONG' ? number(quote.markPrice).gte(p.takeProfit) : number(quote.markPrice).lte(p.takeProfit))) await closePrivatePosition(candidate, p, p.quantity, quote, 'TAKE_PROFIT');
                else if (p.stopLoss && (p.side === 'LONG' ? number(quote.markPrice).lte(p.stopLoss) : number(quote.markPrice).gte(p.stopLoss))) await closePrivatePosition(candidate, p, p.quantity, quote, 'STOP_LOSS');
              });
              if (!success) { riskReady = false; blockedPositions.add(id); }
            }
            for (const id of tx.state.orders.filter(o => activeOrder(o) && o.symbol === symbol && !blockedPositions.has(o.positionId)).map(o => o.id)) {
              await this.stageEngineAction(tx, async candidate => { await fillPrivateOrder(candidate, candidate.state.orders.find(o => o.id === id)!, quote); });
            }
            if (riskReady) healthy.add(symbol);
          }
          return { ok: true };
        }, () => { for (const { symbol, quote, funding } of prepared) { assertPrivateFreshQuote(quote, symbol); this.fundingStillCurrent(funding); } });
        for (const { symbol } of prepared) {
          if (healthy.has(symbol)) this.unavailableSymbols.delete(symbol); else this.unavailableSymbols.add(symbol);
        }
      } catch { for (const { symbol } of prepared) this.unavailableSymbols.add(symbol); }
    } finally { this.ticking = false; }
  }
}
