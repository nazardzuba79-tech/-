import { readFileSync, readdirSync } from 'fs';
import { resolve, relative } from 'path';
import ts from 'typescript';
const root=resolve(__dirname,'../../../../..');
const read=(path:string)=>readFileSync(resolve(root,path),'utf8').replace(/\r\n/g,'\n');
const code=(path:string)=>read(path).replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/.*$/gm,'$1');

// Every reference must have an explicit non-financial role. Formatting and
// multiline constructor arguments must not turn this into a line-count check.
const allowedReferenceRoles = ['declaration', 'universe-condition', 'universe-provider',
  'gateway-reference-feed', 'snapshot-display-feed', 'market-options', 'start', 'stop'].sort();
const named = (node: ts.Node | undefined, name: string): boolean => Boolean(node && ts.isIdentifier(node) && node.text === name);
const newNamed = (node: ts.Node, name: string): node is ts.NewExpression => ts.isNewExpression(node) && named(node.expression, name);
const callNamed = (node: ts.Node, name: string): node is ts.CallExpression => ts.isCallExpression(node) && named(node.expression, name);
const declaredAs = (node: ts.Node, name: string): boolean => ts.isVariableDeclaration(node.parent) && node.parent.initializer === node && named(node.parent.name, name);
function universeChoice(node: ts.Node): node is ts.ConditionalExpression {
  return ts.isConditionalExpression(node) && declaredAs(node, 'venueUniverseSource') && named(node.condition, 'liveReferenceCollector')
    && newNamed(node.whenTrue, 'CollectorUniverseProvider') && node.whenTrue.arguments?.length === 1 && named(node.whenTrue.arguments[0], 'liveReferenceCollector')
    && newNamed(node.whenFalse, 'BybitMarketDataService') && node.whenFalse.arguments?.length === 0;
}
function mountedAtPublicApi(node: ts.Node): boolean {
  const mount = node.parent;
  return ts.isCallExpression(mount) && ts.isPropertyAccessExpression(mount.expression)
    && named(mount.expression.expression, 'app') && mount.expression.name.text === 'use'
    && mount.arguments.length === 2 && mount.arguments[1] === node
    && ts.isStringLiteral(mount.arguments[0]) && mount.arguments[0].text === '/api/v1';
}
function referenceRoles(source: string): string[] {
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const roles: string[] = [];
  const visit = (node: ts.Node) => {
    if (named(node, 'liveReferenceCollector')) {
      const parent = node.parent;
      let role = 'FORBIDDEN_REFERENCE';
      if (ts.isVariableDeclaration(parent) && parent.name === node && parent.initializer
        && callNamed(parent.initializer, 'collectorFromEnv') && parent.initializer.arguments.length === 0) role = 'declaration';
      else if (universeChoice(parent) && parent.condition === node) role = 'universe-condition';
      else if (newNamed(parent, 'CollectorUniverseProvider') && parent.arguments?.[0] === node
        && universeChoice(parent.parent) && parent.parent.whenTrue === parent) role = 'universe-provider';
      else if (callNamed(parent, 'marketOptionsRouter') && parent.arguments.length === 1
        && parent.arguments[0] === node && mountedAtPublicApi(parent)) role = 'market-options';
      else if (ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.questionDotToken) {
        const consumer = parent.parent;
        if (['start', 'stop'].includes(parent.name.text) && ts.isCallExpression(consumer)
          && consumer.expression === parent && consumer.arguments.length === 0) role = parent.name.text;
        else if (parent.name.text === 'feed' && ts.isBinaryExpression(consumer) && consumer.left === parent
          && consumer.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && consumer.right.kind === ts.SyntaxKind.NullKeyword) {
          const target = consumer.parent;
          if (newNamed(target, 'MarketDataGateway') && declaredAs(target, 'marketDataGateway') && target.arguments?.length === 6
            && target.arguments[5] === consumer && named(target.arguments[0], 'marketDataService')) role = 'gateway-reference-feed';
          else if (callNamed(target, 'displaySnapshotsRouter') && target.arguments.length === 3 && target.arguments[0] === consumer
            && named(target.arguments[1], 'marketDataService') && named(target.arguments[2], 'marketUniverse')
            && mountedAtPublicApi(target)) role = 'snapshot-display-feed';
        }
      }
      roles.push(role);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return roles.sort();
}

test('live ticker implementation is unreachable from financial services',()=>{
  const files:string[]=[];
  const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=resolve(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='__tests__')walk(path);}else if(path.endsWith('.ts'))files.push(relative(root,path).replace(/\\/g,'/'));
  }};
  walk(resolve(root,'src/services'));walk(resolve(root,'src/matching-engine'));
  const outside=files.filter(path=>!path.startsWith('src/services/marketData/'));
  for(const path of outside)expect(code(path)).not.toMatch(/BybitLiveTickerCollector|BybitTickerBook|MarketDataCollectorClient|LiveFeed|liveReferenceCollector|liveReference/);
  expect(referenceRoles(read('src/index.ts'))).toEqual(allowedReferenceRoles);
  expect(code('src/api/routes/marketOptions.ts')).not.toMatch(/router\.(post|put|delete|patch)\(|PositionService|Balance/);
  expect(code('src/services/marketData/MarketDataGateway.ts')).toContain("this.kraken.getTickersWithMeta()");
});
test('reference wiring checks accept formatting changes but reject financial routing, aliases and duplicate injection', () => {
  const source = read('src/index.ts');
  expect(referenceRoles(source.replace(/marketOptionsRouter\(liveReferenceCollector\)/, 'marketOptionsRouter(\n  liveReferenceCollector\n)'))).toEqual(allowedReferenceRoles);
  const mutations = [
    source.replace('ordersRouter(prisma, engine, marketDataService,', 'ordersRouter(prisma, engine, liveReferenceCollector?.feed,'),
    source.replace(/new MarketDataGateway\(\s*marketDataService,/, 'new MarketDataGateway(liveReferenceCollector?.feed,'),
    source + '\nconst executionFeed = liveReferenceCollector;\n',
    source + "\napp.use('/api/v1', marketOptionsRouter(liveReferenceCollector));\n",
  ];
  for (const mutation of mutations) {
    expect(mutation).not.toBe(source);
    expect(referenceRoles(mutation)).not.toEqual(allowedReferenceRoles);
  }
});
test('collector entry has no database, secrets file, trading, or private provider endpoint dependency',()=>{
  const entry=code('src/marketDataCollector.ts');
  expect(entry).not.toMatch(/prisma|DATABASE_URL|dotenv|OrderService|MatchingEngine|CopyPerformance/);
  const collector=code('src/services/marketData/bybit/BybitLiveTickerCollector.ts');
  expect(collector).not.toMatch(/\/private|\/order|api_key|api_secret/);
  const docker=read('Dockerfile.market-data');
  expect(docker).not.toMatch(/prisma\s+migrate|DATABASE_URL|ARG .*TOKEN/);
});
test('UI keeps executable gate and 50-row pagination, metadata-only icons avoid symbol guesses',()=>{
  const table=code('frontend/src/pages/markets-bolt/CatalogueTable.tsx');
  expect(table).toContain('const PER_PAGE = 50');
  expect(table).toContain('asset.tradable ? defaultTradingPair(asset) : null');
  expect(table).toContain('metadataOnly');expect(table).toContain('asset.market?.marketCapUsd');
  expect(code('frontend/src/lib/referenceAssets.ts')).toContain('tradingPairs: [], tradable: false');
});
