'use strict';
// One bounded image-only smoke on a standard public GitHub-hosted Linux runner.
// No database, provider, registry push, production address or account is used.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { SOURCE, hash } = require('./stocks-build-only-prepare.cjs');

function run(args, { timeout = 60000, expected = 0, inherit = false } = {}) {
  const result = cp.spawnSync('docker', ['--context', 'default', ...args],
    { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, ...(inherit ? { stdio: 'inherit' } : {}) });
  if (result.error || result.status !== expected) {
    throw Error(`DOCKER_COMMAND_FAILED ${args[0]}: exit=${result.status}\n${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result;
}
function inspect(id) { return JSON.parse(run(['image', 'inspect', id]).stdout)[0]; }
function smoke(id, suffix, env, args, expected) {
  const name = `stocks-build-only-${process.pid}-${suffix}`;
  try {
    return run(['run', '--rm', '--name', name, '--network', 'none', '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '64', '--memory', '256m', '--cpus', '1',
      ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`]), id, ...args],
    { timeout: 20000, expected });
  } finally {
    // Exact owned name only; no host-wide prune or container enumeration.
    cp.spawnSync('docker', ['--context', 'default', 'rm', '-f', name],
      { timeout: 10000, stdio: 'ignore' });
  }
}
function main(output) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      process.env.RUNNER_OS !== 'Linux' || process.env.GITHUB_REPOSITORY !== 'nazardzuba79-tech/-') throw Error('ISOLATED_GITHUB_LINUX_RUNNER_REQUIRED');
  if (process.version !== 'v22.23.3') throw Error('NODE_22_23_3_REQUIRED');
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'BUILDX_BUILDER', 'BUILDKIT_HOST',
    'DATABASE_URL', 'JWT_SECRET', 'STOCKS_TEST_CASH_GATEWAY_KEY']) {
    if (process.env[key]) throw Error('FORBIDDEN_RUNNER_ENV_' + key);
  }
  const contextInfo = JSON.parse(run(['context', 'inspect', 'default']).stdout)[0];
  if (contextInfo.Endpoints.docker.Host !== 'unix:///var/run/docker.sock') throw Error('LOCAL_DOCKER_REQUIRED');
  const byteReceipt = JSON.parse(fs.readFileSync(path.join(output, 'sql-byte-receipt.json')));
  if (byteReceipt.source !== SOURCE || byteReceipt.rows.length !== 44 ||
      byteReceipt.rows.some(r => !['RAW_MATCH', 'EXACT_BYTES_DERIVED_AND_HASH_VERIFIED'].includes(r.status)) ||
      byteReceipt.packageResult.status !== 'PASS_FILE_REVIEW_ONLY') throw Error('BYTE_GATE_REQUIRED');
  const context = path.join(output, 'context');
  // Independent build-time verification by the original checker also remains in RUN.
  const recipe = fs.readFileSync(path.join(context, 'services/stocks-global/Dockerfile.release'), 'utf8');
  if ((recipe.match(/^FROM node:22\.23\.3-bookworm-slim AS /gm) ?? []).length !== 2) throw Error('RECIPE_DRIFT');
  run(['pull', 'node:22.23.3-bookworm-slim'], { timeout: 180000, inherit: true });
  const base = inspect('node:22.23.3-bookworm-slim');
  const digests = base.RepoDigests.filter(x => /^node@sha256:[a-f0-9]{64}$/.test(x));
  if (digests.length !== 1) throw Error('NODE_BASE_DIGEST_AMBIGUOUS');
  const pinned = recipe.replaceAll('node:22.23.3-bookworm-slim', digests[0]);
  const recipePath = path.join(output, 'Dockerfile.pinned-build-only');
  fs.writeFileSync(recipePath, pinned, { flag: 'wx' });
  const receipt = {
    source: SOURCE, controlHead: process.env.CONTROL_SHA,
    originalRecipeSha256: hash(Buffer.from(recipe)), pinnedRecipeSha256: hash(Buffer.from(pinned)),
    baseDigest: digests[0], runner: 'ubuntu-24.04 standard GitHub-hosted',
    historical44: 'PASS_HASH_AND_LENGTH', pending2: 'PASS_HASH',
    images: [], failClosed: [], positivePgStartup: 'NOT_RUN_NO_DISPOSABLE_PG_AUTHORITY_IN_THIS_IMAGE_SMOKE',
    ingress: 'NOT_RUN_NO_TLS_FIXTURE', production: 'UNCHANGED',
    migrationsApplied: false, imagePublished: false, capacity: 'NOT_RUN',
  };
  for (const target of ['api', 'gateway']) {
    const iid = path.join(output, `${target}.iid`);
    run(['build', '--builder', 'default', '--target', target, '--file', recipePath,
      '--iidfile', iid, '--label', `org.opencontainers.image.revision=${SOURCE}`, context],
    { timeout: 720000, inherit: true });
    const id = fs.readFileSync(iid, 'utf8').trim(), image = inspect(id);
    const expected = target === 'api' ? 'dist/index.js' : 'services/stocks-global/release-entrypoint.mjs';
    if (JSON.stringify(image.Config.Cmd) !== JSON.stringify(['node', expected]) ||
        image.Config.User !== 'node' || JSON.stringify(image.Config.Entrypoint) !== '["docker-entrypoint.sh"]' ||
        Object.keys(image.Config.ExposedPorts ?? {}).length !== 0) throw Error('IMAGE_RUNTIME_CONFIG_MISMATCH');
    const version = smoke(id, `${target}-version`, {}, ['node', '--version'], 0).stdout.trim();
    if (version !== 'v22.23.3') throw Error('IMAGE_NODE_VERSION_MISMATCH');
    const entrypoint = smoke(id, `${target}-entrypoint`, {}, ['node', '-e',
      "const fs=require('fs'),crypto=require('crypto');const b=fs.readFileSync('/usr/local/bin/docker-entrypoint.sh');if(/prisma|migrate|seed|reset/i.test(b.toString()))process.exit(8);console.log(crypto.createHash('sha256').update(b).digest('hex'));"], 0).stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(entrypoint)) throw Error('ENTRYPOINT_DIGEST_INVALID');
    receipt.images.push({ target, imageId: id, node: version, cmd: image.Config.Cmd,
      entrypoint: image.Config.Entrypoint, entrypointSha256: entrypoint, exposedPorts: [] });
    if (target === 'gateway') {
      const cases = [
        ['no-authority', {}, 'STOCKS_RELEASE_AUTHORITY_REQUIRED'],
        ['sqlite-forbidden', { STOCKS_ACCOUNTS_DATA: '/tmp/unsupported.sqlite' }, 'STOCKS_RELEASE_LEGACY_FORBIDDEN'],
        ['json-forbidden', { STOCKS_GLOBAL_DATA: '/tmp/unsupported.json' }, 'STOCKS_RELEASE_LEGACY_FORBIDDEN'],
        ['pg-unready', {
          STOCKS_TEST_CASH_AUTHORITY_URL: 'http://127.0.0.1:9/api/v1/stocks-test-cash',
          STOCKS_IDENTITY_ISSUER: 'stocks-build-internal',
          STOCKS_TEST_CASH_GATEWAY_KEY: 'public-build-fixture-not-a-production-key',
          STOCKS_TRADE_PRINCIPALS: JSON.stringify([
            { issuer: 'stocks-build-internal', subject: 'fixture-a' },
            { issuer: 'stocks-build-internal', subject: 'fixture-b' },
          ]),
        }, 'STOCKS_RELEASE_AUTHORITY_UNREADY'],
      ];
      for (const [name, env, code] of cases) {
        const result = smoke(id, name, env, [], 1); // actual inherited ENTRYPOINT + release CMD
        if (!result.stderr.split(/\r?\n/).includes(code) ||
            (result.stdout + result.stderr).includes('STOCKS_RELEASE_LISTENING')) throw Error('FAIL_CLOSED_SMOKE_FAILED_' + name);
        receipt.failClosed.push({ name, status: 'PASS', code, exit: 1, network: 'none' });
      }
    }
  }
  return receipt;
}
if (require.main === module) {
  let receipt;
  try {
    if (process.argv.length !== 3) throw Error('USAGE: prepared-output-directory');
    receipt = main(path.resolve(process.argv[2]));
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    console.error(error.message);
    receipt = { source: SOURCE, imageBuildOrSmoke: 'FAIL', positivePgStartup: 'NOT_RUN',
      ingress: 'NOT_RUN', production: 'UNCHANGED', imagePublished: false };
    process.exitCode = 1;
  } finally {
    if (process.env.GITHUB_STEP_SUMMARY && receipt) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Stocks image-only receipt\n```json\n' + JSON.stringify(receipt, null, 2) + '\n```\n');
    }
  }
}
