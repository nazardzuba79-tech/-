import {
  EMAIL_VERIFICATION_SECRET_ENV,
  assertEmailVerificationSecretConfigured,
  requireEmailVerificationSecret,
} from '../emailVerificationSecret';

/**
 * The production requirement itself.
 *
 * These pass an explicit environment object rather than mutating
 * `process.env`, so they assert what a real deployment would hit without
 * depending on — or disturbing — the suite-wide test values set in
 * jest.setup.ts.
 */

const REAL_ENV_SHAPE = {
  JWT_SECRET: 'a-session-signing-key',
  EMAIL_VERIFICATION_SECRET: 'a-separate-verification-key',
} as NodeJS.ProcessEnv;

describe('requireEmailVerificationSecret', () => {
  it('returns the configured secret', () => {
    expect(requireEmailVerificationSecret(REAL_ENV_SHAPE)).toBe('a-separate-verification-key');
  });

  it('throws when the variable is absent', () => {
    expect(() => requireEmailVerificationSecret({ JWT_SECRET: 'a-session-signing-key' } as NodeJS.ProcessEnv)).toThrow(
      /EMAIL_VERIFICATION_SECRET/
    );
  });

  it('treats an empty or whitespace value as missing', () => {
    for (const value of ['', '   ', '\t\n']) {
      expect(() =>
        requireEmailVerificationSecret({ JWT_SECRET: 'x', EMAIL_VERIFICATION_SECRET: value } as NodeJS.ProcessEnv)
      ).toThrow(/EMAIL_VERIFICATION_SECRET/);
    }
  });

  describe('JWT_SECRET is not a substitute', () => {
    it('does NOT fall back to JWT_SECRET when the dedicated variable is missing', () => {
      // The old behaviour this replaces: a set JWT_SECRET used to satisfy
      // email verification on its own. It must not any more.
      const jwtOnly = { JWT_SECRET: 'a-session-signing-key' } as NodeJS.ProcessEnv;

      expect(() => requireEmailVerificationSecret(jwtOnly)).toThrow();
      // And whatever it throws, it never hands back the session key.
      let returned: string | undefined;
      try {
        returned = requireEmailVerificationSecret(jwtOnly);
      } catch {
        returned = undefined;
      }
      expect(returned).toBeUndefined();
    });

    it('rejects setting the two variables to the same value', () => {
      const shared = { JWT_SECRET: 'same-value-for-both', EMAIL_VERIFICATION_SECRET: 'same-value-for-both' } as NodeJS.ProcessEnv;
      expect(() => requireEmailVerificationSecret(shared)).toThrow(/must not be the same value as JWT_SECRET/);
    });

    it('accepts a dedicated secret even when JWT_SECRET is absent', () => {
      expect(
        requireEmailVerificationSecret({ EMAIL_VERIFICATION_SECRET: 'only-the-verification-key' } as NodeJS.ProcessEnv)
      ).toBe('only-the-verification-key');
    });
  });

  it('never puts the secret in the error message', () => {
    // A startup error ends up in logs and issue reports; it must be safe to
    // paste. The only case that can even see a value is the reuse check.
    const shared = { JWT_SECRET: 'sup3r-s3cret-value', EMAIL_VERIFICATION_SECRET: 'sup3r-s3cret-value' } as NodeJS.ProcessEnv;
    try {
      requireEmailVerificationSecret(shared);
      throw new Error('expected it to throw');
    } catch (err) {
      expect((err as Error).message).not.toContain('sup3r-s3cret-value');
      expect((err as Error).message).toContain(EMAIL_VERIFICATION_SECRET_ENV);
    }
  });

  it('has no hardcoded default', () => {
    // An empty environment must fail rather than quietly produce a key.
    expect(() => requireEmailVerificationSecret({} as NodeJS.ProcessEnv)).toThrow();
  });

  it('is stable across calls rather than generated per invocation', () => {
    const first = requireEmailVerificationSecret(REAL_ENV_SHAPE);
    const second = requireEmailVerificationSecret(REAL_ENV_SHAPE);
    expect(first).toBe(second);
  });
});

describe('assertEmailVerificationSecretConfigured (the startup gate)', () => {
  it('throws, naming the variable, when it is missing', () => {
    expect(() =>
      assertEmailVerificationSecretConfigured({ JWT_SECRET: 'a-session-signing-key' } as NodeJS.ProcessEnv)
    ).toThrow(/EMAIL_VERIFICATION_SECRET env var is required/);
  });

  it('passes when a dedicated secret is configured', () => {
    expect(() => assertEmailVerificationSecretConfigured(REAL_ENV_SHAPE)).not.toThrow();
  });
});

/**
 * The gate is one call at the top of src/index.ts, so the unit tests above
 * cover the logic. This one proves the wiring: the real entrypoint, started
 * for real, dies before it binds.
 *
 * JWT_SECRET is supplied so the process gets past auth.ts's own module-level
 * check — the point is that a valid JWT_SECRET is no longer enough on its
 * own, which is exactly the fallback this change removed.
 */
describe('the real backend entrypoint', () => {
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const path = require('path') as typeof import('path');
  const repoRoot = path.resolve(__dirname, '../../..');

  function startBackend(env: Record<string, string | undefined>) {
    return spawnSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', path.join(repoRoot, 'src/index.ts')],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          ...process.env,
          // dotenv would otherwise load the developer's own .env and put the
          // variable back, hiding the very thing under test.
          DOTENV_CONFIG_PATH: path.join(repoRoot, 'does-not-exist.env'),
          ...env,
        },
      }
    );
  }

  it('refuses to start with JWT_SECRET set but EMAIL_VERIFICATION_SECRET missing', () => {
    const result = startBackend({
      JWT_SECRET: 'a-session-signing-key-for-this-test',
      EMAIL_VERIFICATION_SECRET: undefined,
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('EMAIL_VERIFICATION_SECRET env var is required');
    // Never got as far as listening.
    expect(output).not.toContain('Exchange API listening');
  }, 70_000);
});
