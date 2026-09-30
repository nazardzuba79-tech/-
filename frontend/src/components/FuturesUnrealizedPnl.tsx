import type { ReactNode } from 'react';
import { cardPrice, cardSignedAmount, cardSignedPercent } from '../lib/cardNumberFormat';
import './FuturesUnrealizedPnl.css';

/**
 * Display only: both figures are supplied by the engine, never derived here.
 * `approx` is the caller's already-spelled «≈… USD» line, drawn under the
 * ROI as Bybit does (owner, 2026-09-30); omitted, the cell is two lines.
 */
export function FuturesUnrealizedPnl({ amount, roi, asset, approx, children }: {
  amount: string | null; roi: string | null; asset: string; approx?: string | null; children?: ReactNode;
}) {
  const fixed = cardSignedAmount(amount);
  const value = fixed === '—' ? null : Number(amount);
  // Reuse the financial formatter's adaptive precision for sub-cent amounts.
  const money = value !== null && value !== 0 && Math.abs(value) < 0.01
    ? `${value > 0 ? '+' : ''}${cardPrice(amount)}` : fixed;
  const percent = cardSignedPercent(roi);
  const tone = value === null || value === 0 ? 'neutral' : value > 0 ? 'profit' : 'loss';
  return <div className="futures-unrealized" data-tone={tone}>
    <span className="futures-position-money">{money}{money !== '—' && asset && <> <span className="futures-unrealized-unit">{asset}</span></>}</span>
    <small className="futures-position-roi">{percent === '—' ? '—' : `(${percent}%)`}</small>
    {approx && <small className="futures-position-approx">{approx}</small>}
    {children}
  </div>;
}
