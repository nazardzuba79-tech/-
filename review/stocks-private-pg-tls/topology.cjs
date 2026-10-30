'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const PROVIDERS = ['api.bybit.com','api.binance.com','iss.moex.com','www.cbr.ru','api.kraken.com'];
function compose({ work, apiImage, gatewayImage, pgImage, project }) {
  assert.match(project, /^stocks-private-[0-9]+$/);
  for (const image of [apiImage, gatewayImage, pgImage]) assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const bind = (source, target, readOnly = true) => ({ type: 'bind', source: path.join(work, source), target, read_only: readOnly });
  const base = { image: apiImage, user: '1000:1000', read_only: true, cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'], pids_limit: 128, mem_limit: '768m',
    tmpfs: ['/tmp:rw,nosuid,nodev,size=64m'], restart: 'no' };
  const fixtures = [bind('fixture','/smoke'), bind('ca/cert.pem','/smoke-private/cert.pem')];
  const node = (env, command, namespace = true) => ({ ...base,
    ...(namespace ? { network_mode: 'service:api-production', depends_on: ['api-production'] } : { networks: ['isolated'] }),
    env_file: [path.join(work, env + '.env')], volumes: [...fixtures], ...(command ? { command } : {}) });
  const services = {};
  services.postgres = { image: pgImage, networks: ['isolated'], restart: 'no', mem_limit: '768m',
    env_file: [path.join(work, 'postgres.env')],
    tmpfs: ['/var/lib/postgresql:rw,nosuid,nodev,size=512m','/tmp:rw,nosuid,nodev,size=32m'],
    volumes: [bind('tls','/smoke-private')], command: ['sh','-ec',
      'cp /smoke-private/key.pem /tmp/pg.key; cp /smoke-private/cert.pem /tmp/pg.crt; chown postgres:postgres /tmp/pg.key /tmp/pg.crt; chmod 600 /tmp/pg.key; exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/pg.crt -c ssl_key_file=/tmp/pg.key'] };
  services['api-production'] = { ...node('api', undefined, false),
    extra_hosts: PROVIDERS.map(host => host + '=127.0.0.1'),
    sysctls: { 'net.ipv4.ip_unprivileged_port_start': '0' } };
  services.setup = { ...node('checks', ['node','/smoke/fixture.cjs','setup'], false), profiles: ['checks'] };
  services.setup.volumes.push(bind('checks/config.json','/smoke-private/config.json'));
  services.provider = node('provider', ['node','/smoke/fixture.cjs','provider']);
  services.provider.volumes.push(bind('tls/key.pem','/smoke-private/key.pem'));
  services['finance-off'] = node('disabled');
  services.gateway = { ...node('gateway'), image: gatewayImage };
  services['unix-ingress'] = { ...node('proxy', ['node','/smoke/unix-proxy.cjs']), user: '10001:10002',
    volumes: [bind('fixture/unix-proxy.cjs','/smoke/unix-proxy.cjs'), bind('socket','/run/stocks-ingress',false)] };
  services.frontend = { ...node('frontend', ['node','/smoke/fixture.cjs','frontend'], false), user: '10002:10002',
    networks: { isolated: { aliases: ['stocks.fixture.invalid'] } } };
  services.frontend.volumes.push(bind('tls/key.pem','/smoke-private/key.pem'), bind('socket','/run/stocks-ingress'));
  services.checks = { ...node('checks', ['node','/smoke/fixture.cjs','check']), profiles: ['checks'] };
  services.checks.volumes.push(bind('checks/config.json','/smoke-private/config.json'));
  services.outsider = { ...node('proxy', ['node','/smoke/boundary.cjs'], false), user: '10003:10003', profiles: ['checks'] };
  services.outsider.volumes.push(bind('socket','/run/stocks-ingress'));
  return { name: project, services, networks: { isolated: { internal: true } } };
}
module.exports = { compose, PROVIDERS };
