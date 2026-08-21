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
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error?.toString?.() ?? `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  register: (email: string, password: string) =>
    request<{ token: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    request<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  getOrderBook: (pair: string) =>
    request<{
      pair: string;
      bids: { price: string; quantity: string; orders: number }[];
      asks: { price: string; quantity: string; orders: number }[];
      timestamp: number;
    }>(`/orderbook/${pair}`),

  placeOrder: (params: { pair: string; side: 'BUY' | 'SELL'; price: string; quantity: string }) =>
    request('/orders', { method: 'POST', body: JSON.stringify(params) }),

  cancelOrder: (orderId: string) => request(`/orders/${orderId}`, { method: 'DELETE' }),

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

  getDepositAddress: (chain: string) =>
    request<{ chain: string; address: string; supportedAssets: string[]; note: string }>(
      `/deposit-address/${chain}`
    ),

  claimDeposit: (chain: string, txHash: string, asset: string) =>
    request<{ status: string; amount: string; confirmations: number }>(`/deposits/claim/${chain}`, {
      method: 'POST',
      body: JSON.stringify({ txHash, asset }),
    }),

  // Read-only mirror of Bybit market data — coin list, price, order book.
  getExternalSymbols: () =>
    request<{ source: string; symbols: { pair: string; baseAsset: string; quoteAsset: string }[] }>(
      '/market/external/symbols'
    ),

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
        changePercent24h: string;
      }[];
    }>('/market/external/tickers'),

  getExternalOrderBook: (pair: string) =>
    request<{
      pair: string;
      bids: { price: string; quantity: string }[];
      asks: { price: string; quantity: string }[];
      timestamp: number;
    }>(`/market/external/orderbook/${pairToSlug(pair)}`),
};

function pairToSlug(pair: string): string {
  return pair.replace('/', '-');
}

export { ApiError };
