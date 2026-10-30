'use strict';

// Accept only sanitized cpu-http-profile output. No cross-process subtraction.
function percentile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  return a[Math.max(0, Math.ceil(a.length * p) - 1)];
}
function distribution(values) {
  return { count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99) };
}
function category(frame) {
  if (frame?.name === '(garbage collector)') return 'gc';
  if (frame?.name === '(idle)') return 'idle';
  if (['parse', 'stringify'].includes(frame?.name)) return 'json-or-same-named-function';
  const s = frame?.source ?? '';
  if (s.includes('undici')) return 'undici';
  if (s.includes('jsonwebtoken') || s.includes('node:internal/crypto')) return 'jwt-or-other-crypto';
  if (s.includes('prisma') || s.includes('postgres-authority')) return 'postgres-client-or-authority-js';
  if (s.startsWith('scripts/qa/')) return 'generator-or-instrumentation';
  if (s.includes('stocks-global')) return 'stocks-js';
  if (s.startsWith('src/')) return 'api-js';
  if (/http|net|stream/.test(s) && s.startsWith('node:')) return 'node-http-tcp-stream';
  return s.startsWith('node:') ? 'node-other' : 'external-or-unmapped';
}
function summarize(result) {
  if (result?.schema !== 1 || !Array.isArray(result.events)) throw Error('SANITIZED_PROFILE_REQUIRED');
  const byRequest = new Map(), sockets = new Set(), phase = {
    createToSend: [], sendToHeaders: [], headersToTrailers: [], serverCallbackToFinish: [] };
  let sent = 0, accepted = 0, errors = 0;
  for (const event of result.events) {
    if (event.kind === 'server.accept') accepted++;
    if (event.kind === 'undici:request:error') errors++;
    if (event.kind === 'undici:client:sendHeaders') { sent++; if (event.socket !== null) sockets.add(event.socket); }
    // Server/client counters share the same WeakMap, so IDs are unique within the process.
    if (event.request === null || event.request === undefined) continue;
    const times = byRequest.get(event.request) ?? new Map(); times.set(event.kind, event.ms); byRequest.set(event.request, times);
  }
  const pairs = [
    ['createToSend', 'undici:request:create', 'undici:client:sendHeaders'],
    ['sendToHeaders', 'undici:client:sendHeaders', 'undici:request:headers'],
    ['headersToTrailers', 'undici:request:headers', 'undici:request:trailers'],
    ['serverCallbackToFinish', 'server.callback', 'server.finish'],
  ];
  for (const times of byRequest.values()) for (const [key, start, end] of pairs) {
    if (times.has(start) && times.has(end) && times.get(end) >= times.get(start)) phase[key].push(times.get(end) - times.get(start));
  }
  const nodes = new Map((result.profile?.nodes ?? []).map(n => [n.id, n]));
  const samples = result.profile?.samples ?? [], buckets = {};
  for (const id of samples) { const key = category(nodes.get(id)?.frame); buckets[key] = (buckets[key] ?? 0) + 1; }
  return { role: result.role, node: result.node, elapsedMs: result.elapsedMs,
    processCpuMs: ((result.cpuMicroseconds?.user ?? 0) + (result.cpuMicroseconds?.system ?? 0)) / 1000,
    sentRequests: sent, acceptedConnections: accepted, sendSockets: sockets.size,
    requestsPerSendSocket: sockets.size ? sent / sockets.size : null, requestErrors: errors,
    phasesMs: Object.fromEntries(Object.entries(phase).map(([key, values]) => [key, distribution(values)])),
    sampleCounts: buckets, totalSamples: samples.length,
    incomplete: !!(result.droppedEvents || result.profile?.droppedNodes || result.profile?.droppedSamples || result.profileError || result.reason === 'deadline'),
    limitations: ['Phase percentiles must not be subtracted from one another.',
      'CPU sample categories are attribution hints, not exclusive CPU timers or proof of SQL CPU.',
      'No API-versus-generator clock subtraction; raw clock anchors are for uncertainty analysis.',
      'Compare instrumentation off/on separately before drawing capacity conclusions.'] };
}
module.exports = { summarize };
