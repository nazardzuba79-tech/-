'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { withProfiles } = require('./profile-session.cjs');
const { stamp } = require('./profile-clock.cjs');
test('disabled lifecycle calls only the supplied callback once', async () => {
  let count = 0;
  const result = await withProfiles({ rpc: () => { throw Error('must not call IPC'); } }, async () => ++count);
  assert.equal(result.value, 1); assert.equal(count, 1); assert.deepEqual(result.profiles, { enabled: false });
});
test('API/generator lifecycle closes on success without scheduling any requests', async () => {
  const commands = [];
  const result = await withProfiles({ enabled: true, root: __dirname,
    rpc: async command => { commands.push(command); return command === 'profile-clock' ? stamp() : { enabled: true, validity: {valid:true} }; } }, async () => 'callback-value');
  assert.deepEqual(commands, ['profile-clock', 'profile-clock', 'profile-clock', 'profile-start', 'profile-stop', 'profile-clock', 'profile-clock', 'profile-clock']);
  assert.equal(result.value, 'callback-value'); assert.equal(result.profiles.generator.role, 'generator');
  assert.equal(result.profiles.valid, true);
});
test('failed operation is still a failure and stops both profilers', async () => {
  const commands = [], failure = Error('EXPECTED_FIXTURE_FAILURE');
  await assert.rejects(withProfiles({ enabled: true, root: __dirname,
    rpc: async command => { commands.push(command); return { enabled: true }; } }, async () => { throw failure; }), error => {
      assert.equal(error, failure); assert.equal(error.profiles.generator.enabled, true); return true;
    });
  assert.deepEqual(commands, ['profile-clock', 'profile-clock', 'profile-clock', 'profile-start', 'profile-stop', 'profile-clock', 'profile-clock', 'profile-clock']);
});
test('disabled API profiler rejects before the operation starts', async () => {
  await assert.rejects(withProfiles({ enabled: true, rpc: async () => ({ enabled: false }) },
    async () => { assert.fail('must not start'); }), /API_PROFILE_NOT_ENABLED/);
});
test('a rejected undefined value cannot be mistaken for operation success', async () => {
  await assert.rejects(withProfiles({ enabled: true, root: __dirname, rpc: async () => ({ enabled: true }) },
    () => Promise.reject()), /PROFILE_OPERATION_FAILED/);
});
test('missing API clock/validity evidence rejects capture after cleanup without retrying workload', async () => {
  let count = 0; const commands = [];
  await assert.rejects(withProfiles({enabled:true,root:__dirname,
    rpc:async command=>{commands.push(command);return{enabled:true};}},
  async()=>{count++;}), error=>{
    assert.equal(error.message,'PROFILE_EVIDENCE_INVALID');
    assert.equal(error.profiles.valid,false);assert.equal(error.profiles.clock.valid,false);return true;
  });
  assert.equal(count,1);assert.equal(commands.filter(x=>x==='profile-stop').length,1);
});
