// Disposable frontend QA assets/read fixtures. No production gateway contract.
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const sha=x=>createHash('sha256').update(x).digest('hex');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.mp4':'video/mp4'};
function walletFixtures(root){
  // Reuse the reviewed private Wallet fixture, without executing its runner.
  const ts=require(path.join(root,'node_modules/typescript')),file=path.join(root,'scripts/qa-stocks-wallet-journey.cjs'),source=fs.readFileSync(file,'utf8');
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const nodes=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='fixtureWallet');
  assert.equal(nodes.length,1);const text=nodes[0].getText(ast);
  const wallet=vm.runInNewContext('('+text+')()', {Date},{timeout:1000});
  const performance={periods:{},ageDays:0,startedOn:null};
  for(const k of ['7d','30d','90d','1y','all'])performance.periods[k]={period:k,available:false,startDate:null,endDate:null,startEquity:null,endEquity:null,absolutePnl:null,percent:null,points:[]};
  const spot=[{asset:'BTC',available:'2',locked:'0',priceUsd:100000,valueUsd:200000},{asset:'USDT',available:'5000',locked:'0',priceUsd:1,valueUsd:5000}];
  const routes=new Map([
    ['/api/v1/private-trading/native/wallet',wallet],['/api/v1/private-trading/access',{allowed:true,nativeAvailable:true}],
    ['/api/v1/wallet/overview',{real:{spot,futures:[],spotValueUsd:205000,futuresValueUsd:0,totalValueUsd:205000},valuationComplete:true,unpricedAssets:[],btcPriceUsd:100000}],
    ['/api/v1/wallet/performance',performance],['/api/v1/balances',spot],
    ...['futures/balances','deposits/me','withdrawals/me','trades/me'].map(p=>['/api/v1/'+p,[]]),
  ]);
  return {routes,provenance:{path:path.relative(root,file).replaceAll('\\','/'),sha256:sha(source),functionSha256:sha(text),scope:'private QA values only; not market observations'}};
}
function staticFixture({build,authorityOrigin,reads,audit}){
  assert.match(authorityOrigin,/^http:\/\/127\.0\.0\.1:\d+$/);const authority=new URL(authorityOrigin);
  const files=new Map(build.files.map(f=>[f.path,f]));assert.ok(files.has('index.html'));
  for(const f of files.values()){assert.ok(!f.path.includes('..')&&!path.isAbsolute(f.path));assert.equal(sha(fs.readFileSync(path.join(build.dist,f.path))),f.sha256);}
  return (req,res,{origin})=>{
    const begin=performance.now();let done=false,outbound;
    const finish=(status,body,contentType='application/json')=>{
      if(done)return;done=true;clearTimeout(timer);outbound?.destroy();
      if(!res.destroyed){res.writeHead(status,{'content-type':contentType,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);}
    };
    const fail=(status,error)=>{audit.denied.push({method:req.method,path:req.url?.split('?')[0],error});finish(status,JSON.stringify({error}));};
    const timer=setTimeout(()=>fail(504,'STATIC_FIXTURE_DEADLINE'),3000);
    res.once('close',()=>{done=true;clearTimeout(timer);outbound?.destroy();});
    const seen=new Set();for(let i=0;i<req.rawHeaders.length;i+=2){const n=req.rawHeaders[i].toLowerCase();if(seen.has(n))return fail(400,'DUPLICATE_HEADER');seen.add(n);}
    if(req.headers.origin!==undefined&&req.headers.origin!==origin)return fail(403,'ORIGIN_DENIED');
    if(!['GET','HEAD'].includes(req.method))return fail(405,'STATIC_READ_ONLY');
    if(req.headers['transfer-encoding']!==undefined||Number(req.headers['content-length']||0)!==0)return fail(400,'BODY_NOT_ALLOWED');
    if(!req.url||req.url.length>8192||/[\\#\r\n]/.test(req.url))return fail(404,'STATIC_PATH_DENIED');
    let target;try{target=new URL(req.url,origin);}catch{return fail(404,'STATIC_PATH_DENIED');}
    if(target.origin!==origin)return fail(403,'ORIGIN_DENIED');
    if(target.pathname.startsWith('/api/')){
      // Browsers normally omit Origin on same-origin GET; no header rewriting.
      if(req.method!=='GET'||req.headers['sec-fetch-site']!=='same-origin')return fail(403,'READ_CONTEXT_DENIED');
      if(!/^Bearer [^\r\n]{1,4096}$/.test(req.headers.authorization||''))return fail(401,'FIXTURE_AUTH_REQUIRED');
      if(target.pathname==='/api/v1/me'){
        audit.authorityReads++;
        outbound=http.request({hostname:'127.0.0.1',port:+authority.port,path:'/api/v1/me',method:'GET',headers:{authorization:req.headers.authorization},agent:false},up=>{
          let bytes=0;const chunks=[];up.on('data',b=>{bytes+=b.length;if(bytes>1024*1024+16384)return fail(502,'AUTH_BODY_LIMIT');chunks.push(b);});
          up.on('error',()=>fail(502,'AUTH_FIXTURE_ERROR'));up.on('aborted',()=>fail(502,'AUTH_FIXTURE_ABORTED'));
          up.on('end',()=>{if(performance.now()-begin>=3000)return fail(504,'STATIC_FIXTURE_DEADLINE');finish(up.statusCode,Buffer.concat(chunks));});
        });outbound.on('error',()=>fail(502,'AUTH_FIXTURE_ERROR'));outbound.end();return;
      }
      if(reads.has(target.pathname)){audit.fixtureReads.push(target.pathname);return finish(200,JSON.stringify(reads.get(target.pathname)));}
      return fail(404,'NO_PRIVATE_FIXTURE');
    }
    if(req.headers['sec-fetch-site']!==undefined&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return fail(403,'STATIC_CONTEXT_DENIED');
    // A finite exact manifest allowlist; no arbitrary filesystem path resolution.
    const relative=target.pathname.slice(1),spa=['/','/wallet','/stocks'].includes(target.pathname)||/^\/stocks\/[A-Za-z0-9%:_-]+$/.test(target.pathname);
    const entry=files.get(relative)||(spa?files.get('index.html'):null);
    if(!entry)return fail(404,'STATIC_NOT_FOUND');
    if(entry.bytes>16*1024*1024)return fail(413,'STATIC_FILE_LIMIT');
    const bytes=fs.readFileSync(path.join(build.dist,entry.path));if(sha(bytes)!==entry.sha256)return fail(500,'STATIC_HASH_MISMATCH');
    if(performance.now()-begin>=3000)return fail(504,'STATIC_FIXTURE_DEADLINE');
    audit.assets++;finish(200,bytes,MIME[path.extname(entry.path)]||'application/octet-stream');
  };
}
module.exports={walletFixtures,staticFixture,sha};
