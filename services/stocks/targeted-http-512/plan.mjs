// A narrow attribution diagnostic, never a replacement for Issue #505 acceptance.
export const LIMITS = Object.freeze({ cpu: .05, memory: 268435456, readBps: 1048576, writeBps: 131072, deadlineMs: 3000 });
export const PROFILES = Object.freeze(['projection20', 'projection50', 'wallet', 'history', 'identity']);
export function schedule() {
  return PROFILES.flatMap(profile => [0, 1, 2].flatMap(repeat =>
    (repeat === 1 ? ['target', 'control'] : ['control', 'target']).map(variant => ({ profile, repeat, variant }))));
}
export function validateLimits({ cpuMax, memoryMax, swapMax, ioMax }, device) {
  if (cpuMax?.trim() !== '5000 100000' || Number(memoryMax) !== LIMITS.memory || typeof swapMax !== 'string' || swapMax.trim() !== '0'
      || !/^\d+:\d+$/.test(device || '') || !ioMax?.split('\n').some(row => row.trim().split(/\s+/)[0] === device && /\brbps=1048576\b/.test(row) && /\bwbps=131072\b/.test(row))) throw Error('RESOURCE_PROOF_MISSING');
}
export function descriptor(profile) {
  if (!PROFILES.includes(profile)) throw Error('UNKNOWN_PROFILE');
  return profile.startsWith('projection') ? { users: Number(profile.slice(10)), waves: 5, cadenceMs: 2000, account: 'empty-nonowner', catalogue: 40, ids: ['BYBIT:AAPLXUSDT'] }
    : profile === 'wallet' ? { users: 5, waves: 5, cadenceMs: 2100, account: 'one-owner-five-duplicate-readers', ids: ['BYBIT:AAPLXUSDT', 'BINANCE:AAPLBUSDT'] }
    : profile === 'identity' ? { cohorts: [5, 20, 50], waves: 1, account: 'empty-nonowner', ids: [] }
    : { waves: 5, cases: ['queued-last-cancel', 'shared-live-reader', 'started-cancel'], ids: ['BYBIT:AAPLXUSDT'] };
}
