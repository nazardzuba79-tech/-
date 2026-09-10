import type { SyntheticCopyTradingResponse } from './syntheticCopyTrading';
import type { CardApplicationSnapshot, CardProduct } from '../pages/crypto-card-final/cardApplicationState';

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
  notifySessionChange();
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  notifySessionChange();
}

/**
 * Session-change notification.
 *
 * Shared, module-level caches of AUTHENTICATED data outlive the components
 * that read them — a logout is a client-side route change, not a reload,
 * so nothing unmounts the module. Anything holding account data therefore
 * has to be told when the session changes, so it can drop what it holds
 * before the next user can see it.
 *
 * This only broadcasts; it does not touch the token, the request path or
 * any header. Listeners must not throw — one bad listener may not stop the
 * others from clearing their state.
 */
type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

export function onSessionChange(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function notifySessionChange() {
  for (const listener of Array.from(sessionListeners)) {
    try {
      listener();
    } catch {
      // A listener that fails must not prevent the rest from clearing.
    }
  }
}

/** The normalized spot ticker every VOLTEX surface renders. Shape is
 *  unchanged from what /market/external/tickers always returned; it is
 *  named here so the gateway store and the components share one type. */
export interface MarketTicker {
  pair: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  quoteVolume24h: string;
  /** Already a percentage value (e.g. "2.10" = +2.10%) — see
   *  lib/priceChange.ts. Never re-multiply by 100. */
  changePercent24h: string;
}

export interface GlobalMarketSnapshot {
  totalMarketCapUsd: number;
  totalVolume24hUsd: number;
  btcDominancePercent: number | null;
  ethDominancePercent: number | null;
  marketCapChangePercent24h: number | null;
}

/** A gateway section: real data with provenance, or an explicit absence
 *  carrying no value fields at all. */
export type GatewaySection<T> =
  | ({ available: true; value: T } & { source: string; fetchedAt: number; stale: boolean })
  | { available: false; reason: string; detail?: string };

export interface MarketSnapshotResponse {
  tickers: GatewaySection<MarketTicker[]>;
  overview: GatewaySection<GlobalMarketSnapshot>;
  sentiment: GatewaySection<{ value: number; classification: string; updatedAt: number }>;
}

// ── Analytics ──────────────────────────────────────────────────────

export interface AnalyticsMarketOverview {
  totalMarketCapUsd: number;
  totalVolume24hUsd: number;
  btcDominancePercent: number | null;
  ethDominancePercent: number | null;
  marketCapChangePercent24h: number | null;
}

export interface AnalyticsSentiment {
  value: number;
  classification: string;
  updatedAt: number;
}

/** One VOLTEX contract. Every field is independently nullable — a missing
 *  figure is `null` and renders as a dash, never as 0. */
export interface AnalyticsContract {
  symbol: string;
  markPrice: string | null;
  indexPrice: string | null;
  openInterestBase: string | null;
  openInterestUsd: string | null;
  fundingRate: string | null;
  fundingAppliedAt: number | null;
}

export interface AnalyticsDerivatives {
  /** Always 'venue'. This is VOLTEX's own book, never market-wide. */
  scope: 'venue';
  intervalHours: number;
  nextSettlementAt: number;
  contracts: AnalyticsContract[];
}

/** An external derivatives venue. Never VOLTEX. */
export type DerivativesVenue = 'binance' | 'okx';

/** Which venues actually produced a multi-venue figure. The UI's source
 *  label is derived from THIS, so it can never keep naming a venue that
 *  was down when the number was assembled. */
export interface VenueAttribution {
  venue: DerivativesVenue;
  contract: string;
  fetchedAt: number;
  stale: boolean;
}

export type MultiVenueSection<T> = GatewaySection<T> & { venues?: VenueAttribution[] };

export interface VenueOpenInterest {
  venue: DerivativesVenue;
  contract: string;
  baseAsset: string;
  openInterestBase: number | null;
  openInterestUsd: number | null;
  fetchedAt: number;
  stale: boolean;
}

/** Tracked venues, NOT the whole market — see the venue list. */
export interface AnalyticsTrackedOpenInterest {
  baseAsset: string;
  totalOpenInterestUsd: number | null;
  venues: VenueOpenInterest[];
}

export interface VenueFunding {
  venue: DerivativesVenue;
  contract: string;
  /** A fraction. A real 0 is flat funding; `null` is unreported. */
  fundingRate: number | null;
  nextFundingTime: number | null;
  intervalHours: number | null;
  fetchedAt: number;
  stale: boolean;
}

export interface AnalyticsFundingComparison {
  baseAsset: string;
  venues: VenueFunding[];
}

export interface VenueBasis {
  venue: DerivativesVenue;
  contract: string;
  markPrice: number | null;
  indexPrice: number | null;
  /** (mark - index) / index, as a percentage. */
  basisPercent: number | null;
  fetchedAt: number;
  stale: boolean;
}

export interface AnalyticsBasisComparison {
  baseAsset: string;
  venues: VenueBasis[];
}

/** Three DIFFERENT measures. Never merged into one ratio. */
export type LongShortRatioKind = 'global_account' | 'top_account' | 'top_position';

export interface LongShortRatio {
  venue: DerivativesVenue;
  contract: string;
  kind: LongShortRatioKind;
  longAccount: number | null;
  shortAccount: number | null;
  longShortRatio: number | null;
  period: string;
  observedAt: number | null;
  fetchedAt: number;
  stale: boolean;
}

/** Tracked-venue derivatives statistics for one base asset — the two
 *  figures the Futures header shows as market reference data. */
/** One armed futures protective trigger, exactly as the server holds it. */
export interface FuturesProtectionTrigger {
  id: string;
  kind: 'TAKE_PROFIT' | 'STOP_LOSS';
  triggerPrice: string;
  /** PENDING | TRIGGERING | EXECUTED | CANCELLED | FAILED. */
  status: string;
  /** Why the last attempt failed, when it did. Protection is not dropped on
   *  a failure — a FAILED trigger is retried while the position is open. */
  lastError: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface FuturesPositionProtection {
  positionId: string;
  takeProfit: FuturesProtectionTrigger | null;
  stopLoss: FuturesProtectionTrigger | null;
}

export interface FuturesMarketStats {
  baseAsset: string;
  /** Summed over the venues that publish a comparable quote turnover.
   *  `null` means none did — never zero turnover. */
  turnover24hUsd: number | null;
  turnoverVenues: DerivativesVenue[];
  /** Summed BASE units, only across venues reporting base units. */
  openInterestBase: number | null;
  openInterestUsd: number | null;
  /** Contributors per metric: they genuinely differ, and a base figure
   *  must be credited to the venues that supplied base units. */
  openInterestBaseVenues: DerivativesVenue[];
  openInterestUsdVenues: DerivativesVenue[];
}

export interface AnalyticsPositioning {
  baseAsset: string;
  ratios: LongShortRatio[];
}

export interface AnalyticsVolatilityWindow {
  window: '24h' | '7d' | '30d';
  /** Annualized realized volatility in percent; null when the window had
   *  too few real observations. Never 0 as a stand-in. */
  annualizedPercent: number | null;
  samples: number;
}

export interface AnalyticsRealizedVolatility {
  baseAsset: string;
  pair: string;
  interval: string;
  method: 'log_return_stddev_annualized';
  windows: AnalyticsVolatilityWindow[];
}

export interface AnalyticsCorrelationPair {
  a: string;
  b: string;
  correlation: number;
  samples: number;
}

export interface AnalyticsCorrelations {
  assets: string[];
  interval: string;
  lookbackHours: number;
  pairs: AnalyticsCorrelationPair[];
  method: 'pearson_log_returns';
}

export interface AnalyticsSectorPerformance {
  category: string;
  changePercent24h: number;
  /** Constituents that actually reported a return. */
  constituents: number;
  weighting: 'market_cap' | 'equal';
}

export interface AnalyticsSectorRotation {
  window: '24h';
  sectors: AnalyticsSectorPerformance[];
  universe: number;
}

export interface AnalyticsSnapshot {
  generatedAt: number;
  /** Contracts VOLTEX actually lists — the asset selector is built from
   *  this, never from a hardcoded list. */
  contracts: string[];
  /** Base assets the external/derived modules cover. */
  trackedAssets: string[];
  selectedAsset: string | null;
  sections: {
    marketOverview: GatewaySection<AnalyticsMarketOverview>;
    sentiment: GatewaySection<AnalyticsSentiment>;
    /** VOLTEX's own book. Never mixed with the external sections below. */
    derivatives: GatewaySection<AnalyticsDerivatives>;
    externalOpenInterest: MultiVenueSection<AnalyticsTrackedOpenInterest>;
    externalFunding: MultiVenueSection<AnalyticsFundingComparison>;
    perpetualBasis: MultiVenueSection<AnalyticsBasisComparison>;
    longShortPositioning: GatewaySection<AnalyticsPositioning>;
    realizedVolatility: GatewaySection<AnalyticsRealizedVolatility>;
    cryptoCorrelations: GatewaySection<AnalyticsCorrelations>;
    sectorRotation: GatewaySection<AnalyticsSectorRotation>;
  };
  /** Designed modules with no legitimate source yet. Each carries a
   *  reason and NO value-carrying fields. */
  unsupported: Record<string, { available: false; reason: string; detail?: string }>;
}

/** Market-WIDE reference figures (CoinGecko). Every field is nullable and
 *  nothing is coerced: `null` means the provider did not report it and
 *  renders as a dash, while a genuine `0` arrives as `0`.
 *
 *  These are NOT VOLTEX execution prices — a tradable asset's terminal
 *  price comes from the Kraken reference path the trading surfaces use.
 *  The two are never mixed. */
export interface AssetMarketSnapshot {
  priceUsd: number | null;
  changePercent24h: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  circulatingSupply: number | null;
}

export interface CanonicalAsset {
  id: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  providers: { coingecko?: string; kraken?: string };
  /** The REAL executable VOLTEX pairs for this asset. Empty means the
   *  asset is catalogue-only — there is no market to route a trade to. */
  tradingPairs: string[];
  tradable: boolean;
  metadataSource: string;
  rank: number | null;
  ambiguous: boolean;
  collidingIds: string[];
  /** `null` for a venue-only listing the catalogue does not cover. */
  market: AssetMarketSnapshot | null;
}

export type AssetSortKey = 'rank' | 'marketCap' | 'volume24h' | 'price' | 'change24h' | 'symbol' | 'name';

export type AssetCatalogueResponse = GatewaySection<{
  assets: CanonicalAsset[];
  /** Rows passing the filter, before pagination. */
  matched: number;
  /** The whole catalogue regardless of filter, so a filtered view can say
   *  "12 of 517" instead of implying the catalogue shrank. */
  catalogueTotal: number;
  tradableCount: number;
  collisions: string[];
  metadataComplete: boolean;
  limit: number;
  offset: number;
}>;

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** The parsed error body. Routes that fail in a way the UI must react to
     *  (email verification pending, a wrong OTP, a resend cooldown) return a
     *  machine-readable `code` alongside the message; branching on that is
     *  reliable, branching on message text is not. */
    public body: Record<string, unknown> = {}
  ) {
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
    throw new ApiError(extractErrorMessage(body, res.status), res.status, body);
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
    throw new ApiError(extractErrorMessage(body, res.status), res.status, body);
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

export interface CfdPosition {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: string;
  entryPrice: string;
  leverage: number;
  initialMargin: string;
  liquidationPrice: string;
  status: string;
  realizedPnl: string;
  openedAt: string;
  closedAt: string | null;
}

/** What /auth/register answers with, and what a login rejected for an
 *  unverified address carries in its error body. */
/** A real ledger balance, valued by the same endpoint that totals it. */
interface RealBalance {
  asset: string;
  available: string;
  locked: string;
  priceUsd: number | null;
  valueUsd: number | null;
}

export const api = {
  // Read-only modeled strategy history on the normal backend. The legacy
  // internal simulation controls remain separate and cannot reset these ledgers.
  getNazarCopyTrading: () => request<SyntheticCopyTradingResponse>('/copy-trading/nazar'),
  getKseniaCopyTrading: () => request<import('./kseniaCopyTrading').KseniaResponse>('/copy-trading/ksenia'),
  getCopyStrategyIdentities: () => request<{ identities: (import('./kseniaCopyTrading').PublicStrategyIdentity | null)[] }>('/copy-trading/identities'),
  /** Creates the account and returns a real session token straight away —
   *  the same token shape /auth/login issues. There is no intermediate
   *  verification step and no second call to make. */
  register: (email: string, password: string, ref?: string) =>
    request<{ token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, ref }),
    }),

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

  // Demo trading — admin-only sandbox, its own order book/balances,
  // completely separate from the real ones above.
  getDemoBalances: () => request<{ asset: string; available: string; locked: string }[]>('/demo/balances'),

  getDemoOrderBook: (pair: string) =>
    request<{
      pair: string;
      bids: { price: string; quantity: string; orders: number }[];
      asks: { price: string; quantity: string; orders: number }[];
      timestamp: number;
    }>(`/demo/orderbook/${pair}`),

  placeDemoOrder: (params: { pair: string; side: 'BUY' | 'SELL'; type: 'LIMIT' | 'MARKET'; price?: string; quantity: string }) =>
    request('/demo/orders', { method: 'POST', body: JSON.stringify(params) }),

  getDemoOpenOrders: () =>
    request<
      {
        id: string;
        pair: string;
        side: 'BUY' | 'SELL';
        type: 'LIMIT' | 'MARKET';
        price: string | null;
        originalQuantity: string;
        remainingQuantity: string;
        status: string;
        createdAt: string;
      }[]
    >('/demo/orders/open'),

  cancelDemoOrder: (orderId: string) => request(`/demo/orders/${orderId}`, { method: 'DELETE' }),

  getDemoTrades: (pair: string) =>
    request<{ id: string; pair: string; price: string; quantity: string; side: 'BUY' | 'SELL'; executedAt: string }[]>(
      `/demo/trades/${pair}`
    ),

  // Wallet page's profit chart — the client already computes total
  // portfolio value (spot + futures), this just persists/reads it back.
  /**
   * Everything the Wallet page needs about what the account is worth.
   * `real` is always the spendable ledger; `presentation`, when present, is
   * a display-only profile that no trading, margin or withdrawal path reads
   * (see the backend's AdminPortfolioProfile).
   */
  getWalletOverview: () =>
    request<{
      real: {
        spot: RealBalance[];
        futures: RealBalance[];
        spotValueUsd: number;
        futuresValueUsd: number;
        totalValueUsd: number;
      };
      presentation: {
        holdings: { asset: string; quantity: string; priceUsd: number | null; valueUsd: number | null }[];
        totalValueUsd: number;
        startedOn: string;
      } | null;
      /** Rendered verbatim; `displaySpotUsd + displayFuturesUsd === displayTotalUsd`. */
      displayTotalUsd: number;
      displaySpotUsd: number;
      displayFuturesUsd: number;
      btcPriceUsd: number | null;
    }>('/wallet/overview'),

  /** 7D/30D/90D/1Y/all-time, all measured off one canonical daily series. */
  getWalletPerformance: () =>
    request<{
      periods: Record<
        '7d' | '30d' | '90d' | '1y' | 'all',
        {
          period: string;
          available: boolean;
          startDate: string | null;
          endDate: string | null;
          startEquity: number | null;
          endEquity: number | null;
          absolutePnl: number | null;
          percent: number | null;
          points: { date: string; equity: number }[];
        }
      >;
      ageDays: number;
      startedOn: string | null;
    }>('/wallet/performance'),

  recordPortfolioSnapshot: (totalValueUsd: string) =>
    request<{ recorded: boolean }>('/wallet/portfolio-snapshot', {
      method: 'POST',
      body: JSON.stringify({ totalValueUsd }),
    }),

  getPortfolioHistory: (range: '7d' | '30d' | '90d') =>
    request<{ points: { date: string; totalValueUsd: string }[] }>(`/wallet/portfolio-history?range=${range}`),

  demoTopUp: (userId: string, asset: string, amount: string, note?: string) =>
    request<{ asset: string; available: string; locked: string }>(`/admin/users/${userId}/demo-topup`, {
      method: 'POST',
      body: JSON.stringify({ asset, amount, note }),
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

  getMyWithdrawals: () =>
    request<
      {
        id: string;
        asset: string;
        network: string;
        toAddress: string;
        amount: string;
        status: string;
        rejectionReason: string | null;
        createdAt: string;
      }[]
    >('/withdrawals/me'),

  requestWithdrawal: (params: { asset: string; network: string; toAddress: string; amount: string }) =>
    request<{ id: string; asset: string; network: string; toAddress: string; amount: string; status: string }>(
      '/withdrawals',
      { method: 'POST', body: JSON.stringify(params) }
    ),

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
  // Market-WIDE headline figures (total 24h volume / market cap across
  // every exchange, plus the published Crypto Fear & Greed Index) — see
  // the backend's /market/global route. Deliberately separate from
  // getExternalTickers below, which is this exchange's own pair data.
  // Either half can be null independently when its upstream source is
  // rate-limited; callers render "—" for whichever is missing rather than
  // substituting a locally-derived stand-in.
  // The featured strategy leader's photo for the Copy Trading marketplace
  // — public, one field, no parameters (see the backend route's comment).
  getFeaturedTraderAvatar: () =>
    request<{ avatarUrl: string | null }>('/market/featured-trader'),

  getGlobalMarket: () =>
    request<{
      source: string;
      global: {
        totalVolume24hUsd: number;
        totalMarketCapUsd: number;
        btcDominancePercent: number | null;
        ethDominancePercent: number | null;
        marketCapChangePercent24h: number | null;
      } | null;
      fearGreed: { value: number; classification: string; updatedAt: number } | null;
    }>('/market/global'),

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
        changePercent7d: number | null;
        changePercent30d: number | null;
        volume24h: number;
        marketCap: number | null;
        sparkline: number[];
      }[];
    }>('/market/external/rankings'),

  // Read-only — see referral.ts's doc comment on the backend. The actual
  // reward payout happens inside DepositService, never here.
  getReferralMe: () =>
    request<{
      referralCode: string;
      rewardPercent: number;
      referredCount: number;
      rewardsByAsset: { asset: string; amount: string }[];
      recentRewards: { id: string; asset: string; amount: string; createdAt: string }[];
    }>('/referral/me'),

  // Live cross-exchange spread comparison (Binance/OKX/Kraken) — see
  // ArbitrageService's doc comment on the backend for what this is and
  // isn't (a real-time monitor, never an auto-trading/fund-moving bot).
  getArbitrageOpportunities: () =>
    request<{
      opportunities: {
        pair: string;
        buyExchange: string;
        buyPrice: number;
        sellExchange: string;
        sellPrice: number;
        spreadPercent: number;
        netSpreadPercent: number;
      }[];
    }>('/arbitrage/opportunities'),

  getExternalTickers: () =>
    request<{ source: string; tickers: MarketTicker[] }>('/market/external/tickers'),

  // ── Market Data Gateway ────────────────────────────────────────────
  //
  // The endpoints above are unchanged and still work; these are the
  // gateway-backed ones every market surface should read from. The
  // difference that matters: each section arrives as either
  // `{available: true, value, source, fetchedAt, stale}` or
  // `{available: false, reason}` with NO value-carrying fields — so a
  // provider outage cannot be mistaken for a zero, and a stale-served
  // value is visibly stale instead of looking live.
  //
  // Do not call getMarketSnapshot from a component directly: go through
  // lib/marketDataStore, which shares ONE poll and ONE in-flight request
  // across every consumer in the tab.
  getMarketSnapshot: () => request<MarketSnapshotResponse>('/market/snapshot'),

  /** The Analytics page's single dataset. Available to any signed-in
   *  user: it carries ordinary exchange market information and no
   *  operational detail. Provider circuit state lives behind
   *  /analytics/diagnostics and /market/status, both admin-only. */
  getAnalyticsOverview: (asset?: string) =>
    request<AnalyticsSnapshot>(`/analytics/overview${asset ? `?asset=${encodeURIComponent(asset)}` : ''}`),

  /** Tracked-venue derivatives stats for the Futures header. Deliberately
   *  its own small endpoint rather than the whole Analytics snapshot. */
  getFuturesMarketStats: (baseAsset: string) =>
    request<GatewaySection<FuturesMarketStats>>(`/market/derivatives/${encodeURIComponent(baseAsset)}`),

  /** Canonical asset catalogue. `tradable` narrows it to assets with a
   *  real executable VOLTEX pair — the catalogue is reference metadata and
   *  is deliberately much larger than the tradable set. */
  getAssetCatalogue: (
    params: {
      tradable?: boolean;
      search?: string;
      sort?: AssetSortKey;
      dir?: 'asc' | 'desc';
      limit?: number;
      offset?: number;
    } = {}
  ) => {
    const query = new URLSearchParams();
    if (params.tradable) query.set('tradable', 'true');
    if (params.search) query.set('search', params.search);
    if (params.sort) query.set('sort', params.sort);
    if (params.dir) query.set('dir', params.dir);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const suffix = query.toString() ? `?${query}` : '';
    return request<AssetCatalogueResponse>(`/market/assets${suffix}`);
  },

  /** Batched icon/display metadata. One request for every symbol on
   *  screen — never one request per row. */
  getAssetIcons: (symbols: string[]) =>
    request<{ assets: Record<string, { id: string; name: string; logoUrl: string | null }> }>(
      `/market/assets/icons?symbols=${encodeURIComponent(symbols.join(','))}`
    ),

  getCfdTickers: () =>
    request<{
      source: string;
      configured: boolean;
      tickers: { symbol: string; name: string; price: string; changePercent24h: string }[];
    }>('/cfd/tickers'),

  getCfdConfig: () =>
    request<{
      symbols: string[];
      minLeverage: number;
      maxLeverage: number;
      newAccountMaxLeverage: number;
      newAccountPeriodDays: number;
      highLeverageWarningThreshold: number;
      leverageTiers: { notionalCap: number; maxLeverage: number; maintenanceMarginRate: number; maintenanceAmount: number }[];
    }>('/cfd/config'),

  openCfdPosition: (params: { symbol: string; side: 'BUY' | 'SELL'; quantity: string; leverage: number }) =>
    request<{ position: CfdPosition }>('/cfd/positions', { method: 'POST', body: JSON.stringify(params) }),

  getCfdPositions: () =>
    request<(CfdPosition & { markPrice: string | null; unrealizedPnl: string | null; roe: string | null })[]>('/cfd/positions'),

  getCfdPositionHistory: () => request<CfdPosition[]>('/cfd/positions/history'),

  closeCfdPosition: (positionId: string) => request<{ position: CfdPosition }>(`/cfd/positions/${positionId}/close`, { method: 'POST' }),

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

  getExternalOrderBook: (pair: string, limit = 100) =>
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
      displayName: string | null;
      phone: string | null;
      country: string | null;
      avatarUrl: string | null;
      isAdmin: boolean;
      kycStatus: 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
      twoFactorEnabled: boolean;
      createdAt: string;
    }>('/me'),

  getSyntheticCopyTrading: () => request<SyntheticCopyTradingResponse>('/copy-trading/synthetic'),

  advanceSyntheticCopyTrading: (days: 1 | 7 | 30 | 90) =>
    request<SyntheticCopyTradingResponse>('/admin/copy-trading/synthetic/advance', {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),

  resetSyntheticCopyTrading: () =>
    request<SyntheticCopyTradingResponse>('/admin/copy-trading/synthetic/reset', { method: 'POST' }),

  setSyntheticCopyTradingMode: (mode: 'REAL_TIME' | 'FAST_FORWARD') =>
    request<SyntheticCopyTradingResponse>('/admin/copy-trading/synthetic/mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  // Profile photo, as a self-contained data URL. The caller downscales
  // before sending (see resizeImageToDataUrl) — the server caps the
  // decoded size and re-checks that the bytes really are the image type
  // they claim to be, so an oversized or bogus payload is rejected there
  // regardless of what the client did.
  updateAvatar: (image: string) =>
    request<{ avatarUrl: string | null }>('/me/avatar', { method: 'PUT', body: JSON.stringify({ image }) }),

  deleteAvatar: () => request<{ avatarUrl: string | null }>('/me/avatar', { method: 'DELETE' }),

  updateProfile: (data: { displayName?: string; phone?: string; country?: string }) =>
    request<{ displayName: string | null; phone: string | null; country: string | null }>('/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ status: string }>('/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  getSecurityLog: () =>
    request<
      { id: string; action: string; createdAt: string; metadata: { ip?: string | null; userAgent?: string | null } }[]
    >('/account/security-log'),

  // Real devices/browsers with a live session — see the backend's Session
  // model. `current` marks the one this very request is authenticated
  // with, so the frontend can label "This device" and guard the sign-out
  // button.
  getSessions: () =>
    request<
      { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }[]
    >('/me/sessions'),

  revokeSession: (id: string) => request<void>(`/me/sessions/${id}`, { method: 'DELETE' }),

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
    document: File;
  }) => {
    const form = new FormData();
    form.append('country', fields.country);
    form.append('fullName', fields.fullName);
    form.append('dateOfBirth', fields.dateOfBirth);
    form.append('documentType', fields.documentType);
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
    request<{ chain: string; txHash: string; asset: string; amount: string; confirmations: number; timestamp: string | null }[]>(
      '/admin/deposits/incoming'
    ),

  creditDepositManually: (params: { userId: string; chain: string; txHash: string; asset: string }) =>
    request<{ status: string; amount: string; confirmations: number; minDepositUsd?: number }>(
      '/admin/deposits/manual-credit',
      { method: 'POST', body: JSON.stringify(params) }
    ),

  // Marks an incoming transfer as not one of ours (e.g. old unrelated
  // activity on a reused treasury address) — permanently hides it from
  // getAdminIncomingDeposits. See adminDeposits.ts.
  ignoreIncomingDeposit: (params: { chain: string; txHash: string }) =>
    request<{ status: string }>('/admin/deposits/ignore', { method: 'POST', body: JSON.stringify(params) }),

  // Admin: manual withdrawal fulfillment — the reverse of the above. See
  // src/api/routes/adminWithdrawals.ts.
  getAdminWithdrawals: () =>
    request<
      {
        id: string;
        userId: string;
        userEmail: string;
        asset: string;
        network: string;
        toAddress: string;
        amount: string;
        status: string;
        txHash: string | null;
        rejectionReason: string | null;
        createdAt: string;
      }[]
    >('/admin/withdrawals'),

  approveWithdrawal: (id: string) =>
    request<{ id: string; status: string }>(`/admin/withdrawals/${id}/approve`, { method: 'POST' }),

  markWithdrawalSent: (id: string, txHash: string) =>
    request<{ id: string; status: string }>(`/admin/withdrawals/${id}/mark-sent`, {
      method: 'POST',
      body: JSON.stringify({ txHash }),
    }),

  rejectWithdrawal: (id: string, reason?: string) =>
    request<{ id: string; status: string }>(`/admin/withdrawals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  reviewKyc: (submissionId: string, approve: boolean, reason?: string) =>
    request<{ status: string }>(`/kyc/${submissionId}/review`, {
      method: 'POST',
      body: JSON.stringify({ approve, reason }),
    }),

  // Backend-authoritative eligibility and persisted card requests, not issuance.
  getCardApplication: () => request<CardApplicationSnapshot>('/card/application/me'),

  submitCardApplication: (product: CardProduct) =>
    request<CardApplicationSnapshot>('/card/application', {
      method: 'POST', body: JSON.stringify({ product }),
    }),

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
      fundingIntervalHours: number;
      highLeverageWarningThreshold: number;
      leverageTiers: { notionalCap: number | null; maxLeverage: number; maintenanceMarginRate: number; maintenanceAmount: number }[];
    }>('/futures/config'),

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
        /** Real, server-held TP/SL for this position. `null` on a side is
         *  the server saying nothing is armed there — it is never a local
         *  echo of something typed into the editor. Travels with the
         *  position so no second endpoint has to be polled per row. */
        protection: {
          takeProfit: FuturesProtectionTrigger | null;
          stopLoss: FuturesProtectionTrigger | null;
        };
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

  // Take Profit / Stop Loss on an OPEN futures position. Futures-only: these
  // are the futures protection routes, driven by the futures MARK price
  // server-side. Nothing here touches the spot conditional-order surface
  // (`/orders/me?status=PENDING_TRIGGER`, `updateOrderTrigger`, spot OCO).
  getFuturesPositionProtection: (positionId: string) =>
    request<FuturesPositionProtection>(`/futures/positions/${positionId}/protection`),

  /** PUT replaces BOTH sides: `null` removes that side. */
  setFuturesPositionProtection: (positionId: string, body: { takeProfit: string | null; stopLoss: string | null }) =>
    request<FuturesPositionProtection>(`/futures/positions/${positionId}/protection`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  clearFuturesPositionProtection: (positionId: string) =>
    request(`/futures/positions/${positionId}/protection`, { method: 'DELETE' }),

  getFuturesBalances: () => request<{ asset: string; available: string; locked: string }[]>('/futures/balances'),

  transferFuturesFunds: (asset: string, amount: string, direction: 'TO_FUTURES' | 'TO_SPOT') =>
    request<{ status: string }>('/futures/transfer', { method: 'POST', body: JSON.stringify({ asset, amount, direction }) }),

  getFuturesMarkPrice: (symbol: string) =>
    request<{ symbol: string; markPrice: string; indexPrice: string }>(`/futures/mark-price/${pairToSlug(symbol)}`),

  /** Open interest on a contract, from this exchange's own position book —
   *  the only authoritative source for it. `openInterestValue` is null when
   *  there is no mark price to value the size with. */
  getFuturesOpenInterest: (symbol: string) =>
    request<{ symbol: string; openInterest: string; openInterestValue: string | null }>(
      `/futures/open-interest/${pairToSlug(symbol)}`
    ),

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

  // --- Admin panel (/admin) — every call below is re-checked for role on
  // the server on every request (see requireAdmin middleware); nothing
  // here is trusted client-side. ---

  getAdminWallets: () =>
    request<
      {
        chain: string;
        nativeAsset: string | null;
        tokens: string[];
        address: string | null;
        isOverridden: boolean;
        envConfigured: boolean;
        updatedByAdminId: string | null;
        updatedAt: string | null;
      }[]
    >('/admin/wallets'),

  setAdminWalletAddress: (chain: string, address: string) =>
    request<{ chain: string; address: string }>(`/admin/wallets/${chain}`, {
      method: 'PUT',
      body: JSON.stringify({ address }),
    }),

  resetAdminWallet: (chain: string) => request<{ ok: boolean }>(`/admin/wallets/${chain}`, { method: 'DELETE' }),

  getAdminUsers: (search?: string) =>
    request<
      {
        id: string;
        email: string;
        role: 'USER' | 'ADMIN';
        isAdmin: boolean;
        kycStatus: 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
        createdAt: string;
        registrationIp: string | null;
        lastLoginAt: string | null;
        isBlocked: boolean;
        blockedAt: string | null;
        blockedReason: string | null;
        balances: { asset: string; available: string; locked: string }[];
      }[]
    >(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  getAdminUserDetail: (id: string) =>
    request<{
      id: string;
      email: string;
      role: 'USER' | 'ADMIN';
      isAdmin: boolean;
      kycStatus: 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
      createdAt: string;
      registrationIp: string | null;
      lastLoginAt: string | null;
      isBlocked: boolean;
      blockedAt: string | null;
      blockedReason: string | null;
      balances: { asset: string; available: string; locked: string }[];
      demoBalances: { asset: string; available: string; locked: string }[];
      deposits: {
        id: string;
        asset: string;
        chain: string;
        txHash: string;
        amount: string;
        confirmations: number;
        status: string;
        createdAt: string;
      }[];
      withdrawals: {
        id: string;
        asset: string;
        network: string;
        toAddress: string;
        amount: string;
        status: string;
        txHash: string | null;
        rejectionReason: string | null;
        createdAt: string;
      }[];
      orders: {
        id: string;
        pair: string;
        side: string;
        type: string;
        price: string | null;
        originalQuantity: string;
        remainingQuantity: string;
        status: string;
        createdAt: string;
      }[];
      purchases: { id: string; productName: string; amount: string; asset: string; status: string; createdAt: string }[];
      kycSubmissions: {
        id: string;
        country: string;
        fullName: string;
        dateOfBirth: string;
        documentType: string;
        status: string;
        rejectionReason: string | null;
        reviewedBy: string | null;
        reviewedAt: string | null;
        createdAt: string;
      }[];
    }>(`/admin/users/${id}`),

  adjustUserBalance: (userId: string, asset: string, amount: string, reason: string) =>
    request<{ asset: string; available: string; locked: string }>(`/admin/users/${userId}/adjust-balance`, {
      method: 'POST',
      body: JSON.stringify({ asset, amount, reason }),
    }),

  blockUser: (userId: string, reason: string) =>
    request<{ ok: boolean }>(`/admin/users/${userId}/block`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  unblockUser: (userId: string) => request<{ ok: boolean }>(`/admin/users/${userId}/unblock`, { method: 'POST' }),

  deleteUser: (userId: string) => request<{ ok: boolean }>(`/admin/users/${userId}`, { method: 'DELETE' }),

  getAdminAuditLog: (params?: { action?: string; userId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.action) qs.set('action', params.action);
    if (params?.userId) qs.set('userId', params.userId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<
      {
        id: string;
        userId: string | null;
        userEmail: string | null;
        action: string;
        metadata: Record<string, unknown>;
        performedByAdminEmail: string | null;
        createdAt: string;
      }[]
    >(`/admin/audit-log${suffix}`);
  },

  getAdminProducts: () =>
    request<
      { id: string; name: string; description: string; priceAmount: string; priceAsset: string; active: boolean; createdAt: string }[]
    >('/admin/products'),

  createProduct: (params: { name: string; description: string; priceAmount: string; priceAsset: string }) =>
    request<{ id: string; name: string; description: string; priceAmount: string; priceAsset: string; active: boolean }>(
      '/products',
      { method: 'POST', body: JSON.stringify(params) }
    ),

  updateProduct: (
    id: string,
    patch: Partial<{ name: string; description: string; priceAmount: string; priceAsset: string; active: boolean }>
  ) =>
    request<{ id: string; name: string; description: string; priceAmount: string; priceAsset: string; active: boolean }>(
      `/products/${id}`,
      { method: 'PATCH', body: JSON.stringify(patch) }
    ),

  deleteProduct: (id: string) => request<void>(`/products/${id}`, { method: 'DELETE' }),
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
