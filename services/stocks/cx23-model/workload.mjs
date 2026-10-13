import { performance } from 'node:perf_hooks';
import { IDS } from './stocks-fixture.mjs';
import { MODEL, summarizeAttempts } from './metrics.mjs';
import { writeFileSync, appendFileSync } from 'node:fs';
import { EVIDENCE_VERSION, validState, validHistory, phaseAt, phaseCoveragePass, createJournal } from './evidence.mjs';
export const STEPS = ['spotCreate','spotCancel','spotMaker','spotFill','futuresCreate','futuresCancel','futuresMaker','futuresOpen','tpslSet','tpslState','tpslSweep','futuresCloseMaker','futuresClose','stateRead'];
const sleep = ms => new Promise(ok => setTimeout(ok, Math.max(0, ms)));
export const viewerCoveragePass = (rows, expected) => rows.length === expected && new Set(rows.map(r => r.viewer)).size === expected
  && rows.every(r => phaseCoveragePass(r.phases) && r.hiddenPhaseEntered === true);
export async function runWorkload({ profile, viewers = 0, pattern = 'shared', seconds = 30, loaded = true, verifyReleased = false, stocksBase = 'http://127.0.0.1:18092', cryptoBase = 'http://127.0.0.1:18094', controlBase = 'http://127.0.0.1:18093' }) {
  const records = [], contracts = [], viewed = new Set(), successfulGraphs = new Set(), viewerCoverage = [], started = performance.now(), deadline = started + seconds * 1000;
  const cpuStart = process.cpuUsage();
  const cryptoSchedule = { expectedCycles: Math.ceil(seconds * 1000 / 250), startedCycles: 0, completedCycles: 0, startLatenessMs: [] };
  const append = row => { if (process.env.CX23_RAW_LOG) appendFileSync(process.env.CX23_RAW_LOG, JSON.stringify(row) + '\n'); };
  const journal = createJournal({ append });
  const record = row => { records.push(row); append(row); };
  const state = new Map(); let viewerMutationPosts = 0;
  const request = async (kind, url, options = {}, context = {}) => {
    const at = performance.now(); let body, status, code, ok = false;
    const requestId = journal.dispatch({ kind, route: new URL(url).pathname, atMs: at - started, context });
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(MODEL.deadlineMs) }); status = response.status;
      body = await response.json(); ok = response.ok; if (!ok) code = body.error || `HTTP_${status}`;
    } catch (error) { code = error.name === 'TimeoutError' ? 'DEADLINE_3000MS' : error.cause?.code || error.name; }
    const row = journal.settle(requestId, { ms: performance.now() - at, status: status ?? null, ok, code: code ?? null }); records.push(row);
    return { ok, body, code, requestId };
  };
  const stock = async (who, route, body, method = body ? 'POST' : 'GET', view = 'model-view', context = {}) => {
    if (who !== 'owner' && method === 'POST') { viewerMutationPosts++; throw Error('VIEWER_MUTATION_FORBIDDEN_IN_MODEL'); }
    const headers = { Authorization: `Bearer cx23-fixture-${who}`, 'X-Stocks-Token': state.get(who)?.token || '', 'X-Stocks-View': view, 'Content-Type': 'application/json' };
    const r = await request('stocks', `${stocksBase}/__stocks_global/${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }, context);
    if (r.body?.token) state.set(who, r.body); return r;
  };
  const check = (name, condition, details) => contracts.push({ name, pass: !!condition, ...(condition ? {} : { details }) });
  const crypto = async () => {
    let cycles = 0;
    while (cycles < cryptoSchedule.expectedCycles && performance.now() < deadline) {
      await sleep(started + cycles * 250 - performance.now());
      if (performance.now() >= deadline) break;
      cryptoSchedule.startedCycles++; cryptoSchedule.startLatenessMs.push(Math.max(0, performance.now() - (started + cycles * 250)));
      for (const name of STEPS) {
        const r = await request('crypto', `${cryptoBase}/fixture/step/${name}`, { method: 'POST' });
        if (!r.ok) { check('crypto-sequence-complete', false, { step: name, code: r.code, body: r.body }); return; }
      }
      cycles++; cryptoSchedule.completedCycles++;
    }
  };
  let ownerReady;
  const firstOwnerTrade = new Promise(ok => { ownerReady = ok; });
  const owner = async () => {
    const id = IDS[0], path = 'state?id=' + encodeURIComponent(id), view = 'owner-model'; viewed.add(id);
    let s = await stock('owner', path, undefined, 'GET', view);
    check('owner-authorized', s.ok && s.body?.account?.canTrade === true);
    const chart = await stock('owner', 'history?id=' + encodeURIComponent(id) + '&interval=15m');
    const ownerGraphValid = s.ok && validState(s.body, id, Date.now(), true) && chart.ok && validHistory(chart.body, id, '15m');
    check('owner-graph-data', ownerGraphValid);
    if (ownerGraphValid) successfulGraphs.add(id);
    const beforeUsdc = JSON.stringify(s.body?.wallets?.USDC);
    const order = (suffix, side, quantity, type = 'MARKET') => ({ id: `cx23-owner-${suffix}-00001`, instrumentId: id, currency: 'USDT', side, type, quantity, ...(type === 'LIMIT' ? { limitPrice: '1' } : {}) });
    const buy = order('buy', 'BUY', '0.5'); let r = await stock('owner', 'orders', buy, 'POST', view);
    check('owner-buy-filled', r.ok && r.body?.fills?.length === 1, r.code);
    r = await stock('owner', 'orders', buy, 'POST', view);
    check('idempotent-duplicate', r.ok && r.body?.fills?.length === 1, r.code);
    ownerReady();
    await stock('owner', 'lease?id=' + encodeURIComponent(id), undefined, 'DELETE', view);
    r = await stock('owner', 'portfolio'); check('wallet-held-paper-position', r.ok && Object.keys(r.body?.positions || {}).length === 1);
    await sleep(3100);
    s = await stock('owner', path, undefined, 'GET', view + '-reopen');
    // A new visit correctly rejects a shared quote received before demandSince.
    // One planned later read observes a post-resume event; never replay a mutation.
    await sleep(2100);
    s = await stock('owner', path, undefined, 'GET', view + '-reopen');
    r = await stock('owner', 'orders', order('partial', 'SELL', '0.25'), 'POST', view + '-reopen');
    check('partial-sell-filled', r.ok && r.body?.fills?.length === 2, r.code);
    r = await stock('owner', 'orders', order('limit', 'BUY', '0.1', 'LIMIT'), 'POST', view + '-reopen');
    check('limit-reserved', r.ok && Number(r.body?.wallets?.USDT?.reserved) > 0, r.code);
    r = await stock('owner', 'cancel', { id: 'cx23-owner-limit-00001' }, 'POST', view + '-reopen');
    check('limit-cancel-released', r.ok && Number(r.body?.wallets?.USDT?.reserved) === 0, r.code);
    await sleep(3100);
    await stock('owner', path, undefined, 'GET', view + '-reopen');
    r = await stock('owner', 'orders', order('close', 'SELL', '0.25'), 'POST', view + '-reopen');
    check('full-sell-filled', r.ok && r.body?.fills?.length === 3, r.code);
    await stock('owner', 'lease?id=' + encodeURIComponent(id), undefined, 'DELETE', view + '-reopen');
    r = await stock('owner', 'state');
    check('zero-open-quantity', r.ok && Object.values(r.body?.positions || {}).every(p => Number(p.quantity) === 0));
    check('historical-usdc-unchanged', JSON.stringify(r.body?.wallets?.USDC) === beforeUsdc);
  };
  const viewer = async n => {
    const who = `viewer-${n}`, id = IDS[pattern === 'shared' ? 0 : n % IDS.length]; viewed.add(id);
    let loop = 0, hidden = false, before = null;
    const phases = { preHide: { validStates: 0, validHistories: 0 }, postReopen: { validStates: 0, validHistories: 0 } };
    while (performance.now() < deadline) {
      const elapsed = performance.now() - started;
      if (elapsed >= seconds * 1000 / 3 && elapsed < seconds * 1000 / 2) {
        if (!hidden && state.get(who)?.token) await stock(who, 'lease?id=' + encodeURIComponent(id), undefined, 'DELETE', `viewer-${n}-visit`);
        hidden = true; await sleep(250); continue;
      }
      const statePhase = phaseAt(elapsed, seconds * 1000);
      const r = await stock(who, 'state?id=' + encodeURIComponent(id), undefined, 'GET', `viewer-${n}-visit`, { viewer: n, phase: statePhase, instrumentId: id });
      const statePhaseRetained = phaseAt(performance.now() - started, seconds * 1000) === statePhase;
      const stateValid = r.ok && validState(r.body, id);
      append({ evidenceVersion: EVIDENCE_VERSION, event: 'graph-validation', requestId: r.requestId, viewer: n, phase: statePhase, phaseRetained: statePhaseRetained, requestedInstrumentId: id, responseInstrumentId: r.body?.quotes?.[id]?.instrumentId ?? null, kind: 'state', valid: stateValid });
      if (r.ok) {
        check(`viewer-${n}-readonly-${loop}`, r.body?.account?.canTrade === false && r.body?.fills?.length === 0 && r.body?.orders?.length === 0);
        if (stateValid && statePhaseRetained && phases[statePhase]) phases[statePhase].validStates++;
        // Embedded safe error codes matter even when transport returned HTTP 200.
        if (r.body?.errors?.[id]) record({ evidenceVersion: EVIDENCE_VERSION, event: 'source-observation', kind: 'source-observation', requestId: r.requestId, atMs: performance.now() - started, ms: 0, status: 200, ok: false, code: r.body.errors[id] });
      }
      // If a slow pre-hide state read crosses into hidden time, issue no new history request.
      const historyPhase = phaseAt(performance.now() - started, seconds * 1000);
      if (historyPhase === 'hidden') continue;
      const interval = ['15m', '1h', '1m'][Math.floor(loop / 2) % 3];
      const h = await stock(who, 'history?id=' + encodeURIComponent(id) + '&interval=' + interval + (loop % 2 && before ? '&before=' + before : ''), undefined, 'GET', `viewer-${n}-visit`, { viewer: n, phase: historyPhase, instrumentId: id, interval });
      const historyPhaseRetained = phaseAt(performance.now() - started, seconds * 1000) === historyPhase;
      const historyValid = h.ok && validHistory(h.body, id, interval);
      append({ evidenceVersion: EVIDENCE_VERSION, event: 'graph-validation', requestId: h.requestId, viewer: n, phase: historyPhase, phaseRetained: historyPhaseRetained, requestedInstrumentId: id, requestedInterval: interval, responseInstrumentId: h.body?.instrumentId ?? null, responseInterval: h.body?.interval ?? null, kind: 'history', valid: historyValid, candleCount: h.body?.candles?.length ?? null });
      if (historyValid && historyPhaseRetained && phases[historyPhase]) { before = h.body.candles[0].time * 1000; phases[historyPhase].validHistories++; }
      loop++;
      // Do not sleep across the hide boundary and silently omit lifecycle coverage.
      const hideAt = started + seconds * 1000 / 3, current = performance.now();
      await sleep(current < hideAt ? Math.min(3000, hideAt - current + 1) : phaseAt(current - started, seconds * 1000) === 'hidden' ? 0 : 3000);
    }
    if (state.get(who)?.token) await stock(who, 'lease?id=' + encodeURIComponent(id), undefined, 'DELETE', `viewer-${n}-visit`);
    if (phaseCoveragePass(phases)) successfulGraphs.add(id);
    viewerCoverage.push({ viewer: n, instrumentId: id, phases, hiddenPhaseEntered: hidden });
    check(`viewer-${n}-graph-coverage`, phaseCoveragePass(phases), phases);
    check(`viewer-${n}-hidden-phase`, hidden);
  };
  const tasks = [crypto()];
  if (loaded && profile !== 'idle') {
    const liveCatalogue = await stock('owner', 'catalogue');
    check('runtime-catalogue-excludes-inert-fixture-ids', liveCatalogue.ok && liveCatalogue.body?.catalogue?.length === IDS.length && liveCatalogue.body.catalogue.every(i => !i.id.startsWith('FIXTURE_METADATA_ONLY:')));
    const cat = await request('metadata-fixture', controlBase + '/metadata');
    check('catalogue-250-metadata', cat.ok && cat.body?.catalogue?.length === 250);
    check('metadata-inert-not-tradable', cat.body?.catalogue?.filter(i => i.id.startsWith('FIXTURE_METADATA_ONLY:')).every(i => i.tradable === false && i.online === false && i.display === null));
    tasks.push(owner());
    await firstOwnerTrade;
    for (let n = 0; n < viewers; n++) tasks.push(viewer(n));
  }
  await Promise.all(tasks);
  const timedWorkloadElapsedMs = performance.now() - started;
  const interestProof = verifyReleased ? { expectedAccounts: loaded && profile !== 'idle' ? viewers + 1 : 0, accounts: [] } : null;
  if (verifyReleased) for (const role of [...state.keys()]) {
    // No id: read actual polling/lease state without reacquiring chart demand.
    const r = await stock(role, 'state', undefined, 'GET', 'idle-proof', { phase: 'postRelease' });
    interestProof.accounts.push({ role, uninterested: r.ok && r.body?.metrics?.polling === false, requestId: r.requestId });
  }
  if (verifyReleased) check('all-post-release-interests-zero', interestProof.accounts.length === interestProof.expectedAccounts && interestProof.accounts.every(r => r.uninterested));
  cryptoSchedule.missedCycles = cryptoSchedule.expectedCycles - cryptoSchedule.completedCycles;
  check('crypto-planned-cycles-completed', cryptoSchedule.completedCycles === cryptoSchedule.expectedCycles, cryptoSchedule);
  if (loaded && viewers) check('all-scheduled-viewers-completed', viewerCoveragePass(viewerCoverage, viewers));
  const http = records.filter(r => r.kind !== 'source-observation'), sourceErrors = records.filter(r => r.kind === 'source-observation');
  return { evidenceVersion: EVIDENCE_VERSION, fixture: true, profile, viewers, pattern, loaded, seconds, elapsedMs: performance.now() - started,
    attemptedInstrumentCardinality: viewed.size, attemptedInstrumentIds: [...viewed], successfulGraphInstrumentCardinality: successfulGraphs.size,
    successfulGraphInstrumentIds: [...successfulGraphs], viewerCoverage, metadataCatalogueCount: loaded && profile !== 'idle' ? 250 : 0,
    viewerMutationPosts, records: http, sourceErrors, contracts, cryptoSchedule, interestProof, functionalContractsPass: contracts.every(x => x.pass),
    journal: { dispatched: http.length + journal.pending().length, settled: http.length, pending: journal.pending(), complete: journal.pending().length === 0 },
    metadataCoverage: { residentFixtureComponents: 250, runtimeCatalogueCandidates: IDS.length, controlHttpRequests: loaded && profile !== 'idle' ? 1 : 0, browserRendering: 'NOT_TESTED' },
    measurementBoundary: { timedWorkloadElapsedMs, postReleaseProofRequests: http.filter(r => r.context.phase === 'postRelease').length,
      aggregateCpuScope: 'Runner initial to activeEnd includes post-release proof HTTP reads; finite idle sampler is measured separately after activeEnd. No separate timed-only server CPU attribution.' },
    timedStocks: summarizeAttempts(http.filter(r => r.kind === 'stocks' && r.context.phase !== 'postRelease')),
    postReleaseProofHttp: summarizeAttempts(http.filter(r => r.context.phase === 'postRelease')),
    loadGenerator: { cpu: process.cpuUsage(cpuStart), maxRssKiB: process.resourceUsage().maxRSS, outsideServerBudget: true, rawAttemptJournal: !!process.env.CX23_RAW_LOG },
    stocks: summarizeAttempts(http.filter(r => r.kind === 'stocks')), crypto: summarizeAttempts(http.filter(r => r.kind === 'crypto')),
    notes: ['Each row in records is one actual HTTP attempt. Source errors inside a 200 response are separate and never added again to HTTP failures.', 'Different viewers map to at most 20 existing US fixture instrument IDs, not 50 unique instruments.', 'No browser is driven here; lifecycle HTTP demand/release is modelled. Browser button silence remains separate browser-regression evidence.'] };
}
if (process.argv[1]?.endsWith('workload.mjs')) {
  const config = JSON.parse(process.env.CX23_CASE || '{}');
  const result = await runWorkload(config); writeFileSync(process.env.CX23_RESULT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ profile: result.profile, stocks: result.stocks, crypto: result.crypto, functionalContractsPass: result.functionalContractsPass }));
}
