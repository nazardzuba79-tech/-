'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { withProfiles } = require('./profile-session.cjs');
test('disabled lifecycle calls only the supplied callback once', async () => {
  let count = 0;
  const result = await withProfiles({ rpc: () => { throw Error('must not call IPC'); } }, async () => ++count);
  assert.equal(result.value, 1); assert.equal(count, 1); assert.deepEqual(result.profiles, { enabled: false });
});
test('API/generator lifecycle closes on success without scheduling any requests', async () => {
  const commands = [];
  const result = await withProfiles({ enabled: true, root: __dirname,
    rpc: async command => { commands.push(command); return { enabled: true }; } }, async () => 'callback-value');
  assert.deepEqual(commands, ['profile-start', 'profile-stop']);
  assert.equal(result.value, 'callback-value'); assert.equal(result.profiles.generator.role, 'generator');
});
test('failed operation is still a failure and stops both profilers', async () => {
  const commands = [], failure = Error('EXPECTED_FIXTURE_FAILURE');
  await assert.rejects(withProfiles({ enabled: true, root: __dirname,
    rpc: async command => { commands.push(command); return { enabled: true }; } }, async () => { throw failure; }), error => {
      assert.equal(error, failure); assert.equal(error.profiles.generator.enabled, true); return true;
    });
  assert.deepEqual(commands, ['profile-start', 'profile-stop']);
});
test('disabled API profiler rejects before the operation starts', async () => {
  await assert.rejects(withProfiles({ enabled: true, rpc: async () => ({ enabled: false }) },
    async () => { assert.fail('must not start'); }), /API_PROFILE_NOT_ENABLED/);
});
test('a rejected undefined value cannot be mistaken for operation success', async () => {
  await assert.rejects(withProfiles({ enabled: true, root: __dirname, rpc: async () => ({ enabled: true }) },
    () => Promise.reject()), /PROFILE_OPERATION_FAILED/);
});
