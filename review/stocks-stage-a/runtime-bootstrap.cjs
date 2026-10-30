'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const mode = process.env.VOLTEX_RUNTIME_MODE;
if (!['verify', 'production'].includes(mode)) throw new Error('Explicit runtime mode required');
if (mode === 'production' && !fs.existsSync('/run/voltex-cutover-authorized')) throw new Error('Production cutover remains locked');
const config = JSON.parse(fs.readFileSync('/run/secrets/production_config', 'utf8'));
const password = fs.readFileSync('/run/secrets/database_password', 'utf8').trim();
const database = mode === 'verify' ? 'voltex_verify' : 'voltex_stage';
const dbUrl = `postgresql://neondb_owner:${encodeURIComponent(password)}@db:5432/${database}?schema=public`;
const env = { ...process.env, ...config, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl, PORT: '3000',
  NODE_ENV: 'production', RENDER_GIT_COMMIT: process.env.VOLTEX_RELEASE_SHA || '1aa8e21ad49bf1f108691a1dc9c78442068d85e8',
  NODE_OPTIONS: '--dns-result-order=ipv4first --max-old-space-size=1024' };
if (mode === 'verify') {
  env.REGISTRATION_OPEN = 'false';
  env.DEPOSIT_WATCHER_SCHEDULE = 'off';
  env.NODE_OPTIONS += ' --require /opt/operations/readonly-egress.cjs';
  for (const key of Object.keys(env)) if (/^(SMTP_|TELEGRAM_|SENDGRID_|RESEND_)/.test(key)) delete env[key];
}
const child = spawn(process.execPath, ['scripts/start-render-single-service.cjs'], { env, stdio: 'inherit' });
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
child.on('error', () => process.exit(1));
