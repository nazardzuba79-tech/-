// Test-only Nginx rendering. No production ingress or application configuration.
import assert from 'node:assert/strict';

export function benchmarkApiProxy(origin) {
  const url = new URL(origin);
  assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1' && /^\d+$/.test(url.port), 'benchmark API must be an explicit loopback HTTP port');
  assert.ok(Number(url.port) > 0 && Number(url.port) <= 65535 && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'invalid benchmark upstream');
  return {
    upstream: `upstream stocks_review_crypto_api { server 127.0.0.1:${url.port}; keepalive 8; keepalive_timeout 5s; keepalive_requests 1000; }`,
    location: 'proxy_pass http://stocks_review_crypto_api; proxy_http_version 1.1; proxy_set_header Connection ""; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-Host $host; proxy_set_header Forwarded "";',
  };
}

export function assertPersistentBenchmarkProxy({ upstream, location }) {
  assert.match(upstream, /upstream stocks_review_crypto_api \{/);
  assert.match(upstream, /keepalive 8;/);
  assert.match(location, /proxy_pass http:\/\/stocks_review_crypto_api;/);
  assert.match(location, /proxy_http_version 1\.1;/);
  assert.match(location, /proxy_set_header Connection "";/);
  assert.match(location, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.doesNotMatch(upstream + location, /proxy_cache|proxy_hide_header|proxy_set_header Authorization/i);
  return true;
}
