// Offline analysis only. Never performs HTTP, opens SQLite or launches a workload.
import assert from 'node:assert/strict';
import { E, COLUMNS, CAPACITY } from './recorder.mjs';

const EVENT_NAMES = new Map(Object.entries(E).map(([name, code]) => [code, name]));
const SYNC = new Map([[60,61],[62,63],[64,65],[66,67],[68,69],[70,71],[72,73],[74,75],[76,77]]);
const WALL = new Map([[20,[21,22]],[32,[34]],[40,[41]]]);
const id = n => 'trace_' + String(n).padStart(2, '0');
const ms = ns => Number(ns) / 1e6;
const bigint = value => { assert.match(value, /^-?\d{1,20}$/); return BigInt(value); };
const nearest = (values, fraction) => values.length ? [...values].sort((a,b)=>a-b)[Math.ceil(values.length * fraction)-1] : null;
const summary = values => ({ count: values.length, min: values.length ? Math.min(...values) : null,
  p50: nearest(values, .5), p95: nearest(values, .95), p99: nearest(values, .99), max: values.length ? Math.max(...values) : null });

export function analyzeTrace({ trace, ordinary, authorityEvents, cgroupWindow }) {
  const report = { schema: 'stocks-one-burst-analysis-512-v1', captureStatus: 'INCOMPLETE', ordinaryStatus: 'INCOMPLETE',
    capacityAcceptance: false, releaseGatePass: false, issues: [], requests: [], spans: [], cpu: {},
    limits: ['Only one instrumented burst; neither capacity acceptance nor a replacement for the original tests.',
      'Async spans are wall time. Concurrent requests overlap and must not be added into CPU buckets.',
      'Worker CPU covers its execution envelope, not the whole main-thread window.',
      'Nested sync CPU is counted once per thread. Residual CPU is unattributed.',
      'Partial append writer wall brackets include any allocation/descheduling within the bracket; they are not CPU or total observer cost. Probes outside the bracket and separate allocation, clock, context and scheduling effects are unmeasured.',
      'Authority work after client/gateway termination is retained; negative cross-process terminal deltas are valid.'] };
  const issue = code => { if (!report.issues.includes(code) && report.issues.length < 128) report.issues.push(code); };
  try {
    assert.deepEqual(trace.columns, COLUMNS);
    assert.ok(Array.isArray(trace.rows) && trace.rows.length <= CAPACITY.main + CAPACITY.worker);
    assert.ok(Array.isArray(ordinary) && ordinary.length === 50);
    assert.ok(Array.isArray(authorityEvents) && authorityEvents.length <= 1000);
    const cgroupStart = bigint(cgroupWindow.startMonoNs), cgroupEnd = bigint(cgroupWindow.endMonoNs);
    assert.ok(cgroupStart > 0n && cgroupEnd > cgroupStart, 'MISSING_CGROUP_WINDOW');
    if (trace.incomplete || trace.overflow || trace.flags?.length || trace.active) issue('RECORDER_INCOMPLETE');
    const clients = new Map();
    for (const row of ordinary) {
      assert.match(row.requestId || '', /^trace_(0[1-9]|[1-4][0-9]|50)$/);
      assert.ok(!clients.has(row.requestId), 'DUPLICATE_CLIENT_TERMINAL'); clients.set(row.requestId, row);
      assert.ok(['HTTP', 'DEADLINE', 'TRANSPORT_ERROR'].includes(row.outcome), 'UNKNOWN_CLIENT_OUTCOME');
    }
    report.ordinaryStatus = ordinary.every(row => row.outcome === 'HTTP' && row.status === 200) ? 'PASS' : 'FAIL';
    const events = [], lastSeq = [0,0], lastTime = [0n,0n], lastCpu = [[-1n,-1n],[-1n,-1n]], commandRequests = new Map();
    for (const values of trace.rows) {
      assert.ok(Array.isArray(values) && values.length === COLUMNS.length);
      const v = values.map(bigint), [seq,thread,request,command,span,event,time,user,system] = v;
      assert.ok(thread === 0n || thread === 1n);
      const t = Number(thread), e = Number(event), r = Number(request), c = Number(command);
      assert.equal(Number(seq), ++lastSeq[t], 'LOST_OR_DUPLICATE_EVENT');
      assert.ok(time >= lastTime[t] && time > 0n, 'NON_MONOTONIC_THREAD_EVENT'); lastTime[t] = time;
      assert.ok(EVENT_NAMES.has(e) && request >= 0n && request <= 50n && command >= 0n && command <= 2147483647n && span >= 0n && span <= 16384n);
      if (e !== E.WINDOW_BEGIN && e !== E.WINDOW_END && e !== E.WORKER_CPU_CHECKPOINT) assert.ok(r > 0, 'UNBOUND_REQUEST_EVENT');
      const cpuAllowed = e === E.WINDOW_BEGIN || e === E.WINDOW_END || e === E.WORKER_CPU_CHECKPOINT || [...SYNC].some(([a,b]) => a === e || b === e);
      assert.ok(cpuAllowed || (user === -1n && system === -1n), 'CPU_RECORDED_ACROSS_ASYNC');
      assert.ok((user === -1n && system === -1n) || (user >= 0n && system >= 0n), 'PARTIAL_CPU_COUNTER');
      if (user >= 0n) {
        assert.ok(user >= lastCpu[t][0] && system >= lastCpu[t][1], 'NON_MONOTONIC_THREAD_CPU');
        lastCpu[t] = [user,system];
      }
      if (c) { const old = commandRequests.get(c); assert.ok(!old || old === r, 'CROSS_REQUEST_COMMAND'); commandRequests.set(c, r); }
      events.push({ seq:Number(seq), thread:t, request:r, command:c, span:Number(span), event:e, time, user, system });
    }
    assert.equal(lastSeq[0], trace.counts.main); assert.equal(lastSeq[1], trace.counts.worker);
    const grouped = new Map();
    for (const row of events.filter(row => row.span > 0)) {
      const key = row.thread + ':' + row.span;
      if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row);
    }
    const syncIntervals = [[],[]];
    for (const rows of grouped.values()) {
      if (rows.length !== 2) { issue('UNPAIRED_SPAN'); continue; }
      const [a,b] = rows;
      assert.equal(a.request,b.request,'CROSS_REQUEST_SPAN'); assert.equal(a.command,b.command,'CROSS_COMMAND_SPAN');
      const synchronous = SYNC.get(a.event) === b.event;
      assert.ok(synchronous || WALL.get(a.event)?.includes(b.event), 'INVALID_SPAN_PAIR');
      assert.ok(b.time >= a.time);
      const cpuUs = synchronous && a.user >= 0n && b.user >= 0n ? Number(b.user-a.user+b.system-a.system) : null;
      assert.ok(cpuUs === null || cpuUs >= 0, 'NEGATIVE_SYNC_CPU');
      report.spans.push({ request:id(a.request), thread:a.thread, name:EVENT_NAMES.get(a.event).replace(/_BEGIN$/, ''),
        wallMs:ms(b.time-a.time), cpuUs, scope:synchronous?'synchronous bracket':'wall only' });
      if (synchronous) syncIntervals[a.thread].push({ start:a.time,end:b.time,cpuUs });
    }
    for (let request=1; request<=50; request++) {
      const rows = events.filter(row=>row.request===request), client = clients.get(id(request));
      const select = codes => rows.filter(row=>codes.includes(row.event));
      for (const codes of [[E.INGRESS],[E.GATEWAY_ENTRY],[E.RESPONSE_FINISH,E.RESPONSE_CLOSE],[E.GATEWAY_FINISH,E.GATEWAY_CLOSE]])
        if (select(codes).length !== 1) issue('MISSING_OR_DUPLICATE_REQUEST_BOUNDARY');
      if (client.outcome === 'HTTP' && client.status === 200) {
        for (const e of [E.AUTH_BEGIN,E.AUTH_END,E.FETCH_DISPATCH,E.FETCH_HEADERS,E.BODY_BEGIN,E.BODY_FIRST_CHUNK,E.BODY_END,
          E.AUTH_JSON_BEGIN,E.AUTH_JSON_END,E.IDENTITY_RESULT,E.CONTEXT_BEGIN,E.CONTEXT_END,
          E.WORKER_ADMIT,E.WORKER_SEND,E.WORKER_RECEIVE,E.WORKER_RESULT,E.WORKER_SETTLE,E.SQL_READ_BEGIN,E.SQL_READ_END,
          E.LEDGER_PARSE_BEGIN,E.LEDGER_PARSE_END,E.VALIDATE_BEGIN,E.VALIDATE_END,E.VIEW_BEGIN,E.VIEW_END,
          E.WORKER_CLONE_BEGIN,E.WORKER_CLONE_END,E.WORKER_COMMAND_END,E.MAIN_CLONE_BEGIN,E.MAIN_CLONE_END,
          E.STATUS_SYNC_BEGIN,E.STATUS_SYNC_END,
          E.RESPONSE_JSON_BEGIN,E.RESPONSE_JSON_END]) if (!select([e]).length) issue('SUCCESS_MISSING_PHASE_' + EVENT_NAMES.get(e));
      }
      const stamps = {};
      for (const row of rows) (stamps[EVENT_NAMES.get(row.event)] ??= []).push(String(row.time));
      const origin = bigint(client.startedMonoNs);
      const offsets = Object.fromEntries(Object.entries(stamps).map(([k,vs])=>[k,vs.map(v=>ms(BigInt(v)-origin))]));
      const auth = authorityEvents.filter(row=>row.requestId===id(request));
      assert.ok(auth.length <= 2, 'DUPLICATE_AUTHORITY_JOIN');
      if (auth.length || select([E.FETCH_HEADERS]).length) {
        if (auth.filter(row=>row.type==='authority-start').length !== 1 || auth.filter(row=>row.type==='authority-terminal').length !== 1)
          issue('MISSING_OR_DUPLICATE_AUTHORITY_BOUNDARY');
        else {
          const a=auth.find(row=>row.type==='authority-start'), b=auth.find(row=>row.type==='authority-terminal');
          assert.equal(a.startedMonoNs,b.startedMonoNs,'AUTHORITY_START_MISMATCH');
          assert.equal(a.sequence,b.sequence,'AUTHORITY_SEQUENCE_MISMATCH');
          assert.ok(bigint(b.endedMonoNs)>=bigint(a.startedMonoNs),'AUTHORITY_TIME_REVERSED');
        }
      }
      const safeAuthority = auth.map(row => {
        assert.ok(['authority-start','authority-terminal'].includes(row.type), 'UNKNOWN_AUTHORITY_EVENT');
        const safe = { requestId:id(request), type:row.type, startedMonoNs:String(bigint(row.startedMonoNs)) };
        if (row.endedMonoNs !== undefined) safe.endedMonoNs = String(bigint(row.endedMonoNs));
        if (row.status !== undefined) { assert.ok(Number.isSafeInteger(row.status) && row.status >= 100 && row.status <= 599); safe.status = row.status; }
        if (row.terminal !== undefined) { assert.ok(['finish','close','error','aborted'].includes(row.terminal)); safe.terminal = row.terminal; }
        return safe;
      });
      assert.ok(client.reason === null || client.reason === undefined || /^[A-Z0-9_]{1,80}$/.test(client.reason), 'UNSAFE_TERMINAL_REASON');
      report.requests.push({ request:id(request), outcome:client.outcome, status:client.status ?? null, reason:client.reason ?? null,
        phaseOffsetFromClientStartMs:offsets, rawNumericStamps:stamps, authorityEvents:safeAuthority });
    }
    for (let thread=0; thread<2; thread++) {
      const name = thread ? 'worker' : 'main', window = trace.windowCpu[name];
      assert.ok(window && typeof window.scope === 'string');
      const executed = events.filter(row=>row.thread===1 && row.event===E.WORKER_RECEIVE).length;
      if (thread===1 && !executed) {
        if (events.some(row=>row.thread===1)) issue('WORKER_ROWS_WITHOUT_COMMAND');
        report.cpu.worker={status:'NOT_APPLICABLE',scope:'No traced worker command executed',totalUs:null,
          synchronousNonNestedUs:null,unattributedUs:null,commonWindow:false}; continue;
      }
      if (window.cpuAvailable!==true) issue('MISSING_'+name.toUpperCase()+'_NATIVE_CPU');
      if (window.cpuAvailable) assert.ok(bigint(window.userUs)>=0n && bigint(window.systemUs)>=0n, 'NEGATIVE_THREAD_CPU_COMPONENT');
      const full = window.cpuAvailable ? Number(bigint(window.userUs)+bigint(window.systemUs)) : null;
      assert.ok(full === null || full >= 0);
      const windowStart = bigint(window.startMonoNs), windowEnd = bigint(window.endMonoNs);
      assert.ok(windowStart >= 0n && windowEnd >= windowStart, 'INVALID_THREAD_WINDOW');
      if (windowStart<cgroupStart || windowEnd>cgroupEnd || windowStart===0n) issue('THREAD_WINDOW_OUTSIDE_CGROUP');
      const starts=events.filter(row=>row.thread===thread && row.event===E.WINDOW_BEGIN);
      const ends=events.filter(row=>row.thread===thread && row.event===(thread?E.WORKER_CPU_CHECKPOINT:E.WINDOW_END));
      if (starts.length!==1 || !ends.length || (thread===0 && ends.length!==1)) issue('MISSING_THREAD_CPU_WITNESS');
      else {
        const a=starts[0], b=ends.at(-1);
        if(a.time!==windowStart || b.time!==windowEnd) issue('THREAD_WINDOW_TIMESTAMP_MISMATCH');
        if(a.user<0n || b.user<0n) issue('MISSING_THREAD_CPU_WITNESS');
        else if(window.cpuAvailable && (b.user-a.user!==bigint(window.userUs) || b.system-a.system!==bigint(window.systemUs))) issue('THREAD_CPU_WITNESS_MISMATCH');
      }
      const intervals = syncIntervals[thread].sort((a,b)=>a.start===b.start?Number(b.end-a.end):Number(a.start-b.start));
      let right = -1n, sum = 0, available = true;
      for (const entry of intervals) {
        if (entry.start < windowStart || entry.end > windowEnd) { issue('SYNC_SPAN_OUTSIDE_THREAD_WINDOW'); available = false; }
        if (entry.end <= right) continue; // fully nested: retain detail but don't double-count.
        if (entry.start < right) { issue('PARTIALLY_OVERLAPPING_SYNC_SPANS'); continue; }
        right = entry.end; if (entry.cpuUs === null) available = false; else sum += entry.cpuUs;
      }
      if (full !== null && available && sum > full) issue('SYNC_CPU_EXCEEDS_THREAD_WINDOW');
      report.cpu[name] = { scope:window.scope, totalUs:full, synchronousNonNestedUs:available?sum:null,
        unattributedUs:full!==null&&available?full-sum:null, commonWindow:thread===0 };
    }
    report.cpu.cgroupResidual = { status:'NOT_COMPUTED', startMonoNs:String(cgroupStart),endMonoNs:String(cgroupEnd),
      reason:'Thread-window containment is checked. The broader cgroup read interval is not treated as an exact CPU partition.' };
    assert.ok(ordinary.every(row=>Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0), 'MISSING_CLIENT_ELAPSED');
    report.latencyMs = summary(ordinary.map(row=>row.elapsedMs));
    report.writerMeasurement = trace.writerMeasurement;
    report.captureStatus = report.issues.length ? 'INCOMPLETE' : 'COMPLETE';
  } catch (error) {
    issue(/^[A-Z_]+$/.test(error?.message || '') ? error.message : 'TRACE_SCHEMA_OR_BINDING_INVALID');
  }
  return report;
}
