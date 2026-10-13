// Harness-only finite idle proof. Cached worker SQL snapshots are NOT a gate.
export function idleSample(snapshot) {
  const s = snapshot?.stocks, q = s?.accounts?.queue, h = s?.live;
  const values = { at: snapshot?.at, dispatched: q?.dispatched, pending: q?.pending, active: q?.active,
    transportStarts: s?.fixtureTransportStarts, transportInflight: h?.transportInflight, quoteInflight: h?.quoteInflight,
    historyInflight: h?.historyInflight, historyActive: h?.historyActive, historyQueued: h?.historyQueued, workerAlive: s?.accounts?.workerAlive };
  if (Object.values(values).some(v => !Number.isSafeInteger(v) || v < 0) || values.workerAlive !== 1) throw Error('IDLE_LIVE_METRICS_UNAVAILABLE');
  return values;
}
const drained = s => ['pending', 'active', 'transportInflight', 'quoteInflight', 'historyInflight', 'historyActive', 'historyQueued'].every(k => s[k] === 0);
export async function measureFiniteIdle({ sample, interestProof, expectedRoles, now = Date.now, sleep = ms => new Promise(ok => setTimeout(ok, ms)), drainTimeoutMs = 5000, windowMs = 3400, intervalMs = 200 }) {
  const result = { contract: 'FINITE_POST_RELEASE_NO_DISPATCH', windowMs, drainTimeoutMs, interestProof, expectedRoles, samples: [],
    limitation: 'Only this observed finite window, not indefinite inactivity. SQL snapshots are diagnostic; fresh dispatch/queue/inflight counters provide the gate.' };
  const proofValid = Array.isArray(expectedRoles) && new Set(expectedRoles).size === expectedRoles.length
    && Number.isSafeInteger(interestProof?.expectedAccounts) && interestProof.expectedAccounts === expectedRoles.length
    && Array.isArray(interestProof.accounts) && interestProof.accounts.length === interestProof.expectedAccounts
    && new Set(interestProof.accounts.map(r => r.role)).size === interestProof.expectedAccounts
    && interestProof.accounts.every(r => r.uninterested === true && expectedRoles.includes(r.role));
  if (!proofValid) return { ...result, status: 'FAIL', reason: 'POST_RELEASE_ACCOUNT_INTEREST_UNVERIFIED' };
  const start = now(); let baseline;
  try {
    while (now() - start <= drainTimeoutMs) {
      const s = idleSample(await sample()); result.samples.push({ phase: 'drain', ...s });
      result.drainElapsedMs = now() - start;
      if (result.drainElapsedMs > drainTimeoutMs) return { ...result, status: 'FAIL', reason: 'DRAIN_BARRIER_TIMEOUT' };
      if (drained(s)) { baseline = s; break; } await sleep(intervalMs);
    }
    if (!baseline) return { ...result, status: 'FAIL', reason: 'DRAIN_BARRIER_TIMEOUT' };
    const windowStart = now(); let last = baseline, previous = baseline;
    do {
      await sleep(intervalMs); last = idleSample(await sample()); result.samples.push({ phase: 'idle', ...last });
      if (last.at <= previous.at) return { ...result, status: 'FAIL', reason: 'IDLE_SAMPLE_CLOCK_NOT_ADVANCING', observedWindowMs: now() - windowStart };
      if (!drained(last) || last.dispatched !== baseline.dispatched || last.transportStarts !== baseline.transportStarts)
        return { ...result, status: 'FAIL', reason: 'NEW_DISPATCH_OR_ACTIVE_WORK_AFTER_DRAIN', observedWindowMs: now() - windowStart };
      previous = last;
    } while (now() - windowStart < windowMs);
    if (last.at - baseline.at < windowMs) return { ...result, status: 'FAIL', reason: 'IDLE_SAMPLE_CLOCK_NOT_ADVANCING', observedWindowMs: now() - windowStart };
    return { ...result, status: 'PASS', observedWindowMs: now() - windowStart, baseline, final: last,
      interestsConfirmedZero: true, dispatchedDelta: last.dispatched - baseline.dispatched, providerStartsDelta: last.transportStarts - baseline.transportStarts };
  } catch (error) { return { ...result, status: 'INCOMPLETE', reason: error.message }; }
}
