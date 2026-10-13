// Production-mode frontend bundles for disposable public-host QA only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const sha=x=>createHash('sha256').update(x).digest('hex');
export const BEFORE="hostname === '127.0.0.1'";
export const AFTER="(hostname === '127.0.0.1' || hostname === 'stocks-review.invalid')";
export function files(directory){const result=[];const walk=relative=>{for(const item of fs.readdirSync(path.join(directory,relative),{withFileTypes:true})){if(item.name==='node_modules'||item.name.startsWith('dist')||item.name.startsWith('.env')||['.git','.vite','coverage'].includes(item.name))continue;const p=path.posix.join(relative,item.name);assert.ok(!item.isSymbolicLink(),'No source symlink: '+p);if(item.isDirectory())walk(p);else if(item.isFile()){const bytes=fs.readFileSync(path.join(directory,p));result.push({path:p,sha256:sha(bytes),bytes:bytes.length});}}};walk('');return result.sort((a,b)=>a.path.localeCompare(b.path));}
export function shadow(source){assert.equal(source.split(BEFORE).length-1,1,'Exactly one reviewed hostname hunk');return source.replace(BEFORE,AFTER);}
async function main(out){
  assert.ok(path.isAbsolute(out)&&!fs.existsSync(out));fs.mkdirSync(path.dirname(out),{recursive:true});fs.mkdirSync(out,{mode:0o700});const emptyEnv=path.join(out,'empty-env');fs.mkdirSync(emptyEnv);
  const frontend=path.join(root,'frontend'),before=files(frontend),target='src/pages/stocks/stockHostPolicy.ts',original=fs.readFileSync(path.join(frontend,target),'utf8');
  // PostCSS/Tailwind resolves relative content paths from the normal npm build cwd.
  process.chdir(frontend);
  const manifest={fixtureOnly:true,productionDeployment:false,sourceRoot:frontend,sourceFiles:before,sourceHash:sha(JSON.stringify(before)),node:process.version,builds:[],typeScriptCheck:'NOT_RUN_HERE; separate root TypeScript verification',startedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
  const vite=await import(pathToFileURL(require.resolve('../frontend/node_modules/vite')).href);
  for(const name of ['off','on','candidate']){
    const active=name!=='off';
    const env={VITE_STOCKS_ENABLED:String(active),VITE_STOCKS_GLOBAL_SIMULATOR:String(active),VITE_STOCKS_WIDGET_PREVIEW:String(active),VITE_STOCKS_OWNER_USDT_ONLY:String(active),VITE_STOCKS_SIMULATOR:'false',VITE_API_URL:'/api/v1',VITE_MARKET_EDGE_URL:'https://stocks-review.invalid/__fixture_market'};
    for(const key of Object.keys(process.env))if(key.startsWith('VITE_'))delete process.env[key];Object.assign(process.env,env);
    const loaded=await vite.loadConfigFromFile({command:'build',mode:'production'},path.join(frontend,'vite.config.ts'),frontend);assert.ok(loaded);
    let transforms=0,delta=null;const candidate={name:'reviewed-public-host-only',enforce:'pre',transform(source,id){if(name==='candidate'&&id.split('?')[0].replaceAll('\\','/')===path.join(frontend,target).replaceAll('\\','/')){assert.equal(source,original,'Candidate source must equal recorded original bytes');transforms++;const changed=shadow(source);delta={path:target,before:BEFORE,after:AFTER,originalSha256:sha(source),candidateSha256:sha(changed),scope:'build-memory QA shadow only; actual hostname fence is untouched'};return {code:changed,map:null};}}};
    const dist=path.join(out,name);
    await vite.build({...loaded.config,root:frontend,configFile:false,envDir:emptyEnv,mode:'production',plugins:[candidate,...loaded.config.plugins],build:{...loaded.config.build,outDir:dist,emptyOutDir:false},logLevel:'warn'});
    assert.equal(transforms,name==='candidate'?1:0);const output=files(dist);assert.ok(output.some(f=>f.path==='index.html'));
    manifest.builds.push({name,env,envDir:emptyEnv,productionMode:true,configDependencies:loaded.dependencies.map(file=>({path:file,sha256:sha(fs.readFileSync(file))})),dist,files:output,outputHash:sha(JSON.stringify(output)),candidateDelta:delta});
    assert.deepEqual(files(frontend),before,'Frontend changed during builds');fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
  }
  assert.equal(fs.readFileSync(path.join(frontend,target),'utf8'),original);manifest.complete=true;manifest.completedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({complete:true,output:out,sourceHash:manifest.sourceHash,builds:manifest.builds.map(b=>({name:b.name,files:b.files.length,outputHash:b.outputHash,candidateDelta:b.candidateDelta}))}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,4);assert.equal(process.argv[2],'--output');await main(process.argv[3]);}
