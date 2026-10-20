'use strict';
const cp = require('node:child_process');

function createDiagnostics({ secrets, write = console.log, dockerCommand = ['docker'], maxChars = 12000 }) {
  function redact(value) {
    let text = String(value ?? '');
    // Redact complete streams BEFORE truncation, including encoded credentials.
    const values = secrets.flatMap(value => value ? [value, encodeURIComponent(value)] : [])
      .sort((a, b) => b.length - a.length);
    for (const value of values) text = text.split(value).join('[CI-secret-redacted]');
    return text
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT-redacted]')
      .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
      .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[disposable-PG-URL-redacted]')
      .replace(/https?:\/\/[^\s/"'<>]+:[^\s/"'<>]+@[^\s"'<>]+/gi, '[credential-URL-redacted]');
  }
  function bounded(value) {
    const text = redact(value), marker = '\n[...truncated...]\n';
    if (text.length <= maxChars) return text;
    const half = Math.floor((maxChars - marker.length) / 2);
    return text.slice(0, half) + marker + text.slice(-half);
  }
  function emit(data) {
    write(JSON.stringify(data));
  }
  function invoke(binary, args, options = {}) {
    const result = cp.spawnSync(binary, args, {
      timeout: 60000, maxBuffer: 24 * 1024 * 1024, ...options,
      encoding: 'utf8', stdio: 'pipe',
    });
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '',
      status: result.status, signal: result.signal, errorCode: result.error?.code ?? null };
  }
  function output(result, context) {
    // stderr is an output stream, not a failure indication; use exit/signal/error.
    for (const stream of ['stdout', 'stderr']) if (result[stream]) emit({
      ...context, stream, status: result.status, signal: result.signal, errorCode: result.errorCode,
      text: bounded(result[stream]),
    });
  }
  function failed(result) { return result.status !== 0 || result.signal !== null || result.errorCode !== null; }
  function failure(result) {
    // Never include argv/env or spawn's raw error.message in public diagnostics.
    return Object.assign(new Error(`Command failed: exit=${result.status}, signal=${result.signal}, error=${result.errorCode}`),
      { status: result.status, signal: result.signal, errorCode: result.errorCode });
  }
  function command(binary, args, options) {
    const result = invoke(binary, args, options);
    if (failed(result)) {
      output(result, { stage: 'command-failure' });
      throw failure(result);
    }
    return result.stdout;
  }
  const docker = (args, options) => command(dockerCommand[0], [...dockerCommand.slice(1), ...args], options).trim();
  function dockerLogs(name, stage) {
    const result = invoke(dockerCommand[0], [...dockerCommand.slice(1), 'logs', '--tail', '100', name]);
    output(result, { stage, container: name });
    if (failed(result)) throw failure(result);
    return result.stdout + '\n' + result.stderr;
  }
  const state = name => JSON.parse(docker(['inspect', '--format', '{{json .State}}', name]));
  function captureContainer(name, stage, knownState) {
    // Best effort diagnostics must never overwrite the original readiness error.
    try {
      const current = knownState ?? state(name);
      emit({ stage, container: name, status: current.Status, running: current.Running,
        exitCode: current.ExitCode, oomKilled: current.OOMKilled, runtimeError: bounded(current.Error),
        startedAt: current.StartedAt, finishedAt: current.FinishedAt });
    } catch (error) { emit({ stage, container: name, diagnosticError: bounded(error.message) }); }
    try { dockerLogs(name, stage); }
    catch (error) { emit({ stage, container: name, diagnosticError: bounded(error.message) }); }
  }
  async function waitFor(name, predicate, max = 60000) {
    const deadline = Date.now() + max;
    while (Date.now() < deadline) {
      const current = state(name);
      if (!current.Running) {
        captureContainer(name, 'readiness-exit-before-cleanup', current);
        throw new Error(`${name} exited ${current.ExitCode} during readiness`);
      }
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    captureContainer(name, 'readiness-timeout-before-cleanup');
    throw new Error(name + ' readiness timeout');
  }
  return { command, docker, dockerLogs, redact, captureContainer, waitFor };
}
module.exports = { createDiagnostics };
