import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { benchmarkApiProxy, assertPersistentBenchmarkProxy } from './benchmark-proxy.mjs';

test('historical crypto stanza fails persistent transport contract (Nginx 1.24 default HTTP/1.0)', () => {
  const historical = { upstream: '', location: 'proxy_pass http://127.0.0.1:13020; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr;' };
  assert.throws(() => assertPersistentBenchmarkProxy(historical));
});
test('actual test support uses new explicit pool only for the actual-peer benchmark path', () => {
  const source = readFileSync(new URL('./test-support.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ benchmarkApiProxy \} from '\.\/benchmark-proxy\.mjs'/);
  assert.match(source, /apiOrigin && preserveClientIp \? benchmarkApiProxy\(apiOrigin\)/);
  assert.match(source, /\$\{benchmarkProxy\?\.upstream \?\? ''\}/);
  assert.match(source, /benchmarkProxy\?\.location \?\?/);
});
test('explicit HTTP/1.1 pool and peer-derived forwarding; no auth cache or extra header capability', () => {
  const config = benchmarkApiProxy('http://127.0.0.1:13020');
  assert.equal(assertPersistentBenchmarkProxy(config), true);
  assert.match(config.upstream, /server 127\.0\.0\.1:13020;/);
  assert.match(config.upstream, /keepalive_timeout 5s;/);
  assert.doesNotMatch(config.location, /\$http_x_forwarded_for|X-Stocks-Authority-Key|Authorization/);
});
test('refuses external hosts, configuration injection, credentials, paths and implicit ports', () => {
  for (const origin of ['http://example.com:13020', 'http://127.0.0.1', 'https://127.0.0.1:13020', 'http://u:p@127.0.0.1:13020', 'http://127.0.0.1:13020/path', 'http://127.0.0.1:13020/?proxy_cache=on', 'http://127.0.0.1:13020/#fragment', 'http://127.0.0.1:13020;include /secret']) assert.throws(() => benchmarkApiProxy(origin), origin);
});
