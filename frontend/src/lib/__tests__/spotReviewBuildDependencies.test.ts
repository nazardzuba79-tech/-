import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

test('frontend-only review history imports never pull in backend-only packages', () => {
  const root = path.resolve(__dirname, '../../../..');
  const visited = new Set<string>();
  const external = new Set<string>();
  function inspect(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith('.')) inspect(path.resolve(path.dirname(file), specifier + '.ts'));
      else external.add(specifier);
    }
  }
  inspect(path.join(root, 'src/services/marketData/SpotPeriodReferenceService.ts'));
  inspect(path.join(root, 'src/services/KrakenMarketDataService.ts'));
  expect([...external]).toEqual([]);
  expect([...visited].some(file => file.endsWith('SpotPeriodReferenceRouter.ts'))).toBe(false);
  const config = fs.readFileSync(path.join(root, 'frontend/vite.review.config.ts'), 'utf8');
  expect(config).toContain("from '../src/services/marketData/SpotPeriodReferenceService'");
  expect(config).not.toContain('SpotPeriodReferenceRouter');
});
