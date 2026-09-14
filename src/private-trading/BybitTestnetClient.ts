import { createHmac, randomUUID } from 'crypto';

const TESTNET_ORIGIN = 'https://api-testnet.bybit.com';
const RECV_WINDOW = '5000';
const DECIMAL = /^\d{1,24}(?:\.\d{1,24})?$/;
const SYMBOL = /^[A-Z0-9]{2,32}USDT$/;

export class BybitTestnetError extends Error {
  constructor(public code: string, message: string, public status = 502) {
    super(message);
    this.name = 'BybitTestnetError';
  }
}

interface BybitEnvelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
  time?: number;
}

export interface BybitTestnetPosition {
  symbol: string;
  side: 'Buy' | 'Sell';
  size: string;
  avgPrice: string;
  markPrice: string;
  liqPrice: string;
  leverage: string;
  unrealisedPnl: string;
  cumRealisedPnl: string;
  positionValue: string;
  positionIM: string;
  positionMM: string;
  positionIdx: number;
  tradeMode?: number;
  updatedTime?: string;
}

export interface BybitTestnetOrder {
  orderId: string;
  orderLinkId: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType: 'Market' | 'Limit' | string;
  price: string;
  qty: string;
  avgPrice: string;
  orderStatus: string;
  leavesQty: string;
  cumExecQty: string;
  reduceOnly: boolean;
  createdTime: string;
  updatedTime: string;
}

export interface BybitTestnetState {
  source: 'BYBIT_TESTNET';
  fetchedAt: number;
  wallet: {
    accountType: string;
    totalEquity: string;
    totalWalletBalance: string;
    totalMarginBalance: string;
    totalAvailableBalance: string;
    totalPerpUPL: string;
    coins: Array<{ coin: string; equity: string; walletBalance: string; usdValue: string; unrealisedPnl: string; locked: string }>;
  } | null;
  positions: BybitTestnetPosition[];
  openOrders: BybitTestnetOrder[];
  orderHistory: BybitTestnetOrder[];
  closedPnl: Array<{ symbol: string; orderId: string; side: string; qty: string; avgEntryPrice: string; avgExitPrice: string; closedPnl: string; openFee: string; closeFee: string; createdTime: string; updatedTime: string }>;
}

export interface BybitTestnetOrderRequest {
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType: 'Market' | 'Limit';
  qty: string;
  price?: string;
  leverage?: string;
  takeProfit?: string;
  stopLoss?: string;
  reduceOnly?: boolean;
}

function cleanDecimal(value: string, field: string): string {
  if (!DECIMAL.test(value) || Number(value) <= 0 || !Number.isFinite(Number(value))) {
    throw new BybitTestnetError('invalid_request', `Некорректное значение ${field}`, 400);
  }
  return value;
}

function cleanSymbol(value: string): string {
  const symbol = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!SYMBOL.test(symbol)) throw new BybitTestnetError('invalid_symbol', 'Контракт не поддерживается', 400);
  return symbol;
}

export function bybitHmacSignature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export class BybitTestnetClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(
    credentials: { apiKey?: string; apiSecret?: string } = {},
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.apiKey = credentials.apiKey?.trim() ?? '';
    this.apiSecret = credentials.apiSecret?.trim() ?? '';
  }

  static fromEnv(request: typeof fetch = fetch): BybitTestnetClient {
    return new BybitTestnetClient({
      apiKey: process.env.BYBIT_TESTNET_API_KEY,
      apiSecret: process.env.BYBIT_TESTNET_API_SECRET,
    }, request);
  }

  get configured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  status() {
    return {
      configured: this.configured,
      source: 'BYBIT_TESTNET' as const,
      accountType: 'UNIFIED' as const,
      executionHost: 'api-testnet.bybit.com',
    };
  }

  private ensureConfigured(): void {
    if (!this.configured) throw new BybitTestnetError('testnet_not_configured', 'Bybit Testnet не подключён', 503);
  }

  private async signed<T>(method: 'GET' | 'POST', path: string, input: Record<string, unknown> = {}): Promise<T> {
    this.ensureConfigured();
    const timestamp = String(this.now());
    const entries = Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b));
    const params = new URLSearchParams();
    for (const [name, value] of entries) params.append(name, String(value));
    const query = method === 'GET' ? params.toString() : '';
    const body = method === 'POST' ? JSON.stringify(Object.fromEntries(entries)) : '';
    const plaintext = `${timestamp}${this.apiKey}${RECV_WINDOW}${method === 'GET' ? query : body}`;
    const signature = bybitHmacSignature(this.apiSecret, plaintext);
    const url = `${TESTNET_ORIGIN}${path}${query ? `?${query}` : ''}`;
    let response: Response;
    try {
      response = await this.request(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
        headers: {
          'Content-Type': 'application/json',
          'X-BAPI-API-KEY': this.apiKey,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': RECV_WINDOW,
          'X-BAPI-SIGN': signature,
        },
        ...(method === 'POST' ? { body } : {}),
      });
    } catch {
      throw new BybitTestnetError('testnet_unreachable', 'Bybit Testnet временно недоступен', 503);
    }
    const envelope = await response.json().catch(() => null) as BybitEnvelope<T> | null;
    if (!response.ok || !envelope || typeof envelope.retCode !== 'number') {
      throw new BybitTestnetError('testnet_bad_response', 'Bybit Testnet вернул некорректный ответ', 502);
    }
    if (envelope.retCode !== 0) {
      const safeMessage = typeof envelope.retMsg === 'string' && envelope.retMsg.length <= 180 ? envelope.retMsg : 'Bybit Testnet отклонил запрос';
      throw new BybitTestnetError(`bybit_${envelope.retCode}`, safeMessage, envelope.retCode === 10003 || envelope.retCode === 10004 ? 503 : 409);
    }
    return envelope.result;
  }

  private get<T>(path: string, query: Record<string, unknown>): Promise<T> {
    return this.signed<T>('GET', path, query);
  }

  private post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.signed<T>('POST', path, body);
  }

  async state(): Promise<BybitTestnetState> {
    const [walletResult, positionsResult, openOrdersResult, historyResult, pnlResult] = await Promise.all([
      this.get<any>('/v5/account/wallet-balance', { accountType: 'UNIFIED' }),
      this.get<any>('/v5/position/list', { category: 'linear', settleCoin: 'USDT' }),
      this.get<any>('/v5/order/realtime', { category: 'linear', settleCoin: 'USDT', openOnly: 0, limit: 50 }),
      this.get<any>('/v5/order/history', { category: 'linear', settleCoin: 'USDT', limit: 50 }),
      this.get<any>('/v5/position/closed-pnl', { category: 'linear', limit: 50 }),
    ]);
    const wallet = Array.isArray(walletResult?.list) ? walletResult.list[0] : null;
    const normalizeOrder = (row: any): BybitTestnetOrder => ({
      orderId: String(row?.orderId ?? ''), orderLinkId: String(row?.orderLinkId ?? ''), symbol: String(row?.symbol ?? ''),
      side: row?.side === 'Sell' ? 'Sell' : 'Buy', orderType: String(row?.orderType ?? ''), price: String(row?.price ?? ''),
      qty: String(row?.qty ?? ''), avgPrice: String(row?.avgPrice ?? ''), orderStatus: String(row?.orderStatus ?? ''),
      leavesQty: String(row?.leavesQty ?? ''), cumExecQty: String(row?.cumExecQty ?? ''), reduceOnly: row?.reduceOnly === true,
      createdTime: String(row?.createdTime ?? ''), updatedTime: String(row?.updatedTime ?? ''),
    });
    return {
      source: 'BYBIT_TESTNET', fetchedAt: this.now(),
      wallet: wallet ? {
        accountType: String(wallet.accountType ?? 'UNIFIED'), totalEquity: String(wallet.totalEquity ?? ''),
        totalWalletBalance: String(wallet.totalWalletBalance ?? ''), totalMarginBalance: String(wallet.totalMarginBalance ?? ''),
        totalAvailableBalance: String(wallet.totalAvailableBalance ?? ''), totalPerpUPL: String(wallet.totalPerpUPL ?? ''),
        coins: (Array.isArray(wallet.coin) ? wallet.coin : []).map((coin: any) => ({
          coin: String(coin?.coin ?? ''), equity: String(coin?.equity ?? ''), walletBalance: String(coin?.walletBalance ?? ''),
          usdValue: String(coin?.usdValue ?? ''), unrealisedPnl: String(coin?.unrealisedPnl ?? ''), locked: String(coin?.locked ?? ''),
        })),
      } : null,
      positions: (Array.isArray(positionsResult?.list) ? positionsResult.list : [])
        .filter((row: any) => Number(row?.size) > 0)
        .map((row: any) => ({
          symbol: String(row?.symbol ?? ''), side: row?.side === 'Sell' ? 'Sell' : 'Buy', size: String(row?.size ?? ''),
          avgPrice: String(row?.avgPrice ?? ''), markPrice: String(row?.markPrice ?? ''), liqPrice: String(row?.liqPrice ?? ''),
          leverage: String(row?.leverage ?? ''), unrealisedPnl: String(row?.unrealisedPnl ?? ''), cumRealisedPnl: String(row?.cumRealisedPnl ?? ''),
          positionValue: String(row?.positionValue ?? ''), positionIM: String(row?.positionIM ?? ''), positionMM: String(row?.positionMM ?? ''),
          positionIdx: Number.isInteger(row?.positionIdx) ? row.positionIdx : 0, tradeMode: Number.isInteger(row?.tradeMode) ? row.tradeMode : undefined,
          updatedTime: row?.updatedTime === undefined ? undefined : String(row.updatedTime),
        })),
      openOrders: (Array.isArray(openOrdersResult?.list) ? openOrdersResult.list : []).map(normalizeOrder),
      orderHistory: (Array.isArray(historyResult?.list) ? historyResult.list : []).map(normalizeOrder),
      closedPnl: (Array.isArray(pnlResult?.list) ? pnlResult.list : []).map((row: any) => ({
        symbol: String(row?.symbol ?? ''), orderId: String(row?.orderId ?? ''), side: String(row?.side ?? ''), qty: String(row?.qty ?? ''),
        avgEntryPrice: String(row?.avgEntryPrice ?? ''), avgExitPrice: String(row?.avgExitPrice ?? ''), closedPnl: String(row?.closedPnl ?? ''),
        openFee: String(row?.openFee ?? ''), closeFee: String(row?.closeFee ?? ''), createdTime: String(row?.createdTime ?? ''), updatedTime: String(row?.updatedTime ?? ''),
      })),
    };
  }

  async setLeverage(symbolInput: string, leverageInput: string): Promise<{ symbol: string; leverage: string }> {
    const symbol = cleanSymbol(symbolInput);
    const leverage = cleanDecimal(leverageInput, 'плеча');
    await this.post('/v5/position/set-leverage', { category: 'linear', symbol, buyLeverage: leverage, sellLeverage: leverage });
    return { symbol, leverage };
  }

  async createOrder(input: BybitTestnetOrderRequest): Promise<{ orderId: string; orderLinkId: string }> {
    const symbol = cleanSymbol(input.symbol);
    const qty = cleanDecimal(input.qty, 'количества');
    if (input.leverage) await this.setLeverage(symbol, input.leverage);
    const price = input.orderType === 'Limit' ? cleanDecimal(input.price ?? '', 'цены') : undefined;
    const orderLinkId = `vx${randomUUID().replace(/-/g, '').slice(0, 30)}`;
    const result = await this.post<any>('/v5/order/create', {
      category: 'linear', symbol, side: input.side, orderType: input.orderType, qty, price,
      timeInForce: input.orderType === 'Limit' ? 'GTC' : undefined,
      positionIdx: 0, reduceOnly: input.reduceOnly === true, orderLinkId,
      takeProfit: input.takeProfit ? cleanDecimal(input.takeProfit, 'take-profit') : undefined,
      stopLoss: input.stopLoss ? cleanDecimal(input.stopLoss, 'stop-loss') : undefined,
    });
    return { orderId: String(result?.orderId ?? ''), orderLinkId: String(result?.orderLinkId ?? orderLinkId) };
  }

  async cancelOrder(symbolInput: string, orderId: string): Promise<{ orderId: string; orderLinkId: string }> {
    const symbol = cleanSymbol(symbolInput);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) throw new BybitTestnetError('invalid_order_id', 'Некорректный ID ордера', 400);
    const result = await this.post<any>('/v5/order/cancel', { category: 'linear', symbol, orderId });
    return { orderId: String(result?.orderId ?? orderId), orderLinkId: String(result?.orderLinkId ?? '') };
  }

  async closePosition(symbolInput: string, quantityInput?: string): Promise<{ orderId: string; orderLinkId: string }> {
    const symbol = cleanSymbol(symbolInput);
    const result = await this.get<any>('/v5/position/list', { category: 'linear', symbol });
    const row = (Array.isArray(result?.list) ? result.list : []).find((item: any) => Number(item?.size) > 0);
    if (!row) throw new BybitTestnetError('position_not_found', 'Открытая позиция не найдена', 404);
    const qty = cleanDecimal(quantityInput || String(row.size), 'количества');
    const side: 'Buy' | 'Sell' = row.side === 'Buy' ? 'Sell' : 'Buy';
    const orderLinkId = `vx${randomUUID().replace(/-/g, '').slice(0, 30)}`;
    const placed = await this.post<any>('/v5/order/create', {
      category: 'linear', symbol, side, orderType: 'Market', qty,
      positionIdx: Number.isInteger(row.positionIdx) ? row.positionIdx : 0,
      reduceOnly: true, orderLinkId,
    });
    return { orderId: String(placed?.orderId ?? ''), orderLinkId: String(placed?.orderLinkId ?? orderLinkId) };
  }
}
