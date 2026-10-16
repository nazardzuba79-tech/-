/**
 * The KYC and notification Workers are deployed by hand, after the Hetzner
 * API (owner decision 2026-10-16, docs/KYC_RELEASE_RUNBOOK.md).
 *
 * A merge to main does not update the production API, so a Worker deployed on
 * the merge could call routes the live API does not have. These checks pin
 * that .github/workflows/deploy-kyc-edge.yml only verifies on a push, deploys
 * only on a manual run after a read-only readiness check, and they run the
 * readiness scripts themselves against a local stand-in API (no network
 * beyond 127.0.0.1, no Cloudflare, no production).
 */
import { spawn, execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import http from 'http';
import { AddressInfo } from 'net';
import { resolve } from 'path';

const root = resolve(__dirname, '../../../..');
// Windows checkouts (admin-user-deletion.yml runs this file there) use CRLF.
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const workflow = read('.github/workflows/deploy-kyc-edge.yml');
const lines = workflow.split('\n');

/** Text of one job under `jobs:` (two-space indented key). */
function job(name: string): string {
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) throw new Error(`job ${name} not found`);
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end]) && !/^\S/.test(lines[end])) end++;
  return lines.slice(start, end).join('\n');
}

/** The `run: |` script of the step with this exact name. */
function stepScript(name: string): string {
  const start = lines.indexOf(`      - name: ${name}`);
  if (start < 0) throw new Error(`step ${name} not found`);
  const run = lines.findIndex((line, i) => i > start && line === '        run: |');
  if (run < 0) throw new Error(`step ${name} has no run block`);
  const body: string[] = [];
  for (let i = run + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && !lines[i].startsWith('          ')) break;
    body.push(lines[i].slice(10));
  }
  return body.join('\n');
}

// The workflow runs on ubuntu-latest, so its bash steps are executed where bash
// is the shell they were written for: kyc-edge.yml (ubuntu) runs them in full.
// On a Windows runner only the structure checks above apply.
const bashSteps = process.platform === 'win32' ? describe.skip : describe;

const READY = 'Live API is that commit and already serves the KYC materials routes (read-only)';
const COMMIT = 'The named API commit is in this repository and carries the KYC materials API and migration';
const DEPLOYS = /wrangler(@4)? deploy(?! --dry-run)|secret put|deploy-notification-public-key/;

describe('deploy-kyc-edge.yml: a push verifies, only a manual run deploys', () => {
  it('a push to main runs the verify job only, which deploys nothing and holds no token', () => {
    expect(workflow).toMatch(/\non:\n {2}push:\n {4}branches: \[main\]/);
    expect(workflow).toMatch(/\n {2}workflow_dispatch:\n {4}inputs:/);
    const verify = job('verify');
    expect(verify).not.toMatch(/\n {4}if:/);
    expect(verify).not.toMatch(DEPLOYS);
    expect(verify).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(verify).toContain('npx --yes wrangler@4 deploy --dry-run');
    expect(verify).toContain('npx wrangler deploy --dry-run');
  });

  it('readiness and deploy run only on a manual run, deploy only after readiness, behind an environment', () => {
    const readiness = job('api-readiness'), deploy = job('deploy');
    for (const text of [readiness, deploy]) expect(text).toContain("    if: github.event_name == 'workflow_dispatch'");
    expect(readiness).toContain('    needs: verify');
    expect(deploy).toContain('    needs: [verify, api-readiness]');
    expect(deploy).toContain('    environment: kyc-workers-production');
    expect(readiness).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(workflow.match(/secrets\.CLOUDFLARE_API_TOKEN/g)).toHaveLength(1);
    expect(deploy).toContain('secrets.CLOUDFLARE_API_TOKEN');
  });

  it('the notification Worker goes first; the KYC edge steps run only in notification-and-kyc mode', () => {
    const deploy = job('deploy');
    const notification = deploy.indexOf('- name: Deploy notification Worker before KYC service binding');
    const kyc = deploy.indexOf('- name: Deploy KYC edge Worker');
    expect(notification).toBeGreaterThan(0);
    expect(kyc).toBeGreaterThan(notification);
    for (const step of ['Deploy KYC edge Worker', 'Signing key — created once inside this runner, stored only as a Worker secret', 'KYC edge production smoke (no document, no email)']) {
      const at = deploy.indexOf(`- name: ${step}`);
      expect(at).toBeGreaterThan(0);
      expect(deploy.slice(at).split('\n')[1]).toBe("        if: inputs.workers == 'notification-and-kyc'");
    }
    expect(deploy).toContain('materials_without_session');
  });

  it('readiness refuses anything but main and probes the live API read-only', () => {
    const readiness = job('api-readiness');
    expect(readiness).toContain('if [ "$GITHUB_REF" != "refs/heads/main" ]; then');
    expect(readiness).toContain('-X POST "$API/api/v1/$path"');
    expect(readiness).toContain('for path in internal/kyc/authorize internal/kyc/materials/authorize internal/kyc/materials/confirmed; do');
    expect(readiness).toContain("grep -Eq '^VOLTEX_API_ORIGIN = \"https://api\\.voltextech\\.net\"$' workers/kyc-edge/wrangler.toml");
    expect(read('workers/kyc-edge/wrangler.toml')).toMatch(/^VOLTEX_API_ORIGIN = "https:\/\/api\.voltextech\.net"$/m);
  });

  it('dispatch inputs reach shell scripts only through env (no expression inside a run block)', () => {
    const uses = lines.filter(line => line.includes('${{ inputs.') || line.includes('github.event.inputs'));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/^ +[A-Z_]+: \$\{\{ inputs\.[a-z_]+ \}\}$/);
    expect(lines.filter(line => /^ +if: inputs\.workers == 'notification-and-kyc'$/.test(line))).toHaveLength(3);
  });
});

type Answer = { health?: object; codes?: Record<string, number> };
type Result = { code: number | null; out: string };

async function withApi<T>(answer: Answer, fn: (api: string) => Promise<T>): Promise<T> {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(answer.health ?? {}));
    }
    const path = (req.url ?? '').replace(/^\/api\/v1\//, '');
    res.writeHead(answer.codes?.[path] ?? 404);
    res.end();
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise(done => server.close(done));
    for (const request of seen) expect(request).toMatch(/^(GET \/health|POST \/api\/v1\/internal\/kyc\/)/);
  }
}

function runScript(script: string, env: Record<string, string>): Promise<Result> {
  return new Promise((done, fail) => {
    const child = spawn('bash', ['-c', script], { cwd: root, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('error', fail);
    child.on('close', code => done({ code, out }));
  });
}

const LIVE = 'a'.repeat(40);
const ALL_415 = { 'internal/kyc/authorize': 415, 'internal/kyc/materials/authorize': 415, 'internal/kyc/materials/confirmed': 415 };
const ready = (api: string, env: Record<string, string>) => runScript(stepScript(READY), { API: api, ...env });

bashSteps('readiness script against a local stand-in API', () => {
  it('blocks the KYC deploy while the live API predates the materials routes (today: 415 / 404)', async () => {
    const result = await withApi({ health: { status: 'ok', commit: LIVE }, codes: { 'internal/kyc/authorize': 415 } }, api =>
      ready(api, { WORKERS: 'notification-and-kyc', API_COMMIT: LIVE, MIGRATION_APPLIED: 'true' }));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('internal/kyc/materials/authorize=404');
    expect(result.out).toContain('update the Hetzner API first');
    expect(result.out).not.toContain('api_ready=yes');
  });

  it('blocks when the live API is not the commit the operator named', async () => {
    const result = await withApi({ health: { status: 'ok', commit: 'b'.repeat(40) }, codes: ALL_415 }, api =>
      ready(api, { WORKERS: 'notification-and-kyc', API_COMMIT: LIVE, MIGRATION_APPLIED: 'true' }));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain(`not ${LIVE}`);
  });

  it('blocks the KYC deploy until the migration is confirmed', async () => {
    const result = await withApi({ health: { status: 'ok', commit: LIVE }, codes: ALL_415 }, api =>
      ready(api, { WORKERS: 'notification-and-kyc', API_COMMIT: LIVE, MIGRATION_APPLIED: 'false' }));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('Confirm migration_applied');
  });

  it('passes when the named commit is live and every route answers 415', async () => {
    const result = await withApi({ health: { status: 'ok', commit: LIVE }, codes: ALL_415 }, api =>
      ready(api, { WORKERS: 'notification-and-kyc', API_COMMIT: LIVE, MIGRATION_APPLIED: 'true' }));
    expect(result.out).toContain('api_ready=yes');
    expect(result.code).toBe(0);
  });

  it('notification-only does not need the KYC routes or the migration', async () => {
    const result = await withApi({ health: { status: 'ok', commit: LIVE } }, api =>
      ready(api, { WORKERS: 'notification-only', API_COMMIT: LIVE, MIGRATION_APPLIED: 'false' }));
    expect(result.out).toContain('api_ready=yes');
    expect(result.code).toBe(0);
  });
});

bashSteps('commit script against this repository', () => {
  const head = process.platform === 'win32' ? '' : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  // The job-level env of api-readiness, as GitHub sets it.
  const check = (commit: string, workers = 'notification-and-kyc') =>
    runScript(stepScript(COMMIT), { API: 'https://api.voltextech.net', API_COMMIT: commit, WORKERS: workers });

  it('accepts a commit that carries the materials routes and migration', async () => {
    const result = await check(head);
    expect(result.out).toContain(`api_commit=${head}`);
    expect(result.code).toBe(0);
  });

  it('refuses a short or unknown commit', async () => {
    const short = await check(head.slice(0, 12));
    expect(short.code).not.toBe(0);
    expect(short.out).toContain('full 40-character commit');
    const unknown = await check('0'.repeat(40));
    expect(unknown.code).not.toBe(0);
    expect(unknown.out).toContain('is not a commit of this repository');
  });
});
