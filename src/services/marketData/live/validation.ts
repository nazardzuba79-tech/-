import { z } from 'zod';
import type { LiveFrame } from './contract';
const n = z.number().finite().nullable();
const s = z.string().min(1).max(160);
const ticker = z.object({
  id: s, pair: s, symbol: s, providerSymbol: s, provider: z.literal('bybit'),
  marketType: z.enum(['spot','linear_perpetual','linear_futures','inverse','inverse_perpetual','inverse_futures']),
  baseAsset: s, quoteAsset: s, settleAsset: s.nullable(),
  lastPrice: n, bidPrice: n, askPrice: n, high24h: n, low24h: n, volume24h: n,
  quoteVolume24h: n, changePercent24h: n, indexPrice: n, markPrice: n, fundingRate: n,
  openInterest: n, openInterestValue: n, fundingIntervalMinutes: n, providerEventAt: n,
  volumeAsset: s.optional(), turnoverAsset: s.optional(),
  sequence: n, receivedAt: z.number().finite(), fetchedAt: z.number().finite(), stale: z.boolean(),
}).refine(t => t.id === `${t.marketType}:${t.providerSymbol}` && t.pair === `${t.baseAsset}/${t.quoteAsset}`);
const frame = z.object({ version: z.literal(1), type: z.enum(['snapshot','delta','state']),
  epoch: s, revision: z.number().int().nonnegative(), sentAt: z.number().finite(),
  status: z.enum(['disabled','connecting','live','stale']), rows: z.array(ticker).max(20_000) });
export function parseLiveFrame(value: unknown): LiveFrame {
  return frame.parse(value) as LiveFrame;
}
