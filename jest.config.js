module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Sets the env vars the real backend requires (notably the mandatory,
  // fallback-free EMAIL_VERIFICATION_SECRET) before any suite loads its
  // modules. See jest.setup.ts.
  setupFiles: ['<rootDir>/jest.setup.ts'],
};
