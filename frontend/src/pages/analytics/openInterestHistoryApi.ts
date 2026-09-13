import { getToken, type GatewaySection } from '../../lib/api';

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

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

export async function getOpenInterestHistory(asset: string): Promise<GatewaySection<OpenInterestHistoryValue>> {
  const token = getToken();
  const response = await fetch(`${API_BASE}/analytics/open-interest-history?asset=${encodeURIComponent(asset)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(`Open-interest history request failed: ${response.status}`);
  return await response.json() as GatewaySection<OpenInterestHistoryValue>;
}
