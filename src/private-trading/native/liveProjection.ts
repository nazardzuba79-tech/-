import { createHash } from 'crypto';
import type { NativeAccount } from './store';
import { emptyDemoState, type DemoState } from './engine';
import { accountLedger, type AccountLedger } from './ledger';

/** Derived display input only. Never pass this incomplete state to replay or execution. */
export interface NativeLiveProjection {
  version: 1;
  revision: number;
  executionMode: 'LIVE_EXECUTION' | 'HISTORICAL_DEMO';
  source: NativeAccount['source'];
  createdAt: number;
  disabledCollateralAssets: string[];
  state: DemoState;
  ledger: Omit<AccountLedger, 'entries'>;
}

export function deriveNativeLiveProjection(account: NativeAccount): NativeLiveProjection {
  const full = account.snapshot;
  const positions = full.positions.filter(p => p.status === 'OPEN');
  const orders = full.orders.filter(o => o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED');
  const symbols = new Set([...positions, ...orders].map(row => row.symbol));
  const select = <T>(values: Record<string, T> = {}) => Object.fromEntries(Object.entries(values).filter(([symbol]) => symbols.has(symbol)));
  // Explicit allowlist: journal, execution-book consumption, closed trades,
  // checkpoints and idempotency records can never enter the live projection.
  const state: DemoState = {
    ...emptyDemoState(full.initialDeposit, full.time),
    walletBalance: full.walletBalance,
    collateral: full.collateral,
    positions, orders,
    instruments: select(full.instruments),
    marks: select(full.marks),
    historicalMarks: select(full.historicalMarks),
  };
  const { entries: _entries, ...ledger } = accountLedger(full);
  return structuredClone({ version: 1, revision: account.revision, executionMode: account.executionMode ?? 'LIVE_EXECUTION', source: account.source,
    createdAt: account.createdAt, disabledCollateralAssets: account.disabledCollateralAssets ?? [], state, ledger });
}

// JSONB changes key order; the digest is intentionally independent of it.
export function projectionDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)).digest('hex');
}

export function verifiedProjection(value: unknown, digest: string | null, revision: number): NativeLiveProjection | null {
  if (!value || !digest || projectionDigest(value) !== digest) return null;
  const p = value as NativeLiveProjection;
  if (p.version !== 1 || p.revision !== revision || !['LIVE_EXECUTION','HISTORICAL_DEMO'].includes(p.executionMode) || p.state?.version !== 3 || !p.ledger
    || !Array.isArray(p.state.positions) || !Array.isArray(p.state.orders)
    || p.state.events?.length !== 0 || !Array.isArray(p.disabledCollateralAssets)
    || p.state.positions.some(row => row.status !== 'OPEN')
    || p.state.orders.some(row => row.status !== 'OPEN' && row.status !== 'PARTIALLY_FILLED')) return null;
  return p;
}
