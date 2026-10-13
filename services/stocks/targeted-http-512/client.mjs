import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { descriptor, LIMITS } from './plan.mjs';
import { quantiles } from './metrics.mjs';
const sleep = ms => new Promise(ok => setTimeout(ok, Math.max(0, ms)));
const code = x => /^[A-Z][A-Z0-9_]{1,80}$/.test(x || '') ? x : 'REQUEST_ERROR';
const API = '/__stocks_global/', ID = 'BYBIT:AAPLXUSDT', SECOND = 'BINANCE:AAPLBUSDT';
export function capacityProof(body) {
  const proof={};for(const id of [ID,SECOND]){const q=body?.quotes?.[id];if(!q||!/^\d+\.\d{8}$/.test(q.used||'')||!/^\d+\.\d{8}$/.test(q.capacity||'')||!q.eventId||!Number.isSafeInteger(q.timestamp))throw Error('WALLET_CAPACITY_EVIDENCE_MISSING');proof[id]={used:q.used,capacity:q.capacity,eventId:q.eventId,timestamp:q.timestamp};}return proof;
}
export function classify({ elapsedMs, error, status, expectedAbort }) {
  if (elapsedMs >= LIMITS.deadlineMs) return { outcome:'ERROR',code:'DEADLINE_3000MS' };
  if (expectedAbort) return { outcome:'EXPECTED_ABORT',code:'EXPECTED_ABORT' };
  return { outcome:error || status !== 200 ? 'ERROR':'SUCCESS',code:null };
}
export function request({ port, path, subject = 'viewer-0', method = 'GET', body, headers = {}, id, deliberateAbort = false }) {
  const started = performance.now(); let req, abortRequested = false, settled = false, resolve;
  const done = new Promise(ok => { resolve = ok; });
  const finish = (error, status, bytes = 0, value = null) => {
    if (settled) return; settled = true; clearTimeout(timer);
    const expected = deliberateAbort && abortRequested && error?.message === 'EXPECTED_ABORT';
    const ms=performance.now()-started, result=classify({elapsedMs:ms,error,status,expectedAbort:expected});
    resolve({ id, ms, status: status ?? null, bytes, outcome:result.outcome,
      code: result.code || (error ? code(error.message === 'DEADLINE_3000MS' ? error.message : error.code) : status !== 200 ? code(value?.error) : null), body: value });
  };
  const timer = setTimeout(() => req?.destroy(Error('DEADLINE_3000MS')), LIMITS.deadlineMs);
  req = http.request({ hostname: '127.0.0.1', port, path, method, agent: false, headers: { Authorization: 'Bearer targeted-fixture-' + subject, 'X-Fixture-Request': id, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } }, res => {
    let bytes = 0; const chunks = [];
    res.on('data', chunk => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) req.destroy(Error('RESPONSE_BUDGET')); else chunks.push(chunk); });
    res.on('aborted', () => finish(Error('RESPONSE_ABORTED'), res.statusCode, bytes));
    res.on('error', e => finish(e, res.statusCode, bytes));
    res.on('end', () => { try { finish(null, res.statusCode, bytes, JSON.parse(Buffer.concat(chunks).toString())); } catch { finish(Error('INVALID_JSON'), res.statusCode, bytes); } });
  });
  req.once('error', e => finish(e)); if (body) req.write(JSON.stringify(body)); req.end();
  return { done, abort() { abortRequested = true; req.destroy(Error('EXPECTED_ABORT')); } };
}
export async function runClient({ profile, port, controlPort, nonce, phase = 'measure', variant = 'target' }) {
  const spec = descriptor(profile), records = [], contracts = [], timings = [], rawErrors = [], dispatches = [], pending = []; let serial = 0;
  const ctrl = async (path, method = 'GET') => { const r = await request({ port: controlPort, path, method, headers: { 'X-Fixture-Control': nonce }, id: 'control-' + serial++ }).done; if (r.outcome !== 'SUCCESS') throw Error('CONTROL_' + r.code); return r.body; };
  const record = r => { const { body, ...row } = r;
    if (body?.quotes) row.quoteEvidence = Object.values(body.quotes).filter(Boolean).map(q => ({ instrumentId: q.instrumentId, provider: q.provider, eventId: q.eventId, timestamp: q.timestamp, receivedAt: q.receivedAt, bid: q.bid, ask: q.ask, last: q.last, prices: q.prices, fx: q.fx,fxError:q.fxError }));
    if(body?.candles)row.historyEvidence={count:body.candles.length,first:body.candles[0],last:body.candles.at(-1),sha256:createHash('sha256').update(JSON.stringify(body.candles)).digest('hex')};
    if (body && r.outcome==='SUCCESS') {
      const financial={wallets:body.wallets,positions:body.positions,realized:body.realized};
      row.financialHash=createHash('sha256').update(JSON.stringify(financial)).digest('hex');
    }
    row.cohort=dispatches.find(d=>d.id===r.id)?.cohort??null;
    records.push(row); if (r.outcome === 'ERROR') rawErrors.push({ id: r.id, code: r.code, status: r.status }); return r; };
  const call = (path, subject, options = {}) => { const id = 'request-' + serial++, req = request({ port, path: API + path, subject, id, ...options });
    if (phase !== 'setup') { dispatches.push({ id, path, atMs: performance.now(), method: options.method || 'GET', deliberateAbort: options.deliberateAbort === true,cohort:options.cohort??null }); pending.push(req.done.then(record)); } return req; };
  const keep = req => req.done;
  const check = (name, ok, detail) => contracts.push({ name, ok: ok === true, ...(detail === undefined ? {} : { detail }) });
  const state = async subject => (await call('state', subject).done);
  const until = async (predicate, deadline=performance.now()+1400) => { do { const m = await ctrl('/metrics'); if (performance.now()>=deadline) break; if (await predicate(m)) return m; await sleep(10); } while (performance.now() < deadline); throw Error('BARRIER_INCOMPLETE_BEFORE_QUEUE_DEADLINE'); };
  if (phase==='verify-wallet') {
    const owner=await state('owner');
    const viewer=await call('state?id='+encodeURIComponent(ID),'viewer-0').done;
    return {phase,complete:owner.outcome==='SUCCESS'&&owner.body.metrics?.polling===false&&viewer.outcome==='SUCCESS'&&viewer.body.quotes?.[ID]?.prices?.USDC?.sell==='100.10010010',ownerPolling:owner.body?.metrics?.polling,usedCapacity:capacityProof(owner.body),records,scope:'outside measurement and durable-ledger before/after window; normal read-only dual-currency path'};
  }
  if (phase === 'preflight') {
    for (let i = 0; i < 5; i++) { const r = await state('viewer-' + i); if (r.outcome !== 'SUCCESS') throw Error('PREFLIGHT_REGISTRATION_FAILED'); }
    await Promise.all(Array.from({ length: 5 }, async (_, i) => { const r = await keep(call('state?id=' + encodeURIComponent(ID), 'viewer-' + i)); check('preflight-real-resolver-empty-view40', r.outcome === 'SUCCESS' && r.body?.catalogue?.length === 40 && r.body.account?.canTrade === false && r.body.quotes?.[ID]?.instrumentId === ID); }));
    return { setupOnly: true, preflight: true, records, contracts, pass: contracts.length === 5 && contracts.every(x => x.ok), phase };
  }
  if (phase === 'setup') {
    let usedCapacity=null;
    const users = profile.startsWith('projection') ? spec.users : profile === 'identity' ? 50 : profile === 'history' ? 1 : 0;
    // Complete durable account registration before measurement; no chosen quote/history warmup.
    for (let i = 0; i < users; i++) { const r = await state('viewer-' + i); if (r.outcome !== 'SUCCESS' || r.body.account.canTrade !== false) throw Error('ACCOUNT_SETUP_FAILED'); }
    if (profile === 'wallet') {
      for (const [index, id] of [ID, SECOND].entries()) {
        const s = await call('state?id=' + encodeURIComponent(id), 'owner', { headers: { 'X-Stocks-View': 'wallet-setup' } }).done;
        if (s.outcome !== 'SUCCESS') throw Error('WALLET_QUOTE_SETUP_FAILED');
        const r = await call('orders', 'owner', { method: 'POST', headers: { 'X-Stocks-Token': s.body.token, 'X-Stocks-View': 'wallet-setup' }, body: { id: 'targeted-wallet-buy-' + index, instrumentId: id, side: 'BUY', type: 'MARKET', currency: 'USDT', quantity: '0.25' } }).done;
        if (r.outcome !== 'SUCCESS' || r.body.positions[id + '|USDT']?.quantity !== '0.25000000') throw Error('WALLET_SETUP_TRADE_FAILED');
        const release = await call('lease?id=' + encodeURIComponent(id), 'owner', { method: 'DELETE', headers: { 'X-Stocks-Token': s.body.token, 'X-Stocks-View': 'wallet-setup' } }).done;
        if (release.outcome !== 'SUCCESS') throw Error('WALLET_SETUP_RELEASE_FAILED');
      }
      // Warm source caches expire naturally; neither TTL nor quotes are overwritten.
      const noLease=await state('owner');if(noLease.outcome!=='SUCCESS'||noLease.body.metrics?.polling!==false)throw Error('WALLET_LEASE_NOT_RELEASED');
      usedCapacity=capacityProof(noLease.body);
      await sleep(15100);
    }
    return { phase, setupOnly: true, profile, registered: users,usedCapacity, clientCpu: process.cpuUsage(), memory: process.memoryUsage() };
  }
  const start = performance.now(), cpu = process.cpuUsage();
  let failure = null;
  try { if (profile.startsWith('projection') || profile === 'wallet') {
    let scheduled = start;
    for (let wave = 0; wave < spec.waves; wave++) {
      await sleep(scheduled - performance.now()); const at = performance.now(); timings.push({ wave, latenessMs: Math.max(0, at - (start+wave*spec.cadenceMs)),scheduledFromStartMs:scheduled-start,actualFromStartMs:at-start });
      await Promise.all(Array.from({ length: spec.users }, async (_, user) => {
        const r = await keep(call(profile === 'wallet' ? 'portfolio' : 'state?id=' + encodeURIComponent(ID), profile === 'wallet' ? 'owner' : 'viewer-' + user));
        if (r.outcome !== 'SUCCESS') return;
        check('catalogue40', r.body.catalogue?.length === 40);
        if (profile === 'wallet') {
          check('wallet-native-holdings', [ID, SECOND].every(id => r.body.positions[id + '|USDT']?.quantity === '0.25000000'));
          check('wallet-usdt-prices', [ID, SECOND].every(id => r.body.quotes[id]?.prices?.USDT?.sell === '100.00000000' || r.body.quotes[id]?.prices?.USDT?.sell === '100'));
          check('wallet-source-unavailable-absent', Object.keys(r.body.errors || {}).length === 0);
          check('wallet-usdc-response-scope', [ID,SECOND].every(id => variant==='target' ? r.body.quotes[id]?.prices?.USDC===undefined : r.body.quotes[id]?.prices?.USDC?.sell==='100.10010010'));
          check('wallet-owner-account', r.body.account?.canTrade===true);
        } else {
          check('empty-readonly', r.body.account?.canTrade === false && Object.keys(r.body.positions || {}).length === 0 && r.body.orders?.length === 0 && r.body.fills?.length === 0);
          check('projection-source', r.body.quotes?.[ID]?.instrumentId === ID && r.body.quotes[ID].provider === 'bybit' && r.body.errors?.[ID] === undefined);
        }
      }));
      // No overlap and no catch-up after an overrun: preserve all planned attempts and report drift.
      scheduled = Math.max(scheduled + spec.cadenceMs, performance.now());
    }
  } else if (profile === 'identity') {
    for (const users of spec.cohorts) { const before=await ctrl('/metrics'),at = performance.now(); await Promise.all(Array.from({ length: users }, async (_, user) => {
      const r = await keep(call('state', 'viewer-' + user,{cohort:users})); if (r.outcome === 'SUCCESS') check('identity-readonly', r.body.account?.canTrade === false && r.body.catalogue?.length === 40);
    }));const after=await ctrl('/metrics'),attempts=records.filter(r=>r.cohort===users);timings.push({ users, elapsedMs: performance.now() - at,before,after,allAttemptLatencyMs:quantiles(attempts.map(r=>r.ms)),errors:attempts.filter(r=>r.outcome==='ERROR').length }); await sleep(250); }
  } else {
    for (let wave = 0; wave < spec.waves; wave++) for (let scenario = 0; scenario < 3; scenario++) {
      // Non-overlapping historical windows ensure a genuinely uncached key each case.
      const before = Math.floor(Date.now() / 86400000) * 86400000 - (wave * 3 + scenario + 1) * 700 * 900000;
      const path = 'history?id=' + encodeURIComponent(ID) + '&interval=15m&before=' + before;
      const baseline = await ctrl('/metrics'); let gone, live, barrierDeadline;
      try {
        await ctrl(scenario === 2 ? '/hold-native' : '/hold-slots', 'POST');
        barrierDeadline=performance.now()+1700;
        gone = call(path, 'viewer-0', { deliberateAbort: true });
        if (scenario !== 2) await until(m => m.live.queued === 1,barrierDeadline); else await until(m => m.transport.starts === baseline.transport.starts + 1,barrierDeadline);
        if (scenario === 1) { live = call(path, 'viewer-0'); await until(m => m.hub.historyCoalesced === baseline.hub.historyCoalesced + 1,barrierDeadline); }
        gone.abort(); const cancelled = await keep(gone);
        const closeDeadline = Math.min(barrierDeadline,performance.now()+700); while (!(await ctrl('/closed?id=' + cancelled.id)).closed) { if (performance.now() > closeDeadline) throw Error('SERVER_CLOSE_NOT_ACKNOWLEDGED'); await sleep(5); }
        if (scenario === 2) { live = call(path, 'viewer-0'); await until(m => m.hub.historyCoalesced === baseline.hub.historyCoalesced + 1,barrierDeadline); }
        if(performance.now()>=barrierDeadline)throw Error('BARRIER_INCOMPLETE_BEFORE_QUEUE_DEADLINE');
        await ctrl(scenario === 2 ? '/release-native' : '/release-slots', 'POST');
        if (live) { const r = await keep(live); check('live-history-retained', r.outcome === 'SUCCESS' && r.body.instrumentId === ID && r.body.interval === '15m' && r.body.candles?.length === 299&&r.body.candles.every((c,n)=>c.time===(before-(299-n)*900000)/1000&&c.open===100.12345678&&c.high===102.87654321&&c.low===99.01234567&&c.close===101.56781234&&c.volume===25)); }
        const after = await until(m => m.live.active === 0 && m.live.queued === 0 && m.live.flights === 0 && m.live.nativeInflight === 0);
        check('history-provider-starts', after.transport.starts - baseline.transport.starts === (scenario === 0 && variant === 'target' ? 0 : 1));
        check('history-serialization', after.hub.historySerializations - baseline.hub.historySerializations === (live ? 1 : 0));
      } finally { await ctrl('/release-slots', 'POST').catch(() => {}); await ctrl('/release-native', 'POST').catch(() => {}); }
    }
  } } catch (error) { failure = code(error.message); }
  await Promise.allSettled(pending);
  const used = process.cpuUsage(cpu);
  return { phase, profile, variant, complete: failure === null, failure, dispatches, records, contracts, timings, rawErrors, elapsedMs: performance.now() - start, clientCpuMs: (used.user + used.system) / 1000, memory: process.memoryUsage(),
    expectedAttempts: profile.startsWith('projection') || profile === 'wallet' ? spec.users * spec.waves : profile === 'identity' ? 75 : 25,
    limits: LIMITS, cgroup: Object.fromEntries(['cpu.max','memory.max','memory.swap.max','cpuset.cpus.effective','cpu.stat','memory.events','memory.peak'].map(name => { try { return [name, readFileSync('/sys/fs/cgroup/' + name, 'utf8')]; } catch { return [name, null]; } })), externalRequests: 0 };
}
if (process.argv[1]?.endsWith('/client.mjs') || process.argv[1]?.endsWith('\\client.mjs')) {
  let report; try { report = await runClient({ profile: process.env.TARGETED_PROFILE, variant: process.env.TARGETED_VARIANT, port: Number(process.env.TARGETED_PORT), controlPort: Number(process.env.TARGETED_CONTROL_PORT), nonce: process.env.TARGETED_NONCE, phase: process.env.TARGETED_PHASE }); }
  catch (error) { report = { complete: false, error: code(error.message), capacityAcceptance: false }; process.exitCode = 1; }
  console.log(JSON.stringify(report));
}
