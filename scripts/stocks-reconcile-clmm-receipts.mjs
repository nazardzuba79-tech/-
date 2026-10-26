/** Offline structural reconciliation only: never certifies deployed code or publishes prices. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {assert,b58,CLMM,USDC,discriminator,extractSwapCandidates} from './stocks-verify-clmm-proof.mjs';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const tokenPrograms=['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
export function unbase58(s){assert(typeof s==='string'&&s.length>0,'BASE58');let n=0n;for(const c of s){const i=alphabet.indexOf(c);assert(i>=0,'BASE58');n=n*58n+BigInt(i);}let hex=n.toString(16);if(hex.length%2)hex='0'+hex;return Buffer.concat([Buffer.alloc(s.match(/^1*/)[0].length),n?Buffer.from(hex,'hex'):Buffer.alloc(0)]);}
export function reconcile(tx,manifest){
 const events=extractSwapCandidates(tx,manifest.pool),message=tx.transaction.message;
 assert(events.length>0,'NO_TARGET_EVENTS');assert(manifest.identity.mints[1]===USDC,'QUOTE_ORDER');
 const keys=[...message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
 assert(keys.every(k=>typeof k==='string'),'KEY_ENCODING');
 const instructions=[];
 for(const [i,ix] of message.instructions.entries()){instructions.push({...ix,depth:1});const groups=tx.meta.innerInstructions.filter(g=>g.index===i);assert(groups.length<=1,'DUPLICATE_INNER_GROUP');for(const child of groups[0]?.instructions??[])instructions.push({...child,depth:child.stackHeight});}
 const stack=[],nodes=[],eventNodes=new Map();let next=0;
 for(const [logIndex,line] of tx.meta.logMessages.entries()){
  let m=line.match(/^Program (\w+) invoke \[(\d+)\]$/);
  if(m){const ix=instructions[next++];assert(ix&&keys[ix.programIdIndex]===m[1]&&ix.depth===Number(m[2]),'INSTRUCTION_LOG_BINDING');const node={ix,children:[],events:[]};if(stack.length)stack.at(-1).children.push(node);stack.push(node);nodes.push(node);continue;}
  if(/^Program \w+ (?:success|failed:.*)$/.test(line)){stack.pop();continue;}
  if(events.some(e=>e.logIndex===logIndex)){assert(stack.at(-1),'EVENT_WITHOUT_INSTRUCTION');eventNodes.set(logIndex,stack.at(-1));stack.at(-1).events.push(logIndex);}
 }
 assert(next===instructions.length,'UNMATCHED_INSTRUCTIONS');
 const results=[];const expectedDelta=[0n,0n];
 for(const e of events){
  const node=eventNodes.get(e.logIndex),ix=node.ix,a=ix.accounts.map(i=>keys[i]);
  assert(node.events.length===1,'AMBIGUOUS_EVENT_BINDING');
  assert(keys[ix.programIdIndex]===CLMM&&unbase58(ix.data).subarray(0,8).equals(discriminator('global:swap_v2')),'UNSUPPORTED_SWAP_INSTRUCTION');
  assert(a.length>=13&&a[2]===manifest.pool,'INSTRUCTION_POOL');
  const input=e.zeroForOne?0:1,output=1-input;
  assert(a[5]===manifest.identity.vaults[input]&&a[6]===manifest.identity.vaults[output],'INSTRUCTION_VAULT');
  assert(a[11]===manifest.identity.mints[input]&&a[12]===manifest.identity.mints[output],'INSTRUCTION_MINT');
  assert(a[8]===tokenPrograms[0]&&a[9]===tokenPrograms[1],'INSTRUCTION_TOKEN_PROGRAM');
  const eventBytes=Buffer.from(tx.meta.logMessages[e.logIndex].slice(14),'base64');
  assert(b58(eventBytes.subarray(40,72))===a[0],'EVENT_SENDER');
  assert(b58(eventBytes.subarray(72+input*32,104+input*32))===a[3]&&b58(eventBytes.subarray(72+output*32,104+output*32))===a[4],'EVENT_USER_ACCOUNT');
  assert(e.transferFee0==='0'&&e.transferFee1==='0','NONZERO_TRANSFER_FEE_UNSUPPORTED');
  assert(node.children.length===2,'UNEXPECTED_SWAP_CHILDREN');
  for(const [j,child] of node.children.entries()){
   const c=child.ix,ca=c.accounts.map(i=>keys[i]),data=unbase58(c.data),side=j===0?input:output;
   assert(child.children.length===0&&tokenPrograms.includes(keys[c.programIdIndex]),'TOKEN_CPI_PROGRAM');
   assert(data[0]===12&&data.length===10&&ca.length===4,'TRANSFER_CHECKED_LAYOUT');
   assert(ca[0]===(j===0?a[3]:a[6])&&ca[1]===manifest.identity.mints[side]&&ca[2]===(j===0?a[5]:a[4])&&ca[3]===(j===0?a[0]:manifest.pool),'TOKEN_CPI_ACCOUNTS');
   assert(data[9]===manifest.identity.decimals[side],'TOKEN_CPI_DECIMALS');
   const vaultIndex=keys.indexOf(manifest.identity.vaults[side]);
   const historical=tx.meta.preTokenBalances.find(b=>b.accountIndex===vaultIndex);assert(historical,'VAULT_BALANCE_MISSING');assert(historical.programId===keys[c.programIdIndex],'TOKEN_CPI_HISTORICAL_PROGRAM');
   assert(data.readBigUInt64LE(1)===BigInt(e[`amount${side}`]),'TOKEN_CPI_AMOUNT');
  }
  for(let side=0;side<2;side++)expectedDelta[side]+=(side===input?1n:-1n)*BigInt(e[`amount${side}`]);
  results.push({logIndex:e.logIndex,instructionAccountBinding:true,transferCheckedReconciled:true,zeroTransferFeesObserved:true,rawAmounts:[e.amount0,e.amount1],rawQuotePerBaseRational:{numerator:(BigInt(e.amount1)*10n**BigInt(manifest.identity.decimals[0])).toString(),denominator:(BigInt(e.amount0)*10n**BigInt(manifest.identity.decimals[1])).toString()},pricePublished:false});
 }
 for(let side=0;side<2;side++){
  const index=keys.indexOf(manifest.identity.vaults[side]);assert(index>=0,'VAULT_KEY');
  const balances=[tx.meta.preTokenBalances,tx.meta.postTokenBalances].map(rows=>{const matches=rows.filter(b=>b.accountIndex===index);assert(matches.length===1,'VAULT_BALANCE_MISSING');const b=matches[0];assert(b.mint===manifest.identity.mints[side]&&b.owner===manifest.pool&&b.uiTokenAmount.decimals===manifest.identity.decimals[side]&&tokenPrograms.includes(b.programId),'HISTORICAL_VAULT_METADATA');return BigInt(b.uiTokenAmount.amount);});
  assert(balances[1]-balances[0]===expectedDelta[side],'VAULT_DELTA_UNRECONCILED');
 }
 return {signature:tx.transaction.signatures[0],slot:tx.slot,events:results,historicalVaultBalanceMetadataVerified:true,vaultDeltasReconciled:true,programVersionVerified:false,intervalComplete:false};
}
export function multiplierEvidence(m){
 const ext=m.mintExtensions.find(e=>e.extension==='scaledUiAmountConfig')?.state;
 assert(ext,'SCALED_EXTENSION_MISSING');const from=Date.parse(m.windowUTC[0]),to=Date.parse(m.windowUTC[1]);
 assert(m.issuerMultiplierHistory?.page?.hasNextPage===false,'ISSUER_HISTORY_PAGINATED');
 const nodes=[...m.issuerMultiplierHistory.nodes].sort((a,b)=>Date.parse(a.activationDateTime)-Date.parse(b.activationDateTime));
 let prior=1;for(const n of nodes){assert(Number.isFinite(Date.parse(n.activationDateTime))&&Number(n.previousMultiplier)===prior&&Number(n.multiplier)>0,'ISSUER_HISTORY_CHAIN');prior=Number(n.multiplier);}
 const effective=nodes.filter(n=>Date.parse(n.activationDateTime)<=from).at(-1)?.multiplier??1;
 assert(!nodes.some(n=>Date.parse(n.activationDateTime)>from&&Date.parse(n.activationDateTime)<to),'MULTIPLIER_CHANGE_IN_WINDOW');
 const stateEffective=Number(ext.newMultiplierEffectiveTimestamp)*1000<=from?ext.newMultiplier:ext.multiplier;
 assert(Number(stateEffective)===Number(effective),'ISSUER_CURRENT_EXTENSION_MISMATCH');
 return {issuerHistoryChainConsistent:true,issuerHistoryPagesComplete:true,issuerReportedWindowMultiplier:String(effective),currentMintAgrees:true,historicalOnChainChronologyVerified:false,reason:'Captured mint state is later than interval; issuer API is not an immutable record of mint-update execution. Do not apply this multiplier to accepted prices.'};
}
export async function replay(directory){
 const m=JSON.parse(await readFile(`${directory}/manifest.json`,'utf8')),results=[];
 for(const receipt of m.receipts.filter(r=>r.method==='getTransaction')){const raw=await readFile(`${directory}/${receipt.file}`);assert(createHash('sha256').update(raw).digest('hex')===receipt.sha256,'RECEIPT_HASH');results.push(reconcile(JSON.parse(raw).result,m));}
 const chronology=multiplierEvidence(m);
 const canonical=new Map(m.transactions.map((t,i)=>[t.signature,i]));
 results.sort((a,b)=>canonical.get(a.signature)-canonical.get(b.signature));
 return {ticker:m.ticker,windowUTC:m.windowUTC,networkRequests:0,transactions:results,multiplierEvidence:chronology,acceptedIntervals:0,priceReady:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const result=await replay(process.argv[2]);await writeFile(process.argv[3],JSON.stringify(result,null,2)+'\n');console.log(`${result.ticker}: ${result.transactions.length} reconciled, 0 accepted intervals`);}
