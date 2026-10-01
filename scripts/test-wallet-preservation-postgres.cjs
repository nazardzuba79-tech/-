// Explicit disposable parent only; never take a caller's database connection.
const assert = require('node:assert/strict');
const path = require('node:path');
assert.equal(process.argv[2], '--local-child');
const url = new URL(process.env.OTC_DIAGNOSTIC_URL || '');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/voltex_nrx_test');
process.env.VOLTEX_PG_TEST_URL = url.toString();
process.env.VOLTEX_NRX_TEST_URL = url.toString();
process.env.DATABASE_URL = url.toString();
process.env.BANKING_DB_TESTS = '1';
const config = require('../jest.config');
const ts = require('typescript');
config.rootDir = path.resolve(__dirname, '..');
config.moduleNameMapper = { '^@prisma/client$': process.env.OTC_DIAGNOSTIC_CLIENT, '^dotenv$': path.join(__dirname,'fixtures/no-dotenv.cjs') };
config.transform['^.+\\.tsx?$'][1].tsconfig = {
  ...ts.readConfigFile('tsconfig.json', ts.sys.readFile).config.compilerOptions,
  ...ts.readConfigFile('tsconfig.jest.json', ts.sys.readFile).config.compilerOptions,
  paths: { '@prisma/client': [process.env.OTC_DIAGNOSTIC_CLIENT] },
};
require('jest').runCLI({ config: JSON.stringify(config), runInBand: true,
  _: ['src/futures/__tests__/futuresBookLock.pg.test.ts', 'src/services/testMarkets/__tests__/nrxSpot.pg.test.ts','src/banking/__tests__/bankingReferral.integration.test.ts'], $0: 'jest' }, [config.rootDir])
  .then(({ results }) => {
    console.log(`POSTGRES PRESERVATION: ${results.numPassedTests} passed, ${results.numFailedTests} failed, ${results.numPendingTests} skipped; ${results.numPassedTestSuites}/${results.numTotalTestSuites} suites passed.`);
    if(!results.success)for(const test of results.testResults)if(test.failureMessage)console.error(test.failureMessage);
    process.exitCode = results.success ? 0 : 1;
  });
