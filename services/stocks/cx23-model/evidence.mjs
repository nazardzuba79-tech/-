// Harness evidence contracts only; no runtime/trading rules are changed.
import { instrument } from '../../stocks-global/catalog.mjs';
import { quoteStatus } from '../../stocks-global/engine.mjs';
export const EVIDENCE_VERSION = 2;
export function validState(body, id, now = Date.now(), canTrade = false) {
  const q = body?.quotes?.[id];
  return body?.account?.canTrade === canTrade && q?.instrumentId === id
    && !body?.errors?.[id] && quoteStatus(q, now, 'USDT') === 'READY';
}
export function validHistory(body, id, interval, now = Date.now()) {
  const i = instrument(id), rows = body?.candles;
  if (!i || body?.instrumentId !== id || body.interval !== interval || body.provider !== i.provider
    || body.currency !== i.currency || !Array.isArray(rows) || !rows.length) return false;
  return rows.every((c, n) => Number.isSafeInteger(c.time) && c.time <= Math.floor(now / 1000)
    && (!n || c.time > rows[n - 1].time)
    && [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
    && Math.min(c.open, c.high, c.low, c.close) > 0 && c.volume >= 0
    && c.high >= Math.max(c.open, c.close, c.low) && c.low <= Math.min(c.open, c.close));
}
export const phaseAt = (elapsedMs, durationMs) => elapsedMs < durationMs / 3 ? 'preHide' : elapsedMs < durationMs / 2 ? 'hidden' : 'postReopen';
export const phaseCoveragePass = phases => ['preHide', 'postReopen'].every(phase => phases?.[phase]?.validStates > 0 && phases?.[phase]?.validHistories > 0);
export function idleEvidence(active, final, diagnostics = true) {
  const delta = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
  return { evidenceVersion: EVIDENCE_VERSION, noNewWorkGate: 'UNVERIFIED',
    reason: 'Cached snapshots do not identify dispatch time or distinguish new work from already-dispatched work draining after chart release. Deltas are observations only.',
    elapsedMs: delta(active?.at, final?.at),
    providerStarts: delta(active?.stocks?.fixtureTransportStarts, final?.stocks?.fixtureTransportStarts),
    accountSql: diagnostics ? delta(active?.stocks?.accounts?.sqlCalls, final?.stocks?.accounts?.sqlCalls) : null };
}
export function createJournal({ append = () => {}, maxPending = 256 } = {}) {
  let sequence = 0; const pending = new Map();
  return {
    dispatch({ kind, route, atMs, context = {} }) {
      if (pending.size >= maxPending) throw Error('EVIDENCE_PENDING_LIMIT');
      // Allowlisted, bounded fixture metadata only: never headers, tokens or bodies.
      const safe = {};
      for (const key of ['viewer', 'phase', 'instrumentId', 'interval']) if (context[key] !== undefined) safe[key] = String(context[key]).slice(0, 80);
      const event = { evidenceVersion: EVIDENCE_VERSION, event: 'dispatch', requestId: ++sequence, kind: String(kind).slice(0, 32), route: String(route).slice(0, 160), atMs, context: safe };
      append(event); pending.set(event.requestId, event); return event.requestId;
    },
    settle(requestId, outcome) {
      const start = pending.get(requestId); if (!start) throw Error('EVIDENCE_UNKNOWN_OR_DOUBLE_SETTLEMENT');
      const event = { ...start, event: 'settlement', ...outcome, requestId };
      append(event); pending.delete(requestId); return event;
    },
    pending: () => [...pending.values()],
  };
}
export function reconcileJournal(text) {
  const events = [], malformed = [];
  for (const [line, raw] of String(text || '').split('\n').entries()) if (raw.trim()) {
    try { const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('INVALID_ROW'); events.push(parsed); } catch { malformed.push(line + 1); }
  }
  const v2 = events.some(r => r.evidenceVersion === EVIDENCE_VERSION && r.event === 'dispatch');
  if (!v2) return { evidenceVersion: 1, complete: false, dispatchCoverage: 'UNVERIFIED',
    reason: 'Legacy journal has settled rows only; interrupted in-flight attempts cannot be counted.',
    settledRows: events.filter(r => typeof r.ok === 'boolean' && r.kind !== 'source-observation').length, dispatched: null, unknown: null, malformedLines: malformed };
  const starts = new Map(), ends = new Map(), issues = [];
  for (const event of events) if (event.evidenceVersion !== EVIDENCE_VERSION
    || !['dispatch', 'settlement', 'graph-validation', 'source-observation'].includes(event.event)) issues.push('UNEXPECTED_ROW_OR_VERSION');
  for (const event of events.filter(r => r.event === 'dispatch' || r.event === 'settlement')) {
    if (event.evidenceVersion !== EVIDENCE_VERSION || !Number.isSafeInteger(event.requestId) || event.requestId <= 0) { issues.push('INVALID_REQUEST_ID_OR_VERSION'); continue; }
    const map = event.event === 'dispatch' ? starts : ends;
    if (map.has(event.requestId)) issues.push('DUPLICATE_' + event.event.toUpperCase());
    else map.set(event.requestId, event);
  }
  for (const [id, end] of ends) {
    const start = starts.get(id);
    if (!start) issues.push('SETTLEMENT_WITHOUT_DISPATCH');
    else if (start.kind !== end.kind || start.route !== end.route || typeof end.ok !== 'boolean' || !Number.isFinite(end.ms) || end.ms < 0) issues.push('INVALID_SETTLEMENT');
  }
  const unknown = [...starts.values()].filter(r => !ends.has(r.requestId)).map(r => ({ ...r, event: 'unsettled', outcome: 'INTERRUPTED_UNKNOWN', ms: null, status: null }));
  const outcomes = [...ends.values()].filter(r => starts.has(r.requestId));
  return { evidenceVersion: EVIDENCE_VERSION, complete: !unknown.length && !issues.length && !malformed.length,
    dispatchCoverage: 'RECORDED', dispatched: starts.size, settled: outcomes.length,
    successes: outcomes.filter(r => r.ok === true).length, httpFailures: outcomes.filter(r => r.ok === false).length,
    unknown: unknown.length, unknownAttempts: unknown, issues, malformedLines: malformed };
}
