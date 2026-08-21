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
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error?.toString?.() ?? `Request failed (${res.status})`, res.status);
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
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), contentType: blob.type };
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

  getDepositChains: () =>
    request<{ chain: string; nativeAsset: string; tokens: string[] }[]>('/deposit-chains'),

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

  getMyOrders: (status?: string) =>
    request<
      {
        id: string;
        pair: string;
        side: 'BUY' | 'SELL';
        type: string;
        price: string | null;
        originalQuantity: string;
        remainingQuantity: string;
        status: string;
        createdAt: string;
      }[]
    >(`/orders/me${status ? `?status=${status}` : ''}`),

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
};

function pairToSlug(pair: string): string {
  return pair.replace('/', '-');
}

export { ApiError };
