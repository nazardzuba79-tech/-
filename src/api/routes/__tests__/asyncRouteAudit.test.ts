import fs from 'fs';
import path from 'path';
import ts from 'typescript';

// Raw Express 4 callbacks must catch dependency rejections. These existing
// aggregates deliberately settle every dependency themselves (including DB
// fallback inside depositChains); their route tests cover the fallback shape.
const settledAggregates = new Set([
  'copyPerformance.ts:/copy-trading/marketplace',
  'market.ts:/market/global',
  'deposits.ts:/deposit-chains',
  'deposits.ts:/deposit-config-version',
]);

it('audits every API route module for uncaught awaits in raw Express callbacks', () => {
  const directory = path.resolve(__dirname, '..');
  const files = fs.readdirSync(directory).filter(file => file.endsWith('.ts'));
  const unsafe: string[] = [];
  let registrations = 0;
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(directory, file), 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && /^(get|post|put|patch|delete|options|head|all)$/.test(node.expression.name.text)
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const route = `${file}:${node.arguments[0].text}`;
        registrations++;
        for (const callback of node.arguments.slice(1)) {
          if (!(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
            || !callback.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) continue;
          function inspect(child: ts.Node, caught: boolean) {
            if (ts.isFunctionLike(child)) return; // nested functions have separate ownership
            if (ts.isAwaitExpression(child) && !caught && !settledAggregates.has(route)) unsafe.push(route);
            if (ts.isTryStatement(child)) {
              inspect(child.tryBlock, caught || !!child.catchClause);
              if (child.catchClause) inspect(child.catchClause, caught);
              if (child.finallyBlock) inspect(child.finallyBlock, caught);
              return;
            }
            ts.forEachChild(child, next => inspect(next, caught));
          }
          inspect(callback.body, false);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(files.length).toBeGreaterThanOrEqual(40);
  expect(registrations).toBeGreaterThanOrEqual(200);
  expect([...new Set(unsafe)]).toEqual([]);
});
