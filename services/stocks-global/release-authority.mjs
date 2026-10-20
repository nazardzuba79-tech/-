import { releaseConfig, verifyReleaseAuthority } from './release-config.mjs';

// A startup provenance fence, never a cached user authorization decision.
// Every request and financial COMMIT still uses the PostgreSQL session fences.
const verified = new WeakSet();
export const isReleaseAuthority = authority => verified.has(authority);

export async function openReleaseAuthority(env = process.env) {
  const config = releaseConfig(env);
  await verifyReleaseAuthority(config);
  const { createAuthorityAdapter } = await import('./authority-adapter.mjs');
  const authority = createAuthorityAdapter(config);
  verified.add(authority);
  return { config, authority };
}
