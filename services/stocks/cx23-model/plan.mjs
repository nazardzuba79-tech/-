export function modelPlan(mode = 'paired') {
  if (!['paired', 'evidence-v2'].includes(mode)) throw Error('INVALID_CX23_MODE');
  const profiles = [{ profile: 'idle', viewers: 0, pattern: 'shared' }, { profile: 'owner-wallet', viewers: 0, pattern: 'shared' },
    ...[5, 10, 20, 50].flatMap(viewers => ['shared', 'distinct'].map(pattern => ({ profile: `${viewers}-${pattern}`, viewers, pattern })))];
  const loadedOnly = mode === 'evidence-v2';
  const labels = Array.from({ length: 3 }, (_, repeat) => profiles.flatMap(spec => (loadedOnly ? ['loaded'] : ['control', 'loaded']).map(role => `${spec.profile}-r${repeat}-${role}-diag-on`))).flat();
  const overheadLabels = loadedOnly ? [] : Array.from({ length: 3 }, (_, repeat) => ['on', 'off'].map(d => `overhead-20-shared-r${repeat}-loaded-diag-${d}`)).flat();
  return { mode, loadedOnly, profiles, labels, overheadLabels, expectedPrimaryCases: labels.length, expectedOverheadCases: overheadLabels.length,
    cryptoComparison: loadedOnly ? 'NOT_RUN_NO_MATCHED_CONTROLS' : 'MATCHED_PAIRED',
    missingResultPolicy: 'Every absent, failed, interrupted or incomplete scheduled result is INCOMPLETE, never PASS.' };
}
export const expectedAccountRoles = (spec, loaded = true) => !loaded || spec.profile === 'idle' ? [] : ['owner', ...Array.from({ length: spec.viewers }, (_, n) => `viewer-${n}`)];
