// Offline analysis of disposable-fixture diagnostics. Never an acceptance gate.
import { readFileSync, writeFileSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PHASES = ['socketWait', 'preArrival', 'contextAccount', 'accountQueue', 'ipcToWorker', 'worker', 'ipcToMain', 'mainResponse', 'clientDelivery', 'unattributed'];
const ERROR_NAMES = ['NONE', 'ACCOUNT_BUSY', 'ACCOUNT_READ_ABORTED', 'ACCOUNT_UNAVAILABLE', 'ACCOUNT_COMMAND_INVALID', 'ACCOUNT_STORAGE_ERROR', 'ACCOUNT_OUTCOME_UNKNOWN', 'RATE_LIMIT', 'SOURCE_BUSY', 'DEADLINE_3000MS', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ABORT_ERR', 'SOURCE_UNAVAILABLE', 'SOURCE_DNS_UNAVAILABLE', 'SOURCE_FORBIDDEN', 'RESPONSE_TOO_LARGE', 'INVALID_CANDLES', 'INVALID_DATA', 'INVALID_PAIR', 'INVALID_RANGE', 'UNSUPPORTED_TIMEFRAME', 'INSTRUMENT_UNVERIFIED', 'MARKET_CLOSED', 'QUOTE_UNAVAILABLE', 'FX_STALE', 'FX_UNAVAILABLE', 'MOEX_UNVERIFIED', 'AUTH_REQUIRED', 'AUTH_UNAVAILABLE', 'ACCOUNT_CAPACITY', 'ACCOUNT_NOT_FOUND', 'ACCOUNT_SELECTOR_FORBIDDEN', 'ACCOUNT_QUEUE_FULL', 'ACCOUNT_QUEUE_TIMEOUT', 'ACCOUNT_WORKER_UNAVAILABLE', 'ACCOUNT_WORKER_TIMEOUT', 'ACCOUNT_CONFIG_INVALID', 'HOST_FORBIDDEN', 'ORIGIN_FORBIDDEN', 'METHOD_NOT_ALLOWED', 'TOKEN_REQUIRED', 'JSON_REQUIRED', 'BODY_TOO_LARGE', 'INVALID_JSON', 'ROUTE_NOT_FOUND', 'LOCAL_SERVICE_ERROR'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => finite(value) && value >= 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const difference = (end, start) => finite(end) && finite(start) && end >= start ? end - start : null;
const sum = values => values.reduce((total, value) => total + value, 0);
const median = values => quantile(values, .5);

export function quantile(values, fraction) {
  const ordered = values.filter(finite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))];
}

function unionDuration(intervals) {
  const ordered = intervals.filter(([start, end]) => finite(start) && finite(end) && end >= start).sort((a, b) => a[0] - b[0]);
  let duration = 0, start = null, end = null;
  for (const interval of ordered) {
    if (start === null) [start, end] = interval;
    else if (interval[0] <= end) end = Math.max(end, interval[1]);
    else { duration += end - start; [start, end] = interval; }
  }
  return duration + (start === null ? 0 : end - start);
}

// Intervals are exclusive only after partitioning. SQL/CPU observations are not
// inserted here: SQL is inside worker wall time, and thread CPU is not wall time.
export function partitionWindow(start, end, intervals) {
  if (!finite(start) || !finite(end) || end < start) throw Error('TRACE_INVALID_WINDOW');
  const clipped = intervals.flatMap(interval => {
    if (!PHASES.includes(interval.phase) || !finite(interval.start) || !finite(interval.end) || interval.end < interval.start) return [];
    const left = Math.max(start, interval.start), right = Math.min(end, interval.end);
    return right > left ? [{ ...interval, start: left, end: right }] : [];
  });
  const points = [...new Set([start, end, ...clipped.flatMap(interval => [interval.start, interval.end])])].sort((a, b) => a - b);
  const totals = Object.fromEntries(PHASES.map(phase => [phase, 0]));
  let ambiguousMs = 0;
  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1], right = points[i], middle = left + (right - left) / 2;
    const covering = clipped.filter(interval => interval.start <= middle && interval.end >= middle);
    const priority = covering.length ? Math.max(...covering.map(interval => interval.priority ?? 0)) : null;
    const candidates = [...new Set(covering.filter(interval => (interval.priority ?? 0) === priority).map(interval => interval.phase))];
    const phase = candidates.length === 1 ? candidates[0] : 'unattributed';
    if (candidates.length > 1) ambiguousMs += right - left;
    totals[phase] += right - left;
  }
  return { durationMs: end - start, phasesMs: totals, ambiguousMs, residualMs: end - start - sum(Object.values(totals)) };
}

function interval(phase, start, end, priority = 1) {
  return finite(start) && finite(end) && end >= start ? { phase, start, end, priority } : null;
}

function safePhysical(group) {
  if (!integer(group.id)) throw Error('TRACE_INVALID_GROUP_ID');
  const allowed = ['dispatchMs', 'workerStartMs', 'workerEndMs', 'replyMs', 'workerThreadCpuMs', 'sqlCalls', 'sqlWallMs', 'sqlThreadCpuMs'];
  const safe = { id: group.id };
  for (const key of allowed) safe[key] = nonnegative(group[key]) ? group[key] : null;
  safe.workerWallMs = difference(safe.workerEndMs, safe.workerStartMs);
  safe.sqlOutsideWorkerWallMs = finite(safe.workerWallMs) && finite(safe.sqlWallMs) ? Math.max(0, safe.sqlWallMs - safe.workerWallMs) : null;
  return safe;
}

// Cgroup counters cover sampling intervals, not individual requests. Include
// only counter differences wholly inside the request as a lower observation,
// and all intersecting intervals as an upper observation; never prorate them.
export function correlateSamples(start, end, cgroup = [], eventLoop = []) {
  const counters = ['usageUsec', 'throttledUsec', 'nrThrottled', 'ioReadBytes', 'ioWriteBytes', 'ioReadOps', 'ioWriteOps'];
  const ordered = [...cgroup].filter(sample => finite(sample.tMs)).sort((a, b) => a.tMs - b.tMs);
  const observations = Object.fromEntries(counters.map(key => [key, { contained: 0, intersecting: 0, intervals: 0, unavailableIntervals: 0 }]));
  let intersectingIntervals = 0, resetIntervals = 0;
  const coverage = [];
  for (let i = 1; i < ordered.length; i++) {
    const before = ordered[i - 1], after = ordered[i];
    if (after.tMs <= start || before.tMs >= end || after.tMs <= before.tMs) continue;
    intersectingIntervals++;
    coverage.push([Math.max(start, before.tMs), Math.min(end, after.tMs)]);
    let reset = false;
    for (const key of counters) {
      const observation = observations[key];
      if (!nonnegative(before[key]) || !nonnegative(after[key]) || after[key] < before[key]) {
        observation.unavailableIntervals++;
        if (nonnegative(before[key]) && nonnegative(after[key]) && after[key] < before[key]) reset = true;
        continue;
      }
      const delta = after[key] - before[key];
      observation.intersecting += delta;
      observation.intervals++;
      if (before.tMs >= start && after.tMs <= end) observation.contained += delta;
    }
    if (reset) resetIntervals++;
  }
  for (const value of Object.values(observations)) if (!value.intervals) { value.contained = null; value.intersecting = null; }
  const loops = eventLoop.filter(sample => finite(sample.startMs) && finite(sample.endMs) && sample.endMs > start && sample.startMs < end);
  const validLoopDelays = loops.map(sample => sample.maxDelayMs).filter(nonnegative);
  return {
    cgroup: { intersectingIntervals, resetIntervals, coveredMs: unionDuration(coverage), counters: observations, exclusiveRequestAttribution: false },
    eventLoop: { intersectingSamples: loops.length, maxDelayMs: validLoopDelays.length ? Math.max(...validLoopDelays) : null, exclusiveRequestAttribution: false },
  };
}

// Normalized input deliberately has no request URL, user/principal, payload,
// provider instrument, price or free-form error field. Adapters must whitelist.
export function analyzeRequest(request, physicalGroups, { cgroup = [], eventLoop = [], traceIncomplete = false } = {}) {
  if (!integer(request.id) || !nonnegative(request.startMs)) throw Error('TRACE_INVALID_CLIENT');
  const deadlineMs = request.deadlineMs ?? 3000;
  if (!nonnegative(deadlineMs) || deadlineMs === 0) throw Error('TRACE_INVALID_DEADLINE');
  const end = finite(request.settleMs) && request.settleMs >= request.startMs ? request.settleMs : request.startMs + deadlineMs;
  const reasons = [];
  if (!finite(request.settleMs)) reasons.push('CLIENT_SETTLE_MISSING');
  if (!finite(request.arrivalMs)) reasons.push('SERVER_ARRIVAL_MISSING');
  if (traceIncomplete) reasons.push('TRACE_INCOMPLETE');
  const groups = [...new Set(request.groupIds ?? [])].map(id => physicalGroups.get(id)).filter(Boolean);
  if (groups.length !== new Set(request.groupIds ?? []).size) reasons.push('PHYSICAL_GROUP_MISSING');
  const intervals = [
    interval('socketWait', request.startMs, request.socketMs, 1),
    interval('preArrival', request.socketMs ?? request.startMs, request.arrivalMs, 1),
    interval('contextAccount', request.contextStartMs, request.contextEndMs, 2),
    interval('clientDelivery', request.finishMs, request.settleMs, 1),
  ];
  const commands = request.commands ?? [];
  for (const command of commands) {
    const group = physicalGroups.get(command.groupId);
    if (!group && command.dispatched === false && finite(command.settleMs)) {
      intervals.push(interval('accountQueue', command.enqueueMs, command.settleMs, 3));
      continue;
    }
    if (!group) { reasons.push('COMMAND_GROUP_MISSING'); continue; }
    intervals.push(interval('accountQueue', command.enqueueMs, group.dispatchMs, 3));
  }
  for (const group of groups) {
    intervals.push(interval('ipcToWorker', group.dispatchMs, group.workerStartMs, 4));
    intervals.push(interval('worker', group.workerStartMs, group.workerEndMs, 5));
    intervals.push(interval('ipcToMain', group.workerEndMs, group.replyMs, 4));
    if (['dispatchMs', 'workerStartMs', 'workerEndMs', 'replyMs'].some(key => !finite(group[key]))) reasons.push('WORKER_PHASE_MISSING');
  }
  const lastReply = groups.map(group => group.replyMs).filter(finite).sort((a, b) => b - a)[0];
  intervals.push(interval('mainResponse', request.responseStartMs ?? lastReply, request.finishMs, 2));
  const partition = partitionWindow(request.startMs, end, intervals.filter(Boolean));
  const deadlinePartition = partitionWindow(request.startMs, Math.min(end, request.startMs + deadlineMs), intervals.filter(Boolean));
  if (partition.ambiguousMs > 0) reasons.push('AMBIGUOUS_PHASE_OVERLAP');
  const status = integer(request.status) && request.status >= 100 && request.status <= 599 ? request.status : null;
  const errorCode = integer(request.errorCode) ? request.errorCode : null;
  const result = {
    id: request.id, status, errorCode, errorName: errorCode === null ? null : ERROR_NAMES[errorCode] ?? 'UNRECORDED', deadlineMs, latencyMs: finite(request.settleMs) ? end - request.startMs : null,
    serverArrived: finite(request.arrivalMs), serverArrivalMs: finite(request.arrivalMs) ? request.arrivalMs : null,
    serverFinishMs: finite(request.finishMs) ? request.finishMs : null,
    observedWindowMs: end - request.startMs,
    deadlineExceeded: finite(request.settleMs) ? end - request.startMs > deadlineMs || request.timedOut === true : request.timedOut === true ? true : null,
    deadlineOvershootMs: finite(request.settleMs) ? Math.max(0, end - request.startMs - deadlineMs) : null, timedOut: request.timedOut === true,
    complete: reasons.length === 0, missing: [...new Set(reasons)],
    startMs: request.startMs, settleMs: finite(request.settleMs) ? request.settleMs : null,
    phasesMs: partition.phasesMs, ambiguousMs: partition.ambiguousMs, residualMs: partition.residualMs,
    withinDeadlinePhasesMs: deadlinePartition.phasesMs,
    linkedPhysicalGroupIds: groups.map(group => group.id),
    // These are overlapping observations. Do not add to the exclusive phases.
    observations: {
      workerWallMs: groups.some(group => finite(group.workerWallMs)) ? sum(groups.map(group => group.workerWallMs ?? 0)) : null,
      workerThreadCpuMs: groups.some(group => finite(group.workerThreadCpuMs)) ? sum(groups.map(group => group.workerThreadCpuMs ?? 0)) : null,
      sqlWallMs: groups.some(group => finite(group.sqlWallMs)) ? sum(groups.map(group => group.sqlWallMs ?? 0)) : null,
      sqlThreadCpuMs: groups.some(group => finite(group.sqlThreadCpuMs)) ? sum(groups.map(group => group.sqlThreadCpuMs ?? 0)) : null,
      sqlCalls: groups.some(group => finite(group.sqlCalls)) ? sum(groups.map(group => group.sqlCalls ?? 0)) : null,
      sharedGroupValuesNotSummableAcrossClients: true,
      contextWaitMs: difference(request.contextEndMs, request.contextStartMs),
      serializeMs: difference(request.serializeEndMs, request.serializeStartMs),
      backgroundOverlap: request.backgroundOverlap ?? { physicalGroups: 0, queueMs: 0, workerWallMs: 0, causalAttribution: false },
      ...correlateSamples(request.startMs, end, cgroup, eventLoop),
    },
  };
  return result;
}

export function analyzeNormalized(input) {
  if (!input || !Array.isArray(input.requests) || !Array.isArray(input.physicalGroups)) throw Error('TRACE_INPUT_INVALID');
  const groups = new Map();
  const incomplete = [];
  for (const group of input.physicalGroups) {
    if (groups.has(group.id)) throw Error('TRACE_DUPLICATE_PHYSICAL_GROUP');
    groups.set(group.id, safePhysical(group));
  }
  const dropped = integer(input.dropped) ? input.dropped : 0;
  if (dropped > 0) incomplete.push('TRACE_DROPPED_EVENTS');
  if (input.complete !== true) incomplete.push('TRACE_COMPLETENESS_UNCONFIRMED');
  if (input.clockAligned !== true) incomplete.push('CLOCK_ALIGNMENT_UNCONFIRMED');
  const clientIds = new Set();
  const cases = input.requests.map(request => {
    if (clientIds.has(request.id)) throw Error('TRACE_DUPLICATE_CLIENT');
    clientIds.add(request.id);
    return analyzeRequest(request, groups, { cgroup: input.cgroup, eventLoop: input.eventLoop, traceIncomplete: incomplete.length > 0 });
  });
  if (!cases.length) incomplete.push('CLIENT_TRACE_EMPTY');
  if (cases.some(row => !row.complete)) incomplete.push('REQUEST_TRACE_INCOMPLETE');
  const physical = [...groups.values()];
  const total = key => physical.some(group => finite(group[key])) ? sum(physical.map(group => group[key] ?? 0)) : null;
  const percentiles = rows => ({ p50: quantile(rows.map(row => row.latencyMs), .5), p95: quantile(rows.map(row => row.latencyMs), .95), p99: quantile(rows.map(row => row.latencyMs), .99) });
  const success = cases.filter(row => row.status >= 200 && row.status < 300 && !row.timedOut && !row.errorCode);
  const sortedArrivals = cases.map(row => row.serverArrivalMs).filter(finite).sort((a, b) => a - b);
  const arrivalGaps = sortedArrivals.slice(1).map((value, i) => value - sortedArrivals[i]);
  return {
    schema: 1, diagnosticOnly: true, acceptance: false, complete: incomplete.length === 0,
    incompleteness: [...new Set(incomplete)], dropped, cases,
    summary: {
      requests: cases.length, deadlinesExceeded: cases.filter(row => row.deadlineExceeded).length,
      timedOut: cases.filter(row => row.timedOut).length, incompleteRequests: cases.filter(row => !row.complete).length,
      latencyMs: percentiles(cases), allAttemptLatencyMs: percentiles(cases), successLatencyMs: percentiles(success),
      successfulRequests: success.length,
      arrivalPatterns: { arrived: sortedArrivals.length, notArrived: cases.length - sortedArrivals.length, interArrivalMs: { p50: quantile(arrivalGaps, .5), p95: quantile(arrivalGaps, .95), p99: quantile(arrivalGaps, .99) }, bins: arrivalBins(cases) },
      physicalGroups: physical.length,
      // Sum each physical operation once, independent of logical fan-out.
      physicalTotals: { sqlCalls: total('sqlCalls'), sqlWallMs: total('sqlWallMs'), sqlThreadCpuMs: total('sqlThreadCpuMs'), workerThreadCpuMs: total('workerThreadCpuMs'), workerWallMs: total('workerWallMs') },
      cpuCausalityEstablished: false,
    },
  };
}

function arrivalBins(cases) {
  if (!cases.length) return [];
  const origin = Math.min(...cases.map(row => row.startMs));
  const bins = new Map();
  for (const row of cases) for (const [field, time] of [['started', row.startMs], ['arrived', row.serverArrivalMs]]) {
    if (!finite(time)) continue;
    const index = Math.floor((time - origin) / 100);
    const bin = bins.get(index) ?? { fromStartMs: index * 100, widthMs: 100, started: 0, arrived: 0 };
    bin[field]++; bins.set(index, bin);
  }
  return [...bins.values()].sort((a, b) => a.fromStartMs - b.fromStartMs);
}

const TRACE_COLUMNS = ['seq', 'monoMs', 'event', 'http', 'command', 'group', 'a', 'b', 'c', 'd', 'e', 'f'];
const TRACE_EVENTS = { CLIENT_START: 1, CLIENT_SOCKET: 2, CLIENT_CONNECT: 3, CLIENT_HEADERS: 4, CLIENT_END: 5, CLIENT_DEADLINE: 6,
  HTTP_ARRIVAL: 10, HTTP_FINISH: 11, HTTP_CLOSE: 12, HTTP_ABORTED: 13, HTTP_HANDLER_END: 14,
  AUTH_START: 20, AUTH_END: 21, CONTEXT_INIT: 22, CONTEXT_WAIT: 23, CONTEXT_READY: 24, RESPONSE_BEGIN: 25, RESPONSE_END: 26,
  ADMISSION: 30, ADMISSION_REJECT: 31, DISPATCH: 32, DISPATCH_MEMBER: 33, SETTLE: 34, MAIN_RECEIPT: 35,
  WORKER_RECEIVE: 40, WORKER_START: 41, WORKER_END: 42, WORKER_POST_BEGIN: 43, WORKER_POST_END: 44, SQL_BEGIN: 50, SQL_END: 51, LOOP_TICK: 60 };
const MAX_FILE_BYTES = 16 * 1024 * 1024;

function boundedRead(file) {
  if (statSync(file).size > MAX_FILE_BYTES) throw Error('TRACE_FILE_TOO_LARGE');
  return readFileSync(file);
}

function json(file) { return JSON.parse(boundedRead(file).toString('utf8')); }

function reportPath(root, value) {
  if (typeof value !== 'string' || !value) throw Error('TRACE_ARTIFACT_PATH_MISSING');
  const result = resolve(root, value);
  const relative = result.slice(root.length);
  if (!result.startsWith(root) || relative && !['/', '\\'].includes(relative[0])) throw Error('TRACE_ARTIFACT_OUTSIDE_ROOT');
  const canonicalRoot = realpathSync(root), canonical = realpathSync(result), canonicalRelative = canonical.slice(canonicalRoot.length);
  if (!canonical.startsWith(canonicalRoot) || canonicalRelative && !['/', '\\'].includes(canonicalRelative[0])) throw Error('TRACE_ARTIFACT_OUTSIDE_ROOT');
  return canonical;
}

export function decodeTrace(dir) {
  const records = [], issues = [], roles = [];
  let dropped = 0;
  for (const role of ['main', 'worker', 'client']) {
    try {
      const meta = json(join(dir, `${role}.meta.json`)), data = boundedRead(join(dir, `${role}.bin`));
      if (meta.version !== 1 || meta.role !== role || meta.byteOrder !== 'LE' || meta.recordBytes !== 96 || JSON.stringify(meta.columns) !== JSON.stringify(TRACE_COLUMNS) || !integer(meta.count) || !integer(meta.capacity) || meta.count > meta.capacity || data.length !== meta.count * 96 || !integer(meta.dropped)) throw Error('TRACE_BINARY_SCHEMA_INVALID');
      if (Object.entries(TRACE_EVENTS).some(([name, value]) => meta.events?.[name] !== value)) throw Error('TRACE_EVENT_SCHEMA_INVALID');
      if (meta.clock !== 'Number(process.hrtime.bigint())/1e6' || !nonnegative(meta.anchor?.monoMs) || !nonnegative(meta.anchor?.unixMs)) issues.push('CLOCK_METADATA_MISSING');
      if (meta.complete !== true || meta.dropped) issues.push('TRACE_ROLE_INCOMPLETE');
      dropped += meta.dropped;
      let previousTime = -Infinity;
      for (let i = 0; i < meta.count; i++) {
        const record = { role };
        for (let column = 0; column < 12; column++) record[TRACE_COLUMNS[column]] = data.readDoubleLE(i * 96 + column * 8);
        if (TRACE_COLUMNS.some(column => !finite(record[column])) || record.seq !== i + 1 || record.monoMs < previousTime || ['event', 'http', 'command', 'group'].some(column => !integer(record[column]))) throw Error('TRACE_BINARY_RECORD_INVALID');
        previousTime = record.monoMs; records.push(record);
      }
      roles.push({ role, count: meta.count, dropped: meta.dropped, capacity: meta.capacity, allocatedBytes: nonnegative(meta.allocatedBytes) ? meta.allocatedBytes : null, threadCpuAvailable: meta.threadCpuAvailable === true, sqlThreadCpuAvailable: meta.sqlThreadCpuAvailable === true || meta.threadCpuAvailable === true, monoAnchorMs: meta.anchor?.monoMs, unixAnchorMs: meta.anchor?.unixMs });
    } catch (error) {
      issues.push(error?.message?.startsWith('TRACE_') ? error.message : 'TRACE_ROLE_ARTIFACT_MISSING');
    }
  }
  records.sort((a, b) => a.monoMs - b.monoMs || a.seq - b.seq);
  return { records, roles, dropped, complete: issues.length === 0 && roles.length === 3, issues: [...new Set(issues)] };
}

export function normalizeTrace(decoded, cgroupInput = {}) {
  const E = TRACE_EVENTS, clients = new Map(), http = new Map(), commands = new Map(), groups = new Map(), contexts = new Map(), loop = [];
  const issues = [...decoded.issues];
  const add = (map, id, initial = {}) => { if (!map.has(id)) map.set(id, { id, ...initial }); return map.get(id); };
  const workerRole = decoded.roles.find(role => role.role === 'worker');
  let unassignedSqlCalls = 0;
  for (const event of decoded.records) {
    const type = event.event, time = event.monoMs;
    if (type === E.CLIENT_START) {
      if (clients.has(event.http)) issues.push('CLIENT_START_DUPLICATE');
      clients.set(event.http, { id: event.http, startMs: time, deadlineMs: event.b, route: event.a });
    }
    const client = clients.get(event.http);
    if (client) {
      if (type === E.CLIENT_SOCKET) client.socketMs = time;
      if (type === E.CLIENT_CONNECT) client.connectMs = time;
      if (type === E.CLIENT_END) { client.settleMs = time; client.errorCode = event.a; client.status = event.b; }
      if (type === E.CLIENT_DEADLINE) client.timedOut = true;
    }
    if (event.http > 0 && [E.HTTP_ARRIVAL, E.HTTP_FINISH, E.HTTP_CLOSE, E.RESPONSE_BEGIN, E.RESPONSE_END, E.CONTEXT_WAIT, E.CONTEXT_READY, E.ADMISSION_REJECT].includes(type)) {
      const entry = add(http, event.http, { contextIds: [] });
      if (type === E.HTTP_ARRIVAL) entry.arrivalMs = time;
      if (type === E.HTTP_FINISH) entry.finishMs = time;
      if (type === E.HTTP_CLOSE) { entry.closeMs = time; entry.finished = Boolean(event.a); }
      if (type === E.RESPONSE_BEGIN) entry.serializeStartMs = entry.responseStartMs = time;
      if (type === E.RESPONSE_END) entry.serializeEndMs = time;
      if (type === E.ADMISSION_REJECT) entry.admissionErrorCode = event.b;
      if (type === E.CONTEXT_WAIT) { entry.contextStartMs = time; if (!event.b) entry.contextIds.push(event.a); }
      if (type === E.CONTEXT_READY) entry.contextEndMs = time;
    }
    if ([E.ADMISSION, E.DISPATCH_MEMBER, E.SETTLE].includes(type)) {
      const command = add(commands, event.command, { http: event.http });
      if (type === E.ADMISSION) { command.enqueueMs = time; command.type = event.a; command.contextId = event.b; }
      if (type === E.DISPATCH_MEMBER) { command.groupId = event.group; command.dispatched = true; }
      if (type === E.SETTLE) { command.settleMs = time; command.errorCode = event.b; command.dispatched ??= Boolean(event.group); }
    }
    if (event.group > 0 && [E.DISPATCH, E.WORKER_START, E.WORKER_END, E.MAIN_RECEIPT, E.SQL_END].includes(type)) {
      const group = add(groups, event.group, { sqlCalls: 0, sqlWallMs: 0, sqlThreadCpuMs: workerRole?.sqlThreadCpuAvailable ? 0 : null, stages: {} });
      if (type === E.DISPATCH) group.dispatchMs = time;
      if (type === E.WORKER_START) group.workerStartMs = time;
      if (type === E.WORKER_END) { group.workerEndMs = time; group.workerThreadCpuMs = workerRole?.threadCpuAvailable && nonnegative(event.a) ? event.a : null; }
      if (type === E.MAIN_RECEIPT && event.a === 1) group.replyMs = time;
      if (type === E.SQL_END) {
        group.sqlCalls += event.e; group.sqlWallMs += event.c;
        if (group.sqlThreadCpuMs !== null && nonnegative(event.d)) group.sqlThreadCpuMs += event.d;
        const stage = group.stages[event.a] ??= { calls: 0, wallMs: 0, threadCpuMs: workerRole?.sqlThreadCpuAvailable ? 0 : null };
        stage.calls += event.e; stage.wallMs += event.c;
        if (stage.threadCpuMs !== null && nonnegative(event.d)) stage.threadCpuMs += event.d;
      }
    }
    if (type === E.SQL_END && !event.group) unassignedSqlCalls += event.e;
    if (type === E.LOOP_TICK) loop.push({ startMs: event.a, endMs: time, maxDelayMs: event.b });
  }
  for (const command of commands.values()) if (command.type === 1 && command.contextId && command.groupId) {
    const context = add(contexts, command.contextId, { commands: [] }); context.commands.push(command);
  }
  const requests = [...clients.values()].map(client => {
    const server = http.get(client.id) ?? {};
    // The diagnostic workload is GET state/history only. ensure/read/readView
    // are awaited; inherited ALS context does not make refresh work causal.
    const attached = [...commands.values()].filter(command => command.http === client.id);
    const linked = attached.filter(command => [1, 2, 3].includes(command.type));
    const background = attached.filter(command => ![1, 2, 3].includes(command.type));
    for (const contextId of server.contextIds ?? []) for (const command of contexts.get(contextId)?.commands ?? []) if (!linked.includes(command)) linked.push(command);
    const clip = (start, end) => [Math.max(client.startMs, start), Math.min(client.settleMs ?? client.startMs + client.deadlineMs, end)];
    const backgroundGroups = [...new Set(background.map(command => command.groupId).filter(integer))].map(id => groups.get(id)).filter(Boolean);
    if (finite(server.arrivalMs) && server.arrivalMs < client.startMs) issues.push('CLOCK_CAUSAL_ORDER_VIOLATION');
    return { ...client, ...server, id: client.id,
      errorCode: client.errorCode || server.admissionErrorCode || 0,
      commands: linked.map(command => ({ ...command, enqueueMs: command.http === client.id ? command.enqueueMs : Math.max(server.contextStartMs ?? client.startMs, command.enqueueMs ?? client.startMs) })),
      groupIds: [...new Set(linked.map(command => command.groupId).filter(integer))],
      backgroundOverlap: { physicalGroups: backgroundGroups.length, queueMs: unionDuration(background.map(command => clip(command.enqueueMs, groups.get(command.groupId)?.dispatchMs ?? command.settleMs))), workerWallMs: unionDuration(backgroundGroups.map(group => clip(group.workerStartMs, group.workerEndMs))), causalAttribution: false },
    };
  });
  if (decoded.records.some(record => record.role === 'client' && record.http > 0 && !clients.has(record.http))) issues.push('CLIENT_START_MISSING');
  const samples = parseCgroup(cgroupInput.samples ?? []);
  return { requests, physicalGroups: [...groups.values()], cgroup: samples, eventLoop: loop, dropped: decoded.dropped,
    complete: decoded.complete && issues.length === 0, clockAligned: !issues.includes('CLOCK_METADATA_MISSING') && !issues.includes('CLOCK_CAUSAL_ORDER_VIOLATION'),
    diagnostics: { issues: [...new Set(issues)], unassignedSqlCalls, sqlStagesByGroup: [...groups.values()].map(group => ({ groupId: group.id, stages: group.stages })) },
  };
}

function keyValues(text) {
  const values = {};
  if (text && typeof text === 'object' && !Array.isArray(text)) {
    for (const key of ['usage_usec', 'throttled_usec', 'nr_throttled']) if (nonnegative(text[key])) values[key] = text[key];
    return values;
  }
  if (typeof text !== 'string') return values;
  for (const line of text.split('\n')) { const match = /^([a-z_]+)\s+(\d+)$/.exec(line.trim()); if (match) values[match[1]] = Number(match[2]); }
  return values;
}

export function parseCgroup(samples) {
  return samples.map(sample => {
    const cpu = keyValues(sample.cpuStat), io = { rbytes: 0, wbytes: 0, rios: 0, wios: 0 };
    let hasIo = false;
    if (Array.isArray(sample.ioStat)) for (const row of sample.ioStat) {
      if (!/^\d+:\d+$/.test(row.device)) continue;
      for (const key of Object.keys(io)) if (nonnegative(row[key])) { io[key] += row[key]; hasIo = true; }
    }
    if (typeof sample.ioStat === 'string') for (const line of sample.ioStat.split('\n')) {
      if (!/^\d+:\d+\s/.test(line)) continue;
      for (const match of line.matchAll(/\b(rbytes|wbytes|rios|wios)=(\d+)/g)) { io[match[1]] += Number(match[2]); hasIo = true; }
    }
    return { tMs: sample.monoMs, usageUsec: cpu.usage_usec, throttledUsec: cpu.throttled_usec, nrThrottled: cpu.nr_throttled,
      ioReadBytes: hasIo ? io.rbytes : null, ioWriteBytes: hasIo ? io.wbytes : null, ioReadOps: hasIo ? io.rios : null, ioWriteOps: hasIo ? io.wios : null };
  }).filter(sample => nonnegative(sample.tMs));
}

const METRICS = ['cpuMs', 'peakRssBytes', 'p50Ms', 'p95Ms', 'p99Ms', 'sqlCalls', 'ioWriteBytes', 'requests', 'timeouts'];
function delta(before, after) {
  if (!finite(before) || !finite(after)) return { before: finite(before) ? before : null, after: finite(after) ? after : null, absolute: null, percent: null };
  return { before, after, absolute: after - before, percent: before === 0 ? (after === 0 ? 0 : null) : (after - before) / before * 100 };
}

export function compareRuns(runs, { expectedRepeats = 3, overheadLimits = {} } = {}) {
  if (!Array.isArray(runs) || !integer(expectedRepeats) || expectedRepeats === 0) throw Error('TRACE_COMPARISON_INVALID');
  const buckets = new Map();
  for (const run of runs) {
    if (!['off', 'on'].includes(run.traceMode) || !integer(run.repeat) || run.repeat < 1 || typeof run.head !== 'string' || !/^[a-f0-9]{40}$/.test(run.head) || typeof run.conditionKey !== 'string' || !/^[a-f0-9]{64}$/.test(run.conditionKey)) throw Error('TRACE_RUN_IDENTITY_INVALID');
    const key = `${run.head}:${run.conditionKey}`;
    const bucket = buckets.get(key) ?? { head: run.head, conditionKey: run.conditionKey, runs: new Map() };
    const pair = bucket.runs.get(run.repeat) ?? {};
    if (pair[run.traceMode]) throw Error('TRACE_DUPLICATE_RUN');
    pair[run.traceMode] = run;
    bucket.runs.set(run.repeat, pair); buckets.set(key, bucket);
  }
  const conditions = [...buckets.values()].map(bucket => {
    const pairs = [], missing = [];
    for (let repeat = 1; repeat <= expectedRepeats; repeat++) {
      const pair = bucket.runs.get(repeat) ?? {};
      if (!pair.off || !pair.on) { missing.push({ repeat, off: Boolean(pair.off), on: Boolean(pair.on) }); continue; }
      const metrics = Object.fromEntries(METRICS.map(metric => [metric, delta(pair.off.metrics?.[metric], pair.on.metrics?.[metric])]));
      const assessments = Object.entries(overheadLimits).map(([metric, limit]) => {
        if (!METRICS.includes(metric) || !nonnegative(limit.maxIncreasePercent)) throw Error('TRACE_OVERHEAD_LIMIT_INVALID');
        const percent = metrics[metric].percent;
        return { metric, maxIncreasePercent: limit.maxIncreasePercent, observedPercent: percent, status: percent === null ? 'UNAVAILABLE' : percent <= limit.maxIncreasePercent ? 'WITHIN_CONFIGURED_LIMIT' : 'EXCEEDS_CONFIGURED_LIMIT' };
      });
      pairs.push({ repeat, metrics, overheadAssessment: assessments.length ? assessments : [{ status: 'NOT_ASSESSED_NO_CONFIGURED_LIMIT' }] });
    }
    return { head: bucket.head, conditionKey: bucket.conditionKey, expectedRepeats, matchedRepeats: pairs.length, missing, pairs,
      medianPercentOverhead: Object.fromEntries(METRICS.map(metric => [metric, median(pairs.map(pair => pair.metrics[metric].percent))])),
      complete: !missing.length,
    };
  });
  return { schema: 1, diagnosticOnly: true, acceptance: false, complete: conditions.length > 0 && conditions.every(condition => condition.complete), expectedRepeats, configuredOverheadLimits: overheadLimits, conditions };
}

const sha = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const KNOWN_REVISIONS = { before: 'de565eac17a8477e0dd4c50c2dc936b2bea21990', after: '010eb8716755c48aeb62baaf8602fb7ff837859f' };
const safeCode = error => /^TRACE_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'TRACE_ARTIFACT_UNREADABLE';
const numeric = (value, keys) => Object.fromEntries(keys.map(key => [key, nonnegative(value?.[key]) ? value[key] : null]));

function readerSummary(reader) {
  return { ...numeric(reader, ['requests', 'ok', 'errors', 'timeouts', 'users', 'elapsedMs', 'externalApiCalls']),
    successLatencyMs: numeric(reader?.latencyMs, ['p50', 'p95', 'p99', 'max']),
    allAttemptLatencyMs: numeric(reader?.allAttemptLatencyMs, ['p50', 'p95', 'p99', 'max']),
    statuses: Object.fromEntries(Object.entries(reader?.statuses ?? {}).filter(([key, value]) => /^\d{3}$/.test(key) && nonnegative(value))),
    httpErrorCodes: Object.fromEntries(Object.entries(reader?.httpErrorCodes ?? {}).filter(([key, value]) => (ERROR_NAMES.includes(key) || key === 'UNRECORDED') && nonnegative(value))),
  };
}

function workloadMetrics(reader, metrics, cgroup) {
  const boundaries = parseCgroup([cgroup?.workload?.start ?? {}, cgroup?.workload?.end ?? {}]);
  const ioWriteBytes = boundaries.length === 2 ? difference(boundaries[1].ioWriteBytes, boundaries[0].ioWriteBytes) : null;
  const cpuUsec = boundaries.length === 2 ? difference(boundaries[1].usageUsec, boundaries[0].usageUsec) : null;
  const start = cgroup?.workload?.start?.monoMs, end = cgroup?.workload?.end?.monoMs;
  const memory = (cgroup?.samples ?? []).filter(sample => sample.monoMs >= start && sample.monoMs <= end).map(sample => sample.memoryCurrent).filter(nonnegative);
  return {
    cpuMs: cpuUsec === null ? null : cpuUsec / 1000,
    // RSS from fixture, and sampled cgroup memory are distinct measures.
    peakRssBytes: nonnegative(metrics?.maxRssBytes) ? metrics.maxRssBytes : null,
    peakCgroupMemoryBytes: memory.length ? Math.max(...memory) : null,
    p50Ms: reader?.allAttemptLatencyMs?.p50 ?? null, p95Ms: reader?.allAttemptLatencyMs?.p95 ?? null, p99Ms: reader?.allAttemptLatencyMs?.p99 ?? null,
    successfulP95Ms: reader?.latencyMs?.p95 ?? null,
    sqlCalls: nonnegative(metrics?.sqlCalls) ? metrics.sqlCalls : null,
    ioWriteBytes, requests: reader?.requests ?? null, timeouts: reader?.timeouts ?? null,
    workloadWindowMs: difference(end, start), cpuWindow: 'cgroup workload.start/end; excludes shutdown and trace flush',
  };
}

export function analyzeManifest(manifest, root, output) {
  root = resolve(root); output = resolve(output);
  if (manifest?.schemaVersion !== 1 || manifest.diagnosticOnly !== true || manifest.acceptance !== false || !Array.isArray(manifest.runs)) throw Error('TRACE_MANIFEST_INVALID');
  const issues = [], runs = [], comparisons = [];
  if (manifest.complete !== true) issues.push('RUNNER_INCOMPLETE');
  if (manifest.runs.length !== 12) issues.push('TWELVE_MATCHED_RUNS_REQUIRED');
  if (Object.entries(KNOWN_REVISIONS).some(([variant, revision]) => manifest.revisions?.[variant] !== revision)) issues.push('REVISION_MANIFEST_MISMATCH');
  const sourcesMatch = manifest.sources?.before?.workloadHash && manifest.sources?.before?.workloadHash === manifest.sources?.after?.workloadHash && manifest.sources?.before?.fixtureHash === manifest.sources?.after?.fixtureHash;
  if (!sourcesMatch) issues.push('ORIGINAL_WORKLOAD_HASH_MISMATCH');
  mkdirSync(output, { recursive: true });
  const seen = new Set();
  for (const run of manifest.runs) {
    const row = { runId: /^[a-zA-Z0-9_-]{1,80}$/.test(run.runId ?? '') ? run.runId : null,
      revision: /^[a-f0-9]{40}$/.test(run.revision ?? '') ? run.revision : null,
      traceEnabled: run.traceEnabled === true, repeat: integer(run.repeat) ? run.repeat : null, issues: [] };
    if (!row.runId || seen.has(row.runId)) throw Error('TRACE_RUN_NAME_INVALID');
    seen.add(row.runId);
    if (run.complete !== true) row.issues.push('RUNNER_CASE_INCOMPLETE');
    if (row.revision !== KNOWN_REVISIONS[run.variant]) row.issues.push('RUN_REVISION_MISMATCH');
    let reader, metrics, cgroup, sources;
    for (const [key, setter] of [['readerPath', value => { reader = value; }], ['metricsPath', value => { metrics = value; }], ['cgroupPath', value => { cgroup = value; }], ['sourceHashesPath', value => { sources = value; }]]) {
      try { setter(json(reportPath(root, run[key]))); } catch (error) { row.issues.push(`${key.toUpperCase()}_${safeCode(error)}`); }
    }
    if (sources?.revision !== row.revision || !/^[a-f0-9]{40}$/.test(sources?.gitTree ?? '') || !/^[a-f0-9]{64}$/.test(sources?.archiveSha256 ?? '')) row.issues.push('SOURCE_PROVENANCE_INCOMPLETE');
    row.sourceProvenance = sources ? { revision: row.revision, gitTree: /^[a-f0-9]{40}$/.test(sources.gitTree ?? '') ? sources.gitTree : null, sourceHashesSha256: sha(boundedRead(reportPath(root, run.sourceHashesPath))) } : null;
    if (cgroup?.droppedSamples || cgroup?.sampleErrors) row.issues.push('CGROUP_SAMPLES_INCOMPLETE');
    if (!nonnegative(cgroup?.workload?.start?.monoMs) || !nonnegative(cgroup?.workload?.end?.monoMs)) row.issues.push('CGROUP_WORKLOAD_WINDOW_MISSING');
    if (cgroup?.bounds?.cpuMax?.trim() !== '5000 100000' || Number(cgroup?.bounds?.memoryMax) !== 268435456 || !cgroup?.bounds?.ioMax?.split('\n').some(line => /\brbps=1048576\b/.test(line) && /\bwbps=131072\b/.test(line))) row.issues.push('ORIGINAL_CGROUP_BOUNDS_UNCONFIRMED');
    row.reader = readerSummary(reader);
    row.metrics = workloadMetrics(reader, metrics, cgroup);
    if (run.traceEnabled) {
      try {
        const decoded = decodeTrace(reportPath(root, run.traceDir));
        const normalized = normalizeTrace(decoded, cgroup);
        const analysis = writeAnalysis(normalized, join(output, row.runId));
        row.trace = { complete: analysis.complete, roles: decoded.roles, issues: normalized.diagnostics.issues, dropped: decoded.dropped, summary: analysis.summary };
        if (!analysis.complete) row.issues.push('JOINED_TRACE_INCOMPLETE');
        if (reader?.requests !== analysis.summary.requests) row.issues.push('CLIENT_COUNT_DIFFERS_FROM_READER');
        writeFileSync(join(output, row.runId, 'physical-sql-stages.json'), JSON.stringify(normalized.diagnostics, null, 2) + '\n');
      } catch (error) { row.issues.push(safeCode(error)); }
    } else row.trace = { enabled: false, expectedArtifacts: false, complete: null };
    if (row.revision && /^[a-f0-9]{64}$/.test(run.workloadSignature ?? '') && /^[a-f0-9]{64}$/.test(run.resourceSignature ?? '') && row.repeat) comparisons.push({ head: row.revision, conditionKey: sha({ workload: run.workloadSignature, resources: run.resourceSignature }), traceMode: row.traceEnabled ? 'on' : 'off', repeat: row.repeat, metrics: row.metrics });
    else row.issues.push('MATCHED_CONDITIONS_UNCONFIRMED');
    row.complete = row.issues.length === 0;
    runs.push(row);
  }
  const overhead = compareRuns(comparisons, { expectedRepeats: 3, overheadLimits: manifest.overheadLimits ?? {} });
  if (!overhead.complete) issues.push('OFF_ON_PAIRS_INCOMPLETE');
  if (runs.some(run => run.issues.length)) issues.push('RUN_EVIDENCE_INCOMPLETE');
  const result = { schema: 1, diagnosticOnly: true, acceptance: false, complete: issues.length === 0, issues, runs, overhead,
    limitations: ['Diagnostic workload with tracing is not a replacement for unchanged acceptance tests.', 'SQL wall/thread CPU overlap worker wall time; never sum them as exclusive latency.', 'Cgroup throttle and event-loop observations are shared intervals, not exclusive request CPU causality.', 'OFF/ON overhead thresholds apply only when explicitly supplied; no threshold is invented.', 'Missing, dropped or unaligned traces cannot establish absence of a bottleneck.'] };
  writeFileSync(join(output, 'analysis.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(output, 'overhead.json'), JSON.stringify(overhead, null, 2) + '\n');
  writeFileSync(join(output, 'REPORT.md'), manifestMarkdown(result));
  return result;
}

function manifestMarkdown(result) {
  const lines = ['# Stocks joined trace diagnostics', '', '**Diagnostic only; acceptance: false.**', '', `Evidence complete: ${result.complete}.`, '', '| Run | Trace | Reader errors | Timeouts | All-attempt p95 ms | Successful p95 ms | CPU ms | Cgroup I/O written bytes | Trace evidence |', '|---|---:|---:|---:|---:|---:|---:|---:|---|'];
  for (const run of result.runs) lines.push(`| ${run.runId} | ${run.traceEnabled ? 'ON' : 'OFF'} | ${run.reader.errors ?? 'unknown'} | ${run.reader.timeouts ?? 'unknown'} | ${run.reader.allAttemptLatencyMs.p95 ?? 'unknown'} | ${run.reader.successLatencyMs.p95 ?? 'unknown'} | ${run.metrics.cpuMs ?? 'unknown'} | ${run.metrics.ioWriteBytes ?? 'unknown'} | ${run.issues.join(', ') || 'complete'} |`);
  lines.push('', 'Per-client files preserve the original 3-second budget separately from actual timeout-callback overshoot. Physical SQL groups count once; shared client observations must not be summed.', '', ...result.limitations.map(value => `- ${value}`), '', `Outstanding evidence issues: ${result.issues.join(', ') || 'none'}.`, '');
  return lines.join('\n');
}

function csv(analysis) {
  const columns = ['id', 'status', 'errorCode', 'errorName', 'deadlineMs', 'latencyMs', 'deadlineExceeded', 'deadlineOvershootMs', 'complete', ...PHASES, 'sqlWallMs', 'workerThreadCpuMs', 'sqlThreadCpuMs', 'residualMs'];
  const rows = analysis.cases.map(row => [row.id, row.status, row.errorCode, row.errorName, row.deadlineMs, row.latencyMs, row.deadlineExceeded, row.deadlineOvershootMs, row.complete, ...PHASES.map(phase => row.phasesMs[phase]), row.observations.sqlWallMs, row.observations.workerThreadCpuMs, row.observations.sqlThreadCpuMs, row.residualMs]);
  return [columns, ...rows].map(row => row.map(value => value ?? '').join(',')).join('\n') + '\n';
}

export function writeAnalysis(input, output) {
  const analysis = analyzeNormalized(input);
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
  writeFileSync(join(output, 'requests.csv'), csv(analysis));
  if (input.runs) writeFileSync(join(output, 'overhead.json'), JSON.stringify(compareRuns(input.runs, input.comparison), null, 2) + '\n');
  return analysis;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const inputIndex = args.indexOf('--input'), outputIndex = args.indexOf('--output');
    const positional = args.length === 1 && !args[0].startsWith('--') ? resolve(args[0]) : null;
    if (!positional && (inputIndex < 0 || outputIndex < 0 || !args[inputIndex + 1] || !args[outputIndex + 1])) throw Error('TRACE_ANALYZER_USAGE');
    const source = positional ? join(positional, 'manifest.json') : resolve(args[inputIndex + 1]), output = positional ? join(positional, 'analysis') : resolve(args[outputIndex + 1]);
    const input = JSON.parse(readFileSync(source, 'utf8'));
    const result = input.schemaVersion === 1 && Array.isArray(input.runs) ? analyzeManifest(input, dirname(source), output) : writeAnalysis(input, output);
    console.log(JSON.stringify({ diagnosticOnly: true, acceptance: false, complete: result.complete, requests: result.summary?.requests, runs: result.runs?.length }));
    if (!result.complete) process.exitCode = 1;
  } catch (error) {
    // Never echo paths or arbitrary input content through parser errors.
    const safe = typeof error?.message === 'string' && /^TRACE_[A-Z_]+$/.test(error.message) ? error.message : 'TRACE_ANALYSIS_FAILED';
    console.error(safe); process.exitCode = 1;
  }
}
