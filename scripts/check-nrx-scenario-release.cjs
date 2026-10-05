// No network, database or production credentials. Run from the candidate SHA
// immediately before each approved API / edge rollout, never at service start.
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const TRAJECTORY_FILES = Object.freeze([
  'testMarketSimulation.ts', 'simulationSchedule.ts', 'simulationRandom.ts',
  'simulationWaves.ts', 'simulationRealism.ts', 'simulationCycles.ts',
  'simulationAccumulation.ts', 'simulationNaturalWicks.ts',
]);
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, canonicalize(v)]));
  return value;
}
function fingerprintFor(asset, readSource = file => readFileSync(resolve(__dirname, '../src/services/testMarkets', file), 'utf8')) {
  // The raw cutoff anchor depends on the historical engine too. A change to
  // that closure must not masquerade as an unchanged installed schedule.
  const algorithm = TRAJECTORY_FILES.map(file => [file, readSource(file).replace(/\r\n/g, '\n')]);
  return createHash('sha256').update(JSON.stringify([canonicalize(asset), algorithm])).digest('hex');
}
module.exports = { fingerprintFor, TRAJECTORY_FILES };

if (require.main === module) {
require('ts-node/register/transpile-only');
const { NEURIX } = require('../src/services/testMarkets/neurix');
const { validateScheduledScenario, assertScheduledScenarioRelease } = require('../src/services/testMarkets/simulationSchedule');

const c = NEURIX.scheduledScenario;
if (!c) { console.log('NRX: no scheduled scenario'); process.exit(0); }
try {
  validateScheduledScenario(c, NEURIX.listingAt);
  const fingerprint = fingerprintFor(NEURIX);
  console.log('NRX candidate schedule SHA256=' + fingerprint);
  console.log('Activation UTC=' + new Date(c.from).toISOString());
  // Only an operator-verified fingerprint of the schedule ALREADY installed on
  // BOTH serving API and edge may bypass the new-activation time check. It is
  // not a flag to force an expired new schedule through. See NRX_TWO_WEEK.md.
  if (process.env.NRX_ACTIVE_SCHEDULE_SHA256 === fingerprint) {
    console.log('Unchanged installed schedule: no new activation');
  } else {
    assertScheduledScenarioRelease(c, Date.now());
    console.log('Prospective activation: at least five minutes remain. Both rollouts must finish before activation.');
  }
} catch (error) {
  console.error('NRX RELEASE BLOCKED: ' + error.message);
  process.exitCode = 1;
}
}
