const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const args = [path.join(root, 'node_modules/jest/bin/jest.js'), '--runInBand', '--runTestsByPath',
  'src/auth/__tests__/telegramInitData.test.ts',
  'frontend/src/mobile-review/__tests__/safety.test.ts',
  'frontend/src/lib/__tests__/terminalMobileParity.test.ts',
  'frontend/src/lib/__tests__/futuresOrderPanel.test.ts',
  'frontend/src/lib/__tests__/futuresUiPolish.test.ts',
  'frontend/src/lib/__tests__/spotOrdersPresentation.test.ts',
  'frontend/src/lib/__tests__/chartTrading.test.ts',
  'frontend/src/lib/__tests__/nativeFuturesTerminal.test.ts'];
const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env,
  NODE_OPTIONS: `--require="${path.join(root, 'scripts/mobile-test-network.cjs').replace(/\\/g, '/')}"`,
  DATABASE_URL: 'postgresql://test:unused@127.0.0.1:5432/voltex_mobile_test',
  DIRECT_URL: 'postgresql://test:unused@127.0.0.1:5432/voltex_mobile_test',
  PRIVATE_TRADING_DB_TESTS: '0',
} });
process.exit(result.status ?? 1);
