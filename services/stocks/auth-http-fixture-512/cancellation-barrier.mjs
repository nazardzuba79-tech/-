// Fixture-only transport proof. Never imported by the ordinary paired load runner.
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';

const REQUIRED = ['authority-admitted', 'client-abort', 'stocks-response-close', 'upstream-close', 'handler-finally'];

export function cancellationEvidence({ caseId, events, cleanup, terminalReason }) {
  const reasons = [];
  if (!/^[a-z0-9-]{1,64}$/.test(caseId)) reasons.push('CASE_ID_INVALID');
  if (!Array.isArray(events) || events.length !== REQUIRED.length) reasons.push('EVENT_COUNT');
  const rows = Array.isArray(events) ? events : [];
  if (rows.some((row, i) => row.caseId !== caseId || row.sequence !== i + 1 || !Number.isFinite(row.atMs) || (i > 0 && row.atMs < rows[i - 1].atMs))) reasons.push('EVENT_CORRELATION');
  if (REQUIRED.some((kind, index) => rows[index]?.kind !== kind)) reasons.push('EVENT_ORDER');
  if (terminalReason !== 'UPSTREAM_CLOSED') reasons.push('UPSTREAM_NOT_CANCELLED');
  if (!cleanup || cleanup.timerActive || cleanup.authorityListenersActive || cleanup.stocksListenerActive || !cleanup.handlerSettled) reasons.push('CLEANUP_INCOMPLETE');
  return { status: reasons.length ? 'NOT_PROVEN' : 'PROVEN', reasons };
}

export function createCancellationBarrier({ caseId, timeoutMs = 1000 }) {
  assert.match(caseId, /^[a-z0-9-]{1,64}$/);
  // Below the unchanged 3-second resolver deadline. A normal deadline cannot
  // masquerade as cancellation caused by the client in this focused fixture.
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 50 && timeoutMs <= 1500);
  const events = [];
  let resolveAdmission, resolveSettled, release, timer, authorityResponse, stocksResponse;
  let active = false, started = false, disposed = false, terminalReason = null;
  const cleanup = { timerActive: false, authorityListenersActive: false, stocksListenerActive: false, handlerSettled: false };
  const admitted = new Promise(resolve => { resolveAdmission = resolve; });
  const settled = new Promise(resolve => { resolveSettled = resolve; });
  const record = kind => {
    assert.ok(events.length < 8, 'BARRIER_EVENT_BOUND');
    events.push({ caseId, sequence: events.length + 1, kind, atMs: performance.now() });
  };
  const stocksClose = () => {
    cleanup.stocksListenerActive = false;
    record(stocksResponse.writableFinished ? 'stocks-response-finished' : 'stocks-response-close');
  };
  const upstreamClose = () => {
    if (!active) return;
    record(authorityResponse.writableFinished ? 'upstream-finished' : 'upstream-close');
    release(authorityResponse.writableFinished ? 'AUTHORITY_FINISHED' : 'UPSTREAM_CLOSED');
  };
  const detach = () => {
    if (timer) clearTimeout(timer);
    timer = null; cleanup.timerActive = false;
    authorityResponse?.off('close', upstreamClose); cleanup.authorityListenersActive = false;
    stocksResponse?.off('close', stocksClose); cleanup.stocksListenerActive = false;
  };
  const snapshot = () => {
    const result = { caseId, timeoutMs, events: events.map(row => ({ ...row })), terminalReason, cleanup: { ...cleanup } };
    return { ...result, proof: cancellationEvidence(result) };
  };
  return {
    admitted, settled, snapshot,
    observeStocksResponse(response) {
      assert.ok(response instanceof ServerResponse && !stocksResponse && !disposed, 'BARRIER_STOCKS_RESPONSE');
      stocksResponse = response; response.once('close', stocksClose); cleanup.stocksListenerActive = true;
    },
    markClientAbort() {
      assert.ok(active && !events.some(row => row.kind === 'client-abort'), 'BARRIER_ABORT_BEFORE_ADMISSION');
      record('client-abort');
    },
    async hold(request, response) {
      assert.ok(request instanceof IncomingMessage && response instanceof ServerResponse && response.req === request, 'BARRIER_ACTUAL_HTTP_REQUIRED');
      assert.ok(!started && !disposed && !request.aborted && !response.destroyed, 'BARRIER_ALREADY_CLOSED');
      started = true; active = true; authorityResponse = response;
      const waiting = new Promise(resolve => { release = reason => { if (terminalReason === null) { terminalReason = reason; resolve(reason); } }; });
      response.once('close', upstreamClose); cleanup.authorityListenersActive = true;
      timer = setTimeout(() => { record('barrier-timeout'); release('BARRIER_TIMEOUT'); }, timeoutMs); cleanup.timerActive = true;
      record('authority-admitted'); resolveAdmission();
      try { return await waiting; }
      finally {
        active = false; detach(); cleanup.handlerSettled = true;
        record('handler-finally'); resolveSettled(snapshot());
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (active && terminalReason === null) { record('cleanup-release'); release('CLEANUP_RELEASED'); }
      detach();
    },
  };
}
