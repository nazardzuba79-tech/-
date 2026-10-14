// Produces a guarded disposable entry; never writes the original fixture.
import assert from 'node:assert/strict';
import { digest, BASELINE } from './closure.mjs';

export const ENTRY = 'services/stocks/auth-http-fixture-512/stock-child.mjs';
export const ENTRY_SHA256 = '5afc4287b4b314c3bf9edb26443a2eab68c6bb459be382b4f545e0afcc8d1fec';
// Only an id-less state read receives the diagnostic correlation value. The
// product proxy already forwards this header; state without id creates no lease.
export const TRACE_HEADER_SOURCE = `if (req.method === 'GET' && req.url === '/__stocks_global/state' &&
            /^trace_(?:0[1-9]|[1-4][0-9]|50)$/.test(requestId)) req.headers['x-stocks-view'] = requestId;`;
export function transformServiceEntry(bytes) {
  const original = Buffer.from(bytes);
  assert.equal(digest(original), ENTRY_SHA256, 'TRACE_ENTRY_SOURCE_DRIFT');
  let source = original.toString('utf8');
  const hunks = [];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length - 1, 1, 'TRACE_ENTRY_HUNK_' + label);
    source = source.replace(before, after);
    hunks.push({ label, count: 1, originalFragmentSha256: digest(before), replacementSha256: digest(after) });
  };
  replace('qa-only-imports', "import assert from 'node:assert/strict';", `import assert from 'node:assert/strict';
import { verifyDerivedClosure } from '../auth-burst-trace-512/closure.mjs';
import { startWindow, stopWindow, snapshot as traceSnapshot, record, requestNumber, E } from '../auth-burst-trace-512/recorder.mjs';`);
  replace('deny-bootstrap', "if (op === 'bootstrap') {", "if (op === 'bootstrap') { throw Error('TRACE_CLOSED_SEED_REQUIRED');");
  replace('derived-closure', 'validateInit(input); const closure = verifyImageClosure(input.contextSha256);',
    'validateInit(input); const closure = verifyDerivedClosure(input.contextSha256, input.derivedManifestSha256);');
  replace('one-window-state', 'const events = [], metrics =', 'let traceStarted = false, traceStopped = false;\n  const events = [], metrics =');
  replace('observed-handler-wrapper-type', "assert.equal(handler.constructor.name, 'AsyncFunction');",
    "assert.equal(handler.constructor.name, 'Function');");
  replace('inactive-trace-proof', 'seed: current, providerStarts: 0, node: process.version, closure };',
    'seed: current, providerStarts: 0, node: process.version, closure, trace: traceSnapshot() };');
  replace('private-window-commands', "if (op === 'audit' || op === 'drain') return snapshot();", `if (op === 'startTraceWindow' || op === 'stopTraceWindow') {
      assert.ok(app && enabled && booted && !stopped, 'TRACE_SERVICE_NOT_READY');
      assert.equal(active, 0); assert.equal(metrics.activeHandlers, 0); assert.equal(metrics.handlerFailures, 0);
      assert.equal(app.accountMetrics().queue.pending, 0); assert.equal(app.accountMetrics().queue.active, 0);
      if (op === 'startTraceWindow') {
        assert.ok(!traceStarted && !traceStopped, 'TRACE_WINDOW_REPLAY');
        assert.deepEqual(Object.keys(input), ['requestIds']);
        const result = startWindow(input); traceStarted = true; return result;
      }
      assert.ok(traceStarted && !traceStopped, 'TRACE_WINDOW_NOT_ACTIVE');
      assert.deepEqual(Object.keys(input), []);
      const result = stopWindow(); traceStopped = true; return result;
    }
    if (op === 'audit' || op === 'drain') return snapshot();`);
  replace('gateway-entry', 'health ? metrics.health++ : metrics.requests++; active++;',
    `health ? metrics.health++ : metrics.requests++; active++;
        ${TRACE_HEADER_SOURCE}
        if (!health) record(E.GATEWAY_ENTRY, requestNumber(requestId));`);
  replace('gateway-terminal', 'finished = true; active--; event.endedMonoNs = mono();',
    `finished = true; active--; event.endedMonoNs = mono();
          if (!health) record(complete ? E.GATEWAY_FINISH : E.GATEWAY_CLOSE, requestNumber(requestId));`);
  const output = Buffer.from(source);
  return { output, manifest: { path: ENTRY, originalSha256: ENTRY_SHA256,
    outputSha256: digest(output), bytes: output.length, baseline: BASELINE, hunks, hunksSha256: digest(JSON.stringify(hunks)) } };
}
