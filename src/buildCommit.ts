/**
 * Which revision this process was built from, if the platform said so.
 *
 * The frontend and the API deploy independently, so a fresh Cloudflare Pages
 * build is no evidence at all about which commit Render is serving. This is
 * what makes that answerable instead of assumed.
 *
 * `null` means the platform did not tell us. It is deliberately not a guess,
 * not an empty string and not "unknown" — a wrong SHA here would be worse
 * than no SHA, because it would be believed.
 */
export function resolveBuildCommit(env: NodeJS.ProcessEnv): string | null {
  // A Hetzner Compose API image uses a pinned, operator-reviewed release SHA.
  // It must win over legacy image/platform metadata or /health can report the wrong deploy.
  if (typeof env.VOLTEX_RELEASE_SHA === 'string') {
    const sha = env.VOLTEX_RELEASE_SHA.trim();
    return /^[a-f0-9]{40}$/i.test(sha) ? sha : null; // Invalid pinned identity must fail closed.
  }
  for (const key of ['RENDER_GIT_COMMIT', 'GIT_COMMIT', 'SOURCE_VERSION', 'VERCEL_GIT_COMMIT_SHA']) {
    const value = env[key];
    // A platform that exports the variable empty has told us nothing.
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}
