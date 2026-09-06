import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

test('canonical service can persist only its isolated model, not wallets, User records or legacy state', () => {
  const service = read('src/services/copyTrading/CopyPerformanceService.ts');
  expect(service).toContain("Pick<PrismaClient, 'copyPerformanceScenario'>");
  expect(service).not.toMatch(/this\.db\.(user|balance|order|trade|withdrawal|deposit|syntheticCopyTradingState)/);
  expect(service).not.toMatch(/from ['"].*(MatchingEngine|OrderService|Wallet|Auth|Deposits)/);
  expect(service).not.toMatch(/https?:\/\//);
  expect(service).not.toMatch(/process\.env\.(DATABASE_URL|REVIEW_BACKEND)/);
  const router = read('src/api/routes/copyPerformance.ts');
  expect(router).toContain('requireAuth(prisma)');
  expect(router).not.toMatch(/router\.(post|put|patch|delete)\(/);
});

test('the migration is additive identity/performance only, without card/review/account or financial mutation', () => {
  const migration = read('prisma/migrations/20260906190000_copy_performance_promotion/migration.sql');
  expect([...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1]))
    .toEqual(['CopyStrategyOwner', 'CopyPerformanceScenario']);
  expect(migration).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE "|ALTER TABLE "User")\b/i);
  expect(migration).not.toMatch(/CardApplication|CopyReviewScenario|REFERENCES "(Balance|Order|Trade|Deposit|Withdrawal)"/);
  expect(migration).toContain('"stateText" TEXT NOT NULL');
  expect(migration).toContain("WHERE \"id\" = 'a2184cdc-c0fc-4892-9141-e493967245fd'");
  expect(migration).not.toMatch(/WHERE "email"/);
});

test('normal backend adds the new read model without replacing existing auth/admin or legacy synthetic routes', () => {
  const entry = read('src/index.ts');
  expect(entry).toContain("app.use('/api/v1', syntheticCopyTradingRouter(prisma));");
  expect(entry).toContain("app.use('/api/v1', copyPerformanceRouter(prisma));");
  expect(entry).toContain("app.use('/api/v1', authRouter(prisma));");
  const legacy = read('src/api/routes/syntheticCopyTrading.ts');
  expect(legacy).toContain("router.get('/copy-trading/synthetic', requireAuth(prisma)");
  expect(legacy).toContain("'/admin/copy-trading/synthetic/reset', requireAuth(prisma), requireAdmin(prisma)");
  expect(legacy).not.toContain('CopyPerformanceService');
});
