'use strict';
// Isolated API diagnostics only. No request body, JWT, headers or identity logged.
const http = require('node:http');
const assert = require('node:assert/strict');
assert.equal(process.env.STOCKS_QUOTA_TRACE_APP, '133cb85a95003c229829b1ecef3d8d0e6308db95');
assert.equal(process.env.STOCKS_QUOTA_TRACE_SCOPE, 'disposable-private-topology');
const original = http.Server.prototype.emit;
let sequence = 0;
const startedAt=Date.now(), counts={};
let functionalSnapshot;
http.Server.prototype.emit = function(event, req, res, ...args) {
  if (event === 'request') {
    const port = req.socket.localPort;
    const route = /^\/api\/v1\/stocks-test-cash\/(identity|command|readiness)$/.exec(req.url)?.[1];
    if (route && port === 3001) res.once('finish', () => {
      const key=route+':'+res.statusCode; counts[key]=(counts[key]??0)+1;
      if(route==='readiness'&&req.headers['x-smoke-phase']==='after-functional-scenario'&&!functionalSnapshot)
        functionalSnapshot={at:Date.now(),elapsedMs:Date.now()-startedAt,counts:{...counts},remaining:res.getHeader('ratelimit-remaining'),resetSeconds:res.getHeader('ratelimit-reset')};
      console.log(JSON.stringify({ trace: 'private-quota', sequence: ++sequence,
        at: Date.now(), port, route, status: res.statusCode, counts, functionalSnapshot,
        limit: res.getHeader('ratelimit-limit'), remaining: res.getHeader('ratelimit-remaining'),
        resetSeconds: res.getHeader('ratelimit-reset'), retryAfter: res.getHeader('retry-after') }));
    });
  }
  return original.call(this, event, req, res, ...args);
};
