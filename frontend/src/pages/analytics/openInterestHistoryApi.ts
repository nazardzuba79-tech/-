export interface OpenInterestHistoryPoint {
  observedAt: number;
  openInterestBase: number;
  openInterestUsd: number | null;
}

export interface OpenInterestHistoryValue {
  baseAsset: string;
  contract: string;
  period: '1h';
  lookbackHours: 168;
  points: OpenInterestHistoryPoint[];
}
