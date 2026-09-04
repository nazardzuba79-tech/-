module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // tsconfig.jest.json, not tsconfig.json: the suite also covers a few pure
  // frontend modules under frontend/src/lib, which need the DOM lib. The
  // build config is untouched — see tsconfig.jest.json.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  // Sets the env vars the real backend requires (notably the mandatory,
  // fallback-free EMAIL_VERIFICATION_SECRET) before any suite loads its
  // modules. See jest.setup.ts.
  setupFiles: ['<rootDir>/jest.setup.ts'],
};
