import { resolveBuildCommit } from '../buildCommit';

/**
 * A deploy you cannot identify is a deploy you cannot debug.
 *
 * This exists because "the site is updated" was being read as "the API is
 * updated", and the two deploy separately.
 */
describe('/health reports which revision is answering', () => {
  it('prefers the platform that actually built this process', () => {
    expect(resolveBuildCommit({ RENDER_GIT_COMMIT: 'abc123', GIT_COMMIT: 'def456' })).toBe('abc123');
    expect(resolveBuildCommit({ GIT_COMMIT: 'def456' })).toBe('def456');
    expect(resolveBuildCommit({ SOURCE_VERSION: 'aaa' })).toBe('aaa');
    expect(resolveBuildCommit({ VERCEL_GIT_COMMIT_SHA: 'bbb' })).toBe('bbb');
  });

  it('says null rather than guessing, including for an empty variable', () => {
    // A believed-but-wrong SHA is worse than an admitted unknown.
    expect(resolveBuildCommit({})).toBeNull();
    expect(resolveBuildCommit({ RENDER_GIT_COMMIT: '' })).toBeNull();
    expect(resolveBuildCommit({ RENDER_GIT_COMMIT: '   ' })).toBeNull();
    expect(resolveBuildCommit({ RENDER_GIT_COMMIT: undefined })).toBeNull();
  });

  it('trims what the platform exported', () => {
    expect(resolveBuildCommit({ RENDER_GIT_COMMIT: ' abc123\n' })).toBe('abc123');
  });
});
