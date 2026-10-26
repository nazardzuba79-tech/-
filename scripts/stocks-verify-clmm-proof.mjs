/** Read-only, bounded evidence capture. Never enables trading or publishes OHLCV. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const CLMM='CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
export const MAINNET_GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKENS=new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const assert=(value,reason)=>{if(!value)throw Error(reason);};
export const discriminator=name=>createHash('sha256').update(name).digest().subarray(0,8);
export function b58(bytes){let n=0n,s='';for(const b of bytes)n=n*256n+BigInt(b);while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}let i=0;while(i<bytes.length&&bytes[i]===0)i++;return '1'.repeat(i)+s;}
function raw(account){assert(account?.data?.[1]==='base64','ACCOUNT_ENCODING');return Buffer.from(account.data[0],'base64');}
export function poolIdentity(account,mint){
 assert(account?.owner===CLMM,'UNKNOWN_POOL_PROGRAM');const b=raw(account);
 assert(b.length>=235&&b.subarray(0,8).equals(discriminator('account:PoolState')),'POOL_LAYOUT');
 const mints=[b58(b.subarray(73,105)),b58(b.subarray(105,137))];
 assert(mints.includes(mint)&&mints.includes(USDC)&&new Set(mints).size===2,'PAIR_MINT_MISMATCH');
 return {mints,vaults:[b58(b.subarray(137,169)),b58(b.subarray(169,201))],decimals:[b[233],b[234]]};
}
export function verifyVault(account,mint,pool){
 assert(TOKENS.has(account?.owner),'VAULT_TOKEN_PROGRAM');const b=raw(account);assert(b.length>=165,'VAULT_LAYOUT');
 assert(b58(b.subarray(0,32))===mint,'VAULT_MINT');assert(b58(b.subarray(32,64))===pool,'VAULT_AUTHORITY');assert(b[108]===1,'VAULT_NOT_INITIALIZED');
 return {tokenProgram:account.owner,mint,authority:pool};
}
export function extractSwapCandidates(tx,pool){
 assert(tx?.meta?.err===null,'FAILED_TRANSACTION');assert(Array.isArray(tx.meta.logMessages),'MISSING_LOGS');
 const stack=[],events=[];let invocationIndex=-1;
 for(let logIndex=0;logIndex<tx.meta.logMessages.length;logIndex++){
  const line=tx.meta.logMessages[logIndex];let m=line.match(/^Program (\w+) invoke \[(\d+)\]$/);
  if(m){assert(Number(m[2])===stack.length+1,'INVALID_LOG_STACK');stack.push(m[1]);invocationIndex++;continue;}
  m=line.match(/^Program (\w+) (?:success|failed:.*)$/);if(m){assert(stack.pop()===m[1],'INVALID_LOG_STACK');continue;}
  assert(!line.includes('Log truncated'),'TRUNCATED_LOGS');
  if(!line.startsWith('Program data: ')||stack.at(-1)!==CLMM)continue;
  const b=Buffer.from(line.slice(14),'base64');if(!b.subarray(0,8).equals(discriminator('event:SwapEvent')))continue;
  assert(b.length===221,'UNKNOWN_SWAP_LAYOUT');if(b58(b.subarray(8,40))!==pool)continue;
  assert(b[168]<=1,'INVALID_DIRECTION');
  const a0=b.readBigUInt64LE(136),a1=b.readBigUInt64LE(152);assert(a0>0n&&a1>0n,'ZERO_SWAP');
  events.push({logIndex,invocationIndex,eventBytes:b.length,amount0:a0.toString(),amount1:a1.toString(),transferFee0:b.readBigUInt64LE(144).toString(),transferFee1:b.readBigUInt64LE(160).toString(),zeroForOne:!!b[168],tradeFee0:b.readBigUInt64LE(205).toString(),tradeFee1:b.readBigUInt64LE(213).toString(),programVersionVerified:false});
 }
 assert(stack.length===0,'UNCLOSED_LOG_STACK');return events;
}
export function selectWindow(rows,from,to){
 assert(Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&to>from&&to-from<=600,'INVALID_WINDOW');
 const seen=new Set();let last=Infinity;
 for(const r of rows){assert(Number.isSafeInteger(r.slot)&&Number.isSafeInteger(r.blockTime),'MISSING_SIGNATURE_TIME');assert(r.confirmationStatus==='finalized','UNFINALIZED_SIGNATURE');assert(r.slot<=last,'SIGNATURE_ORDER');assert(!seen.has(r.signature),'DUPLICATE_SIGNATURE');seen.add(r.signature);last=r.slot;}
 assert(rows[0]?.blockTime>=to&&rows.at(-1)?.blockTime<from,'WINDOW_NOT_BRACKETED');
 return rows.filter(r=>r.blockTime>=from&&r.blockTime<to);
}
export async function capture({ticker='SPYx',from,to,out,maxRpc=40,delayMs=3000,reuseDirectory=null}){
 assert(['SPYx','CRCLx'].includes(ticker),'UNAPPROVED_PILOT');assert(Number.isSafeInteger(maxRpc)&&maxRpc>0&&maxRpc<=60,'RPC_BUDGET');
 const start=Date.parse(from)/1000,end=Date.parse(to)/1000;assert(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&end>start&&end-start<=600&&end<Date.now()/1000-60,'INVALID_WINDOW');
 await mkdir(out,{recursive:true});await writeFile(`${out}/capture.lock`,'one-shot\n',{flag:'wx'});let count=0;const receipts=[];
 let cache=[];if(reuseDirectory){const previous=JSON.parse(await readFile(`${reuseDirectory}/manifest.json`,'utf8'));assert(previous.ticker===ticker&&JSON.stringify(previous.windowUTC)===JSON.stringify([from,to]),'CACHE_SCOPE');cache=previous.receipts;}
 const report={network:'solana-mainnet-beta',ticker,startedAt:new Date().toISOString(),windowUTC:[from,to],rpcRequests:0,issuerVerified:false,poolOwnerVerified:false,pairMintVerified:false,vaultMintVerified:false,swapEventVerified:false,programVersionVerified:false,intervalComplete:false,multiplierChronologyVerified:false,commercialRightsVerified:false,productionReady:false,ohlcv: null,receipts};
 async function request(url,body){
  const key=x=>JSON.stringify(x,(k,v)=>k==='maxSupportedTransactionVersion'?undefined:v);
  const cached=cache.find(r=>r.url===url&&r.method===(body?.method??'GET')&&key(r.params)===key(body?.params??null)&&r.httpStatus===200);
  if(cached){const text=await readFile(`${reuseDirectory}/${cached.file}`,'utf8');assert(createHash('sha256').update(text).digest('hex')===cached.sha256,'CACHE_HASH');const parsed=JSON.parse(text);if(!parsed.error){const name=`receipt-${String(receipts.length+1).padStart(3,'0')}.json`;await writeFile(`${out}/${name}`,text);receipts.push({...cached,file:name,reusedFrom:reuseDirectory});return body?parsed.result:parsed;}}
  if(body){assert(++count<=maxRpc,'RPC_BUDGET_EXHAUSTED');await new Promise(r=>setTimeout(r,delayMs));}
  const at=new Date().toISOString();const response=await fetch(url,{method:body?'POST':'GET',redirect:'error',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const text=await response.text();assert(text.length<2500000,'RESPONSE_TOO_LARGE');const name=`receipt-${String(receipts.length+1).padStart(3,'0')}.json`;
  await writeFile(`${out}/${name}`,text);receipts.push({file:name,url,method:body?.method??'GET',params:body?.params??null,at,httpStatus:response.status,sha256:createHash('sha256').update(text).digest('hex')});
  assert(response.ok,`HTTP_${response.status}`);const result=JSON.parse(text);assert(!result.error,`RPC_${result.error?.code}`);return body?result.result:result;
 }
 const rpc=(method,params)=>{assert(['getAccountInfo','getMultipleAccounts','getSignaturesForAddress','getTransaction','getBlock','getGenesisHash'].includes(method),'UNSAFE_RPC_METHOD');return request('https://api.mainnet-beta.solana.com',{jsonrpc:'2.0',id:count+1,method,params});};
 try{
  const source=await readFile(new URL('../frontend/src/pages/stocks/onchainDiscoveredCandidates.ts',import.meta.url),'utf8');
  const candidates=JSON.parse(source.slice(source.indexOf('\n[')+1,source.lastIndexOf(']')+1));const candidate=candidates.find(x=>x.ticker===ticker);assert(candidate,'CANDIDATE_MISSING');Object.assign(report,{pool:candidate.pool,mint:candidate.mint});
  const issuer=await request(`https://api.xstocks.fi/api/v2/public/assets/${ticker}`);const deployments=issuer.deployments?.filter(x=>x.network==='Solana');
  assert(issuer.symbol===ticker&&deployments?.length===1&&deployments[0].address===candidate.mint,'ISSUER_MINT');report.issuerVerified=true;
  const genesis=await rpc('getGenesisHash',[]);assert(genesis===MAINNET_GENESIS,'WRONG_NETWORK');
  const state=await rpc('getAccountInfo',[candidate.pool,{encoding:'base64',commitment:'finalized'}]);const identity=poolIdentity(state.value,candidate.mint);
  Object.assign(report,{poolOwnerVerified:true,pairMintVerified:true,accountSlot:state.context.slot,identity});
  const vaults=await rpc('getMultipleAccounts',[identity.vaults,{encoding:'base64',commitment:'finalized',minContextSlot:state.context.slot}]);
  report.vaults=vaults.value.map((a,i)=>verifyVault(a,identity.mints[i],candidate.pool));report.vaultMintVerified=true;
  // Record deployed program identity. A current account hash is not verified source/binary correspondence.
  const program=await rpc('getAccountInfo',[CLMM,{encoding:'base64',commitment:'finalized'}]);assert(program.value?.executable,'PROGRAM_NOT_EXECUTABLE');
  const pb=raw(program.value);assert(pb.readUInt32LE(0)===2&&pb.length===36,'PROGRAM_LOADER_LAYOUT');report.programDataAddress=b58(pb.subarray(4));
  const pd=await rpc('getAccountInfo',[report.programDataAddress,{encoding:'base64',commitment:'finalized',dataSlice:{offset:0,length:45}}]);const pdb=raw(pd.value);assert(pdb.readUInt32LE(0)===3,'PROGRAM_DATA_LAYOUT');report.programLastDeploySlot=pdb.readBigUInt64LE(4).toString();
  const mintAccount=await rpc('getAccountInfo',[candidate.mint,{encoding:'jsonParsed',commitment:'finalized',minContextSlot:state.context.slot}]);
  const mintInfo=mintAccount?.value?.data?.parsed?.info;assert(TOKENS.has(mintAccount?.value?.owner)&&mintInfo?.isInitialized,'MINT_ACCOUNT');assert(mintInfo.decimals===identity.decimals[identity.mints.indexOf(candidate.mint)],'MINT_DECIMALS');
  report.mintExtensions=mintInfo.extensions??[];report.mintDecimalsVerified=true;
  report.issuerMultiplierHistory=await request(`https://api.xstocks.fi/api/v2/public/assets/${ticker}/multiplier/history?network=Solana`);
  report.issuerCurrentMultiplier=await request(`https://api.xstocks.fi/api/v2/public/assets/${ticker}/multiplier?network=Solana`);
  // Capture current extension and issuer records without falsely treating them as historical account proofs.
  const rows=[];let before;
  for(let page=0;page<3;page++){
   const batch=await rpc('getSignaturesForAddress',[candidate.pool,{limit:100,commitment:'finalized',...(before?{before}:{})}]);assert(Array.isArray(batch),'SIGNATURE_PAGE');rows.push(...batch);if(!batch.length||rows.at(-1).blockTime<Date.parse(from)/1000)break;before=rows.at(-1).signature;
  }
  report.signaturesScanned=rows.length;const selected=selectWindow(rows,Date.parse(from)/1000,Date.parse(to)/1000);report.signaturesInWindow=selected.length;
  assert(selected.length<=20,'WINDOW_TX_BUDGET');const txs=[];report.transactions=txs;
  for(const row of selected){if(row.err!==null)continue;const tx=await rpc('getTransaction',[row.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);assert(tx&&tx.slot===row.slot&&tx.blockTime===row.blockTime&&tx.transaction?.signatures?.includes(row.signature),'TRANSACTION_IDENTITY');txs.push({signature:row.signature,slot:row.slot,blockTime:row.blockTime,events:extractSwapCandidates(tx,candidate.pool)});}
  report.transactions=txs;report.swapCandidates=txs.reduce((n,t)=>n+t.events.length,0);
  const slots=new Map();for(const t of txs){const group=slots.get(t.slot)||[];group.push(t);slots.set(t.slot,group);}
  for(const [slot,group] of slots){if(group.length===1){group[0].transactionOrderWithinObservedPool=0;continue;}
   const block=await rpc('getBlock',[slot,{commitment:'finalized',encoding:'json',transactionDetails:'signatures',maxSupportedTransactionVersion:1,rewards:false}]);
   assert(Array.isArray(block?.signatures),'CANONICAL_BLOCK_MISSING');for(const t of group){const i=block.signatures.indexOf(t.signature);assert(i>=0,'CANONICAL_SIGNATURE_MISSING');t.transactionOrderWithinBlock=i;}
  }
  txs.sort((a,b)=>a.slot-b.slot||(a.transactionOrderWithinBlock??0)-(b.transactionOrderWithinBlock??0));
  report.observedTransactionOrderVerified=true;

  report.status='EVIDENCE_CAPTURED_NOT_PRICE_VERIFIED';report.blockers=['PROGRAM_SOURCE_BINARY_CORRESPONDENCE_UNVERIFIED','HISTORICAL_POOL_AND_VAULT_CONFIGURATION_UNVERIFIED','PAGINATION_COMPLETENESS_NOT_INDEPENDENTLY_PROVEN','TOKEN_2022_MULTIPLIER_AND_FEE_CHRONOLOGY_UNVERIFIED'];
 }catch(e){report.status='BLOCKED';report.blockers=[String(e.message)];}
 report.rpcRequests=count;report.finishedAt=new Date().toISOString();await writeFile(`${out}/manifest.json`,JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [ticker,from,to,out,reuseDirectory]=process.argv.slice(2);assert(ticker&&from&&to&&out,'Usage: node script SPYx ISO_FROM ISO_TO OUTPUT_DIRECTORY');const report=await capture({ticker,from,to,out,reuseDirectory});console.log(JSON.stringify(report,null,2));if(!report.intervalComplete)process.exitCode=2;}
