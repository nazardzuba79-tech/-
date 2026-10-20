'use strict';
const { createProfiler } = require('./cpu-http-profile.cjs');
const { stamp, alignment, validateClocks } = require('./profile-clock.cjs');

// A lifecycle adapter only: never schedules a request or starts a worker/database.
// A future authorized runner must retain source admission and its original plan.
async function withProfiles({ enabled = false, rpc, root }, run) {
  if (!enabled) return { value: await run(), profiles: { enabled: false } };
  if (typeof rpc !== 'function' || typeof run !== 'function') throw Error('PROFILE_CALLBACKS_REQUIRED');
  const generator = createProfiler({ enabled: true, role: 'generator', root });
  let apiStarted = false, generatorStarted = false, value, failure, failed = false;
  const profiles = { enabled: true }, cleanupErrors = [];
  const bracket = async () => {
    const rows = [];
    for (let i = 0; i < 3; i++) {
      const sent = stamp(), remote = await rpc('profile-clock'), received = stamp();
      rows.push(alignment(sent, remote, received));
    }
    return rows;
  };
  try {
    profiles.clockBefore = await bracket();
    const admission = await rpc('profile-start');
    if (admission?.enabled !== true) throw Error('API_PROFILE_NOT_ENABLED');
    apiStarted = true; await generator.start(); generatorStarted = true;
    value = await run();
  } catch (error) { failure = error; failed = true; }
  finally {
    if (generatorStarted) {
      try { profiles.generator = await generator.stop(); } catch { cleanupErrors.push('GENERATOR_PROFILE_STOP_FAILED'); }
    }
    if (apiStarted) {
      try { profiles.api = await rpc('profile-stop'); } catch { cleanupErrors.push('API_PROFILE_STOP_FAILED'); }
    }
    try { profiles.clockAfter = await bracket(); } catch { cleanupErrors.push('PROFILE_CLOCK_FAILED'); }
  }
  profiles.clock = validateClocks(profiles.clockBefore ?? [], profiles.clockAfter ?? []);
  profiles.valid = profiles.clock.valid && profiles.generator?.validity?.valid === true &&
    profiles.api?.validity?.valid === true && cleanupErrors.length === 0;
  if (failed || cleanupErrors.length || !profiles.valid) {
    // Preserve the workload failure instead of turning partial capture into success.
    const error = failure instanceof Error ? failure : Error(failed ? 'PROFILE_OPERATION_FAILED' :
      cleanupErrors.length ? 'PROFILE_CLEANUP_FAILED' : 'PROFILE_EVIDENCE_INVALID');
    error.profiles = profiles; error.profileCleanupErrors = cleanupErrors; throw error;
  }
  return { value, profiles };
}
module.exports = { withProfiles };
