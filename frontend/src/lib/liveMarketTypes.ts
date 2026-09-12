/** Public normalized reference contract. No trading/account fields. */
export interface LiveQuote {
  id: string; pair: string; symbol: string; providerSymbol: string; provider: 'bybit';
  marketType: 'spot' | 'linear_perpetual' | 'linear_futures' | 'inverse' | 'inverse_perpetual' | 'inverse_futures';
  volumeAsset?: string;
  turnoverAsset?: string;
  baseAsset: string; quoteAsset: string; settleAsset: string | null;
  lastPrice: number | null; bidPrice: number | null; askPrice: number | null;
  high24h: number | null; low24h: number | null; volume24h: number | null;
  quoteVolume24h: number | null; changePercent24h: number | null;
  indexPrice: number | null; markPrice: number | null; fundingRate: number | null;
  fundingIntervalMinutes: number | null; openInterest: number | null; openInterestValue: number | null;
  providerEventAt: number | null; sequence: number | null;
  receivedAt: number; fetchedAt: number; stale: boolean;
}
export type LiveStatus = 'disabled' | 'connecting' | 'live' | 'stale';
export interface LiveState { status: LiveStatus; rows: ReadonlyMap<string, LiveQuote>; revision: number }
