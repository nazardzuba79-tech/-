'use strict';

const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const http = require('node:http');

const COLLECTOR_PORT = Number(process.env.EMBEDDED_COLLECTOR_PORT || 10001);
if (!Number.isInteger(COLLECTOR_PORT) || COLLECTOR_PORT < 1024 || COLLECTOR_PORT > 65535) {
  console.error('Invalid EMBEDDED_COLLECTOR_PORT');
  process.exit(1);
}

const token = randomBytes(32).toString('hex');
let collector = null;
let api = null;
let stopping = false;

function spawnNode(file, env) {
  return spawn(process.execPath, [file], {
    stdio: 'inherit',
    env,
  });
}

function stopChild(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch {}
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  stopChild(api);
  stopChild(collector);
  setTimeout(() => process.exit(code), 1500).unref();
}

function waitForCollector(timeoutMs = 45_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (collector && collector.exitCode !== null) {
        reject(new Error(`Embedded collector exited before becoming healthy (code ${collector.exitCode})`));
        return;
      }
      const req = http.get({
        hostname: '127.0.0.1',
        port: COLLECTOR_PORT,
        path: '/health',
        timeout: 1500,
      }, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      req.on('timeout', () => req.destroy());
      req.on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started >= timeoutMs) {
        reject(new Error('Embedded collector did not become healthy in time'));
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });
}

async function main() {
  const shared = { ...process.env };
  collector = spawnNode('dist/marketDataCollector.js', {
    ...shared,
    PORT: String(COLLECTOR_PORT),
    MARKET_DATA_BIND_HOST: '127.0.0.1',
    MARKET_DATA_COLLECTOR_TOKEN: token,
  });
  collector.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`Embedded collector stopped unexpectedly (code=${code}, signal=${signal})`);
      shutdown(code || 1);
    }
  });

  await waitForCollector();

  api = spawnNode('dist/index.js', {
    ...shared,
    MARKET_DATA_COLLECTOR_URL: `http://127.0.0.1:${COLLECTOR_PORT}`,
    MARKET_DATA_COLLECTOR_TOKEN: token,
  });
  api.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`API stopped (code=${code}, signal=${signal})`);
      shutdown(code || 1);
    }
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => shutdown(0));
}

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
