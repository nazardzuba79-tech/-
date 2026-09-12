import { readFileSync, readdirSync } from 'fs';
import { resolve, relative } from 'path';
const root=resolve(__dirname,'../../../../..');
const read=(path:string)=>readFileSync(resolve(root,path),'utf8').replace(/\r\n/g,'\n');
const code=(path:string)=>read(path).replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/.*$/gm,'$1');

test('live ticker implementation is unreachable from financial services',()=>{
  const files:string[]=[];
  const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=resolve(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='__tests__')walk(path);}else if(path.endsWith('.ts'))files.push(relative(root,path).replace(/\\/g,'/'));
  }};
  walk(resolve(root,'src/services'));walk(resolve(root,'src/matching-engine'));
  const outside=files.filter(path=>!path.startsWith('src/services/marketData/'));
  for(const path of outside)expect(code(path)).not.toMatch(/BybitLiveTickerCollector|BybitTickerBook|MarketDataCollectorClient|LiveFeed|liveReferenceCollector|liveReference/);
  const index=code('src/index.ts');
  const injection=index.split('\n').filter(line=>line.includes('liveReferenceCollector'));
  expect(injection).toHaveLength(5);
  expect(injection.filter(line=>line.includes('marketOptionsRouter'))).toEqual([
    "app.use('/api/v1', marketOptionsRouter(liveReferenceCollector));"
  ]);
  expect(code('src/api/routes/marketOptions.ts')).not.toMatch(/router\.(post|put|delete|patch)\(|PositionService|Balance/);
  expect(injection.find(line=>line.includes('new MarketDataGateway'))).toBeDefined();
  expect(code('src/services/marketData/MarketDataGateway.ts')).toContain("this.kraken.getTickersWithMeta()");
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
