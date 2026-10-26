import { readFileSync, readdirSync } from 'fs';
import { resolve, relative } from 'path';
import type { Router } from 'express';
import { marketOptionsRouter } from '../../../../api/routes/marketOptions';
import { displaySnapshotsRouter } from '../../../../api/routes/displaySnapshots';
import { marketDepthRouter } from '../../../../api/routes/marketDepth';
import * as displayCache from '../../../../api/middleware/publicDisplayCache';
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
  // Exact allowlist: a new hand-off of the collector fails here until it is reviewed.
  // 3efe23b9 reads the venue universe through the collector, b32853b2 split the
  // gateway call over several lines, 8bc9a147 added the sampled display snapshots.
  expect(injection).toEqual([
    "const liveReferenceCollector = collectorFromEnv();",
    "const venueUniverseSource = liveReferenceCollector",
    "  ? new CollectorUniverseProvider(liveReferenceCollector)",
    "  liveReferenceCollector?.feed ?? null",
    "app.use('/api/v1', displaySnapshotsRouter(liveReferenceCollector?.feed ?? null, marketDataService, marketUniverse));",
    "app.use('/api/v1', marketOptionsRouter(liveReferenceCollector));",
    "  liveReferenceCollector?.start();",
    "  liveReferenceCollector?.stop();",
  ]);
  expect(code('src/api/routes/marketOptions.ts')).not.toMatch(/router\.(post|put|delete|patch)\(|PositionService|Balance/);
  expect(index).toMatch(/new MarketDataGateway\(\s*marketDataService,\s*coinGeckoService,\s*fearGreedService,\s*cfdDataService,\s*undefined,\s*liveReferenceCollector\?\.feed \?\? null\s*\)/);
  expect(code('src/services/marketData/MarketDataGateway.ts')).toContain("this.kraken.getTickersWithMeta()");
});
// The routers handed the collector feed or the collector-backed universe. Scope: the
// routes and middleware they register, not everything they import transitively.
test('routers fed by the collector register exactly these GET routes and middleware',()=>{
  const cache=jest.spyOn(displayCache,'publicDisplayCache');
  const display=displaySnapshotsRouter(null,{getOrderBookWithMeta:()=>Promise.reject(new Error('unused'))},null,{} as never);
  const caches=cache.mock.results.map(result=>result.value);
  cache.mockRestore();
  const shape=(router:Router)=>router.stack.map((layer:any)=>layer.route
    ?{path:layer.route.path,methods:Object.keys(layer.route.methods),
      handlers:layer.route.stack.map((h:any)=>h.method+(caches.includes(h.handle)?' displayCache':''))}
    :{use:String(layer.regexp),rateLimiter:typeof layer.handle.resetKey==='function'&&typeof layer.handle.getKey==='function'});
  expect(shape(marketOptionsRouter(null))).toEqual([
    {use:String(/^\/market\/options\/?(?=\/|$)/i),rateLimiter:true},
    {path:'/market/options/instruments',methods:['get'],handlers:['get']},
    {path:'/market/options/tickers',methods:['get'],handlers:['get']},
  ]);
  expect(caches).toHaveLength(4);
  expect(shape(display)).toEqual(['/market/display','/market/display/futures-book/:symbol','/market/display/futures-trades/:symbol',
    '/market/display/spot-book/:pair'].map(path=>({path,methods:['get'],handlers:['get displayCache','get']})));
  expect(shape(marketDepthRouter(null))).toEqual([{path:'/market/futures/orderbook/:symbol',methods:['get'],handlers:['get']}]);
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
