const TOKEN_KEY = 'exchange_token';

// On the docker-compose/VPS setup, Caddy serves frontend and backend under
// the SAME domain, so a relative '/api/v1' path works. On platforms like
// Render, the frontend and backend end up on different subdomains — set
// VITE_API_URL (at build time) to the backend's full URL + /api/v1 in that
// case. Falls back to the relative path when unset, so nothing changes for
// the single-domain deployment.
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// RequireAuth (App.tsx) only checks whether a token is PRESENT in
// localStorage, not whether it's still valid — that's a cheap, synchronous
// check made before any network round-trip. So an expired/stale token
// (session timeout, or the token was issued against a server that's since
// restarted) leaves the SPA rendering as "logged in" while every API call
// underneath silently 401s — confusing, since nothing on screen explains
// why buttons stop doing anything. Only applies when a token was actually
// attached to THIS request: a wrong-password 401 on /auth/login has no
// token to invalidate and must surface as a normal form error instead.
function handleUnauthorized(status: number, hadToken: boolean) {
  if (status === 401 && hadToken) {
    clearToken();
    window.location.href = '/';
  }
}

// Validation failures come back as Zod's error.flatten() shape
// ({formErrors, fieldErrors}), not a plain string — a bare `.toString()`
// on that object collapses to the useless "[object Object]". Pull the
// actual issue text out instead; a plain string error still passes through.
function extractErrorMessage(body: any, status: number): string {
  const err = body?.error;
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object') {
    const messages: string[] = [
      ...(Array.isArray(err.formErrors) ? err.formErrors : []),
      ...(err.fieldErrors && typeof err.fieldErrors === 'object'
        ? Object.values(err.fieldErrors).flatMap((v) => (Array.isArray(v) ? (v as string[]) : []))
        : []),
    ];
    if (messages.length > 0) return messages.join('; ');
  }
  return `Request failed (${status})`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    handleUnauthorized(res.status, !!token);
    const body = await res.json().catch(() => ({}));
    throw new ApiError(extractErrorMessage(body, res.status), res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Like request(), but for multipart/form-data (file uploads) — the browser
// sets the Content-Type boundary itself, so it must NOT be set manually.
async function requestForm<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  });
  if (!res.ok) {
    handleUnauthorized(res.status, !!token);
    const body = await res.json().catch(() => ({}));
    throw new ApiError(extractErrorMessage(body, res.status), res.status);
  }
  return res.json();
}

// Fetches an authenticated binary resource (KYC document image) and hands
// back an object URL the caller must revoke when done with it, plus its
// content type (object URLs don't carry a file extension to sniff).
async function requestBlobUrl(path: string): Promise<{ url: string; contentType: string }> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) {
    handleUnauthorized(res.status, !!token);
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), contentType: blob.type };
}

export const api = {
  register: (email: string, password: string) =>
    request<{ token: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    request<{ token: string } | { requires2fa: true; pendingToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  loginWith2FA: (pendingToken: string, code: string) =>
    request<{ token: string }>('/auth/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, code }),
    }),

  getOrderBook: (pair: string) =>
    request<{
      pair: string;
      bids: { price: string; quantity: string; orders: number }[];
      asks: { price: string; quantity: string; orders: number }[];
      timestamp: number;
    }>(`/orderbook/${pair}`),

  placeOrder: (params: {
    pair: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET' | 'STOP_LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_LIMIT' | 'TAKE_PROFIT_MARKET';
    price?: string;
    triggerPrice?: string;
    quantity: string;
  }) => request('/orders', { method: 'POST', body: JSON.stringify(params) }),

  placeOcoOrder: (params: {
    pair: string;
    side: 'BUY' | 'SELL';
    quantity: string;
    takeProfitPrice: string;
    stopTriggerPrice: string;
    stopLimitPrice: string;
  }) =>
    request<{ ocoGroupId: string; takeProfitOrderId: string; stopOrderId: string }>('/orders/oco', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  cancelOrder: (orderId: string) => request(`/orders/${orderId}`, { method: 'DELETE' }),

  // Moves a still-pending SL/TP order's trigger (and execution) price —
  // powers dragging its line on the chart.
  updateOrderTrigger: (orderId: string, params: { triggerPrice?: string; price?: string }) =>
    request<{ id: string; triggerPrice: string; price: string | null }>(`/orders/${orderId}/trigger`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    }),

  getCandles: (pair: string, interval: string, limit = 200) =>
    request<{
      pair: string;
      interval: string;
      candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
    }>(`/candles/${pair}?interval=${interval}&limit=${limit}`),

  getBalances: () => request<{ asset: string; available: string; locked: string }[]>('/balances'),

  getProducts: () =>
    request<{ id: string; name: string; description: string; priceAmount: string; priceAsset: string }[]>(
      '/products'
    ),

  purchaseProduct: (productId: string) =>
    request<{ id: string; status: string; amount: string; asset: string }>('/purchases', {
      method: 'POST',
      body: JSON.stringify({ productId }),
    }),

  getMyPurchases: () =>
    request<{ id: string; productName: string; amount: string; asset: string; status: string; createdAt: string }[]>(
      '/purchases/me'
    ),

  getDepositChains: () =>
    request<{ chain: string; nativeAsset: string; tokens: string[] }[]>('/deposit-chains'),

  getDepositAddress: (chain: string) =>
    request<{ chain: string; address: string; supportedAssets: string[]; note: string }>(
      `/deposit-address/${chain}`
    ),

  getMyDeposits: () =>
    request<
      {
        id: string;
        asset: string;
        chain: string;
        txHash: string;
        amount: string;
        confirmations: number;
        status: string;
        createdAt: string;
      }[]
    >('/deposits/me'),

  // Read-only mirror of Kraken market data — coin list, price, order book.
  getExternalSymbols: () =>
    request<{ source: string; symbols: { pair: string; baseAsset: string; quoteAsset: string }[] }>(
      '/market/external/symbols'
    ),

  // Top-200-by-market-cap coins from CoinGecko: rank, category tags, and
  // each coin's own real market-wide price/24h change/volume/market cap/7d
  // sparkline (not our own Kraken-mirrored turnover) — layered on top of
  // the real Kraken pair list above, never a source of tradable pairs by
  // itself. Powers the category filters, the rank badge, and the Wallet
  // page's full coin browser (which lists every one of these regardless
  // of whether the account holds any).
  getExternalRankings: () =>
    request<{
      source: string;
      rankings: {
        symbol: string;
        rank: number;
        name: string;
        image: string;
        categories: string[];
        price: number;
        changePercent24h: number | null;
        volume24h: number;
        marketCap: number | null;
        sparkline: number[];
      }[];
    }>('/market/external/rankings'),

  getExternalTickers: () =>
    request<{
      source: string;
      tickers: {
        pair: string;
        lastPrice: string;
        bidPrice: string;
        askPrice: string;
        high24h: string;
        low24h: string;
        volume24h: string;
        quoteVolume24h: string;
        changePercent24h: string;
      }[];
    }>('/market/external/tickers'),

  getExternalTicker: (pair: string) =>
    request<{
      source: string;
      ticker: {
        pair: string;
        lastPrice: string;
        bidPrice: string;
        askPrice: string;
        high24h: string;
        low24h: string;
        volume24h: string;
        quoteVolume24h: string;
        changePercent24h: string;
      };
    }>(`/market/external/tickers/${pairToSlug(pair)}`),

  getExternalOrderBook: (pair: string, limit = 10) =>
    request<{
      pair: string;
      bids: { price: string; quantity: string }[];
      asks: { price: string; quantity: string }[];
      timestamp: number;
    }>(`/market/external/orderbook/${pairToSlug(pair)}?limit=${limit}`),

  getExternalCandles: (pair: string, interval: string, limit = 300) =>
    request<{
      pair: string;
      interval: string;
      candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
    }>(`/market/external/candles/${pairToSlug(pair)}?interval=${interval}&limit=${limit}`),

  getExternalTrades: (pair: string, limit = 60) =>
    request<{
      pair: string;
      trades: { id: string; price: string; quantity: string; side: 'BUY' | 'SELL'; time: number }[];
    }>(`/market/external/trades/${pairToSlug(pair)}?limit=${limit}`),

  // Account
  getMe: () =>
    request<{
      id: string;
      email: string;
      isAdmin: boolean;
      kycStatus: 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
      twoFactorEnabled: boolean;
      createdAt: string;
    }>('/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ status: string }>('/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  getSecurityLog: () =>
    request<
      { id: string; action: string; createdAt: string; metadata: { ip?: string | null; userAgent?: string | null } }[]
    >('/account/security-log'),

  getReserves: () =>
    request<
      {
        chain: string;
        asset: string;
        treasuryAddress: string;
        internalLiabilities: string;
        onChainBalance: string | null;
        coverageRatio: number | null;
        error?: string;
      }[]
    >('/reserves'),

  setup2FA: () =>
    request<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }>('/account/2fa/setup', { method: 'POST' }),

  verify2FA: (code: string) =>
    request<{ status: string; backupCodes: string[] }>('/account/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  disable2FA: (code: string) =>
    request<{ status: string }>('/account/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),

  getMyOrders: (status?: string) =>
    request<
      {
        id: string;
        pair: string;
        side: 'BUY' | 'SELL';
        type: string;
        price: string | null;
        triggerPrice: string | null;
        ocoGroupId: string | null;
        originalQuantity: string;
        remainingQuantity: string;
        status: string;
        createdAt: string;
      }[]
    >(`/orders/me${status ? `?status=${status}` : ''}`),

  getMyTrades: (pair?: string) =>
    request<
      { id: string; pair: string; side: 'BUY' | 'SELL'; price: string; quantity: string; executedAt: string }[]
    >(`/trades/me${pair ? `?pair=${encodeURIComponent(pair)}` : ''}`),

  // KYC verification
  submitKyc: (fields: {
    country: string;
    fullName: string;
    dateOfBirth: string;
    documentType: 'PASSPORT' | 'ID_CARD' | 'DRIVERS_LICENSE';
    documentNumber: string;
    document: File;
  }) => {
    const form = new FormData();
    form.append('country', fields.country);
    form.append('fullName', fields.fullName);
    form.append('dateOfBirth', fields.dateOfBirth);
    form.append('documentType', fields.documentType);
    form.append('documentNumber', fields.documentNumber);
    form.append('document', fields.document);
    return requestForm<{ id: string; status: string }>('/kyc/submit', form);
  },

  getMyKyc: () =>
    request<{
      kycStatus: 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
      latestSubmission: {
        id: string;
        country: string;
        fullName: string;
        documentType: string;
        status: string;
        rejectionReason: string | null;
        createdAt: string;
      } | null;
    }>('/kyc/me'),

  // Admin: every client with their latest KYC submission (if any)
  getAllClients: () =>
    request<
      {
        id: string;
        email: string;
        isAdmin: boolean;
        kycStatus: 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
        createdAt: string;
        latestKyc: {
          id: string;
          country: string;
          fullName: string;
          dateOfBirth: string;
          documentType: string;
          documentNumber: string;
          status: string;
          rejectionReason: string | null;
          createdAt: string;
        } | null;
      }[]
    >('/admin/clients'),

  getKycDocument: (submissionId: string) => requestBlobUrl(`/kyc/${submissionId}/document`),

  // Admin: manual deposit crediting — replaces asking the client for a tx
  // hash. See src/api/routes/adminDeposits.ts.
  getAdminDeposits: () =>
    request<
      {
        id: string;
        userId: string;
        userEmail: string;
        asset: string;
        chain: string;
        txHash: string;
        amount: string;
        confirmations: number;
        status: string;
        createdAt: string;
      }[]
    >('/admin/deposits'),

  getAdminIncomingDeposits: () =>
    request<{ chain: string; txHash: string; asset: string; amount: string; confirmations: number }[]>(
      '/admin/deposits/incoming'
    ),

  creditDepositManually: (params: { userId: string; chain: string; txHash: string; asset: string }) =>
    request<{ status: string; amount: string; confirmations: number; minDepositUsd?: number }>(
      '/admin/deposits/manual-credit',
      { method: 'POST', body: JSON.stringify(params) }
    ),

  reviewKyc: (submissionId: string, approve: boolean, reason?: string) =>
    request<{ status: string }>(`/kyc/${submissionId}/review`, {
      method: 'POST',
      body: JSON.stringify({ approve, reason }),
    }),

  // Crypto card waitlist (card doesn't exist yet — see CardPage)
  getCardWaitlist: () =>
    request<{
      joined: boolean;
      joinedAt: string | null;
      kycStatus: 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
    }>('/card/waitlist/me'),

  joinCardWaitlist: () =>
    request<{ joined: boolean; joinedAt: string }>('/card/waitlist/join', { method: 'POST' }),

  // API keys for connecting a trading bot/script
  getApiKeys: () =>
    request<
      { id: string; label: string; apiKey: string; canTrade: boolean; lastUsedAt: string | null; createdAt: string }[]
    >('/api-keys'),

  createApiKey: (label: string, canTrade: boolean) =>
    request<{ id: string; label: string; apiKey: string; apiSecret: string; canTrade: boolean; createdAt: string }>(
      '/api-keys',
      { method: 'POST', body: JSON.stringify({ label, canTrade }) }
    ),

  revokeApiKey: (id: string) => request<void>(`/api-keys/${id}`, { method: 'DELETE' }),

  // Perpetual futures — fully separate wallet/orders/positions from spot
  // (see the backend's FuturesBalance/FuturesOrder schema comments).
  getFuturesConfig: () =>
    request<{
      symbols: string[];
      minLeverage: number;
      maxLeverage: number;
      newAccountMaxLeverage: number;
      newAccountPeriodDays: number;
      highLeverageWarningThreshold: number;
      leverageTiers: { notionalCap: number; maxLeverage: number; maintenanceMarginRate: number; maintenanceAmount: number }[];
    }>('/futures/config'),

  getFuturesRiskAck: () =>
    request<{ acknowledged: boolean; acknowledgedAt: string | null }>('/futures/risk-ack'),

  acknowledgeFuturesRisk: () =>
    request<{ acknowledged: boolean; acknowledgedAt: string }>('/futures/risk-ack', { method: 'POST' }),

  placeFuturesOrder: (params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    price?: string;
    quantity: string;
    leverage: number;
    marginType: 'ISOLATED' | 'CROSS';
    reduceOnly?: boolean;
  }) => request('/futures/orders', { method: 'POST', body: JSON.stringify(params) }),

  cancelFuturesOrder: (orderId: string) => request(`/futures/orders/${orderId}`, { method: 'DELETE' }),

  getMyFuturesOrders: (status?: string) =>
    request<
      {
        id: string;
        symbol: string;
        side: 'BUY' | 'SELL';
        type: string;
        price: string | null;
        originalQuantity: string;
        remainingQuantity: string;
        status: string;
        reduceOnly: boolean;
        leverage: number;
        marginType: 'ISOLATED' | 'CROSS';
        createdAt: string;
      }[]
    >(`/futures/orders/me${status ? `?status=${status}` : ''}`),

  getFuturesPositions: () =>
    request<
      {
        id: string;
        symbol: string;
        side: 'LONG' | 'SHORT';
        size: string;
        entryPrice: string;
        leverage: number;
        marginType: 'ISOLATED' | 'CROSS';
        initialMargin: string;
        liquidationPrice: string;
        markPrice: string | null;
        unrealizedPnl: string | null;
        roe: string | null;
        openedAt: string;
      }[]
    >('/futures/positions'),

  getFuturesPositionHistory: () =>
    request<
      {
        id: string;
        symbol: string;
        side: 'LONG' | 'SHORT';
        leverage: number;
        marginType: 'ISOLATED' | 'CROSS';
        entryPrice: string;
        realizedPnl: string;
        status: string;
        openedAt: string;
        closedAt: string | null;
      }[]
    >('/futures/positions/history'),

  closeFuturesPosition: (positionId: string) => request(`/futures/positions/${positionId}/close`, { method: 'POST' }),

  getFuturesBalances: () => request<{ asset: string; available: string; locked: string }[]>('/futures/balances'),

  transferFuturesFunds: (asset: string, amount: string, direction: 'TO_FUTURES' | 'TO_SPOT') =>
    request<{ status: string }>('/futures/transfer', { method: 'POST', body: JSON.stringify({ asset, amount, direction }) }),

  getFuturesMarkPrice: (symbol: string) =>
    request<{ symbol: string; markPrice: string; indexPrice: string }>(`/futures/mark-price/${pairToSlug(symbol)}`),

  getFuturesFundingRate: (symbol: string, limit = 10) =>
    request<{
      symbol: string;
      history: { rate: string; markPrice: string; indexPrice: string; appliedAt: string }[];
    }>(`/futures/funding-rate/${pairToSlug(symbol)}?limit=${limit}`),

  getFuturesOrderBook: (symbol: string) =>
    request<{
      pair: string;
      bids: { price: string; quantity: string; orders: number }[];
      asks: { price: string; quantity: string; orders: number }[];
      timestamp: number;
    }>(`/futures/orderbook/${pairToSlug(symbol)}`),

  // Live-chat support widget
  startSupportConversation: (name: string, email: string, subject: SupportSubject, message: string) =>
    request<SupportConversation & { messages: SupportMessage[] }>('/support/conversations', {
      method: 'POST',
      body: JSON.stringify({ name, email, subject, message }),
    }),

  getMySupportConversation: () =>
    request<{ conversation: (SupportConversation & { messages: SupportMessage[] }) | null }>(
      '/support/conversations/mine'
    ),

  getSupportConversation: (id: string) =>
    request<{ conversation: SupportConversation; messages: SupportMessage[] }>(`/support/conversations/${id}`),

  getSupportConversationStatus: (id: string) =>
    request<{ unreadByUser: boolean }>(`/support/conversations/${id}/status`),

  sendSupportMessage: (id: string, body: string) =>
    request<SupportMessage>(`/support/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  markSupportConversationRead: (id: string) => request<void>(`/support/conversations/${id}/read`, { method: 'POST' }),
};

export type SupportSubject = 'TECHNICAL' | 'KYC' | 'CARD' | 'OTHER';

export interface SupportMessage {
  id: string;
  sender: 'USER' | 'ADMIN';
  body: string;
  createdAt: string;
}

export interface SupportConversation {
  id: string;
  userId: string | null;
  guestName: string;
  guestEmail: string;
  subject: SupportSubject;
  unreadByUser: boolean;
  createdAt: string;
  updatedAt: string;
}

function pairToSlug(pair: string): string {
  return pair.replace('/', '-');
}

export { ApiError };
