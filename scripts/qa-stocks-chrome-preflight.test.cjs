'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { assertScratch, privateEnvironment } = require('./qa-stocks-chrome-preflight.cjs');
test('Chrome preflight cleanup requires exact private owned scratch identity', () => {
  const expected = { path: '/tmp/owned-fixture', uid: 1001, ino: 7, dev: 2, marker: 'fixture-marker' };
  const actual = { resolved: expected.path, uid: 1001, ino: 7, dev: 2, marker: 'fixture-marker', directory: true, symlink: false, mode: 0o700 };
  assertScratch(actual, expected);
  for (const delta of [{ resolved: '/tmp/other' }, { uid: 0 }, { ino: 8 }, { dev: 3 }, { marker: 'changed' }, { directory: false }, { symlink: true }, { mode: 0o755 }]) assert.throws(() => assertScratch({ ...actual, ...delta }, expected));
});
test('Chrome version command receives only the explicit private environment', () => {
  const env = privateEnvironment('/private-fixture');
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR']);
  assert.equal(env.HOME, '/private-fixture'); assert.equal(env.PATH, '/usr/bin:/bin');
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'HTTPS_PROXY', 'DISPLAY', 'DBUS_SESSION_BUS_ADDRESS']) assert.equal(env[key], undefined);
});
test('trusted native source selection stays outside the sanitized browser child environment',()=>{
  const {selectedChrome}=require('./qa-stocks-public-nss.cjs'),{EXECUTABLE}=require('./stocks-browser-native/installation.cjs');
  const previous=process.env.VOLTEX_STOCKS_NATIVE_BROWSER,source=process.env.QA_SOURCE_SHA;
  try{process.env.VOLTEX_STOCKS_NATIVE_BROWSER='1';process.env.QA_SOURCE_SHA='a'.repeat(40);const env=privateEnvironment('/private-fixture');
    assert.equal(env.VOLTEX_STOCKS_NATIVE_BROWSER,undefined);assert.equal(env.QA_SOURCE_SHA,undefined);assert.equal(selectedChrome(),EXECUTABLE);
    for(const key of ['LD_PRELOAD','LD_LIBRARY_PATH','NODE_OPTIONS','NODE_PATH','PYTHONPATH'])assert.equal(env[key],undefined);
  }finally{if(previous===undefined)delete process.env.VOLTEX_STOCKS_NATIVE_BROWSER;else process.env.VOLTEX_STOCKS_NATIVE_BROWSER=previous;if(source===undefined)delete process.env.QA_SOURCE_SHA;else process.env.QA_SOURCE_SHA=source;}
});
