import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {replay,reconcile,unbase58,multiplierEvidence} from './stocks-reconcile-clmm-receipts.mjs';
import {b58,CLMM} from './stocks-verify-clmm-proof.mjs';
const root=new URL('../research/solana-xstocks/proof-615-20261025/',import.meta.url);
const dir=new URL('SPYx-replay-final/',root);
const manifest=JSON.parse(await readFile(new URL('manifest.json',dir)));
const receipt=manifest.receipts.find(r=>r.method==='getTransaction');
const original=JSON.parse(await readFile(new URL(receipt.file,dir))).result;
for(const [ticker,count,multiplier] of [['SPYx',8,'1.005714560286254'],['CRCLx',3,'1']])test(`${ticker} fresh mainnet Token2022 multipliers and fee-bearing executions remain unpublished`,async()=>{
 const directory=fileURLToPath(new URL(`../research/solana-xstocks/proof-615-20261026/windows-executions-1793034915829/${ticker}`,import.meta.url));
 const m=JSON.parse(await readFile(`${directory}/manifest.json`));
 const result=await replay(directory);
 assert.equal(result.transactions.length,count);assert.equal(result.networkRequests,0);assert.equal(result.priceReady,false);
 assert.equal(result.multiplierEvidence.issuerReportedWindowMultiplier,multiplier);
 assert.equal(result.multiplierEvidence.historicalOnChainChronologyVerified,false);
 assert(result.transactions.every(t=>t.vaultDeltasReconciled&&t.events.every(e=>e.transferCheckedReconciled&&e.zeroTransferFeesObserved&&!e.pricePublished)));
 const events=m.transactions.flatMap(t=>t.events);
 assert(events.every(e=>e.transferFee0==='0'&&e.transferFee1==='0'));
 assert(events.some(e=>BigInt(e.tradeFee0)>0n||BigInt(e.tradeFee1)>0n));
});
const keys=[...original.transaction.message.accountKeys,...original.meta.loadedAddresses.writable,...original.meta.loadedAddresses.readonly];
const swap=tx=>tx.meta.innerInstructions.flatMap(g=>g.instructions).find(i=>keys[i.programIdIndex]===CLMM);
const inputTransfer=tx=>{const xs=tx.meta.innerInstructions.flatMap(g=>g.instructions);return xs[xs.indexOf(swap(tx))+1];};
for(const ticker of ['SPYx','CRCLx'])test(`${ticker}: all immutable receipts reconcile without network`,async()=>{const r=await replay(fileURLToPath(new URL(`${ticker}-replay-final`,root)));assert.equal(r.transactions.length,ticker==='SPYx'?13:2);assert.equal(r.acceptedIntervals,0);assert.equal(r.priceReady,false);assert.ok(r.transactions.every(t=>t.vaultDeltasReconciled&&t.events.every(e=>e.transferCheckedReconciled)));});
const cases=[
 ['wrong pool',t=>swap(t).accounts[2]=0,'INSTRUCTION_POOL'],
 ['reversed vaults',t=>swap(t).accounts[5]=swap(t).accounts[6],'INSTRUCTION_VAULT'],
 ['wrong mint',t=>swap(t).accounts[11]=swap(t).accounts[12],'INSTRUCTION_MINT'],
 ['wrong token program',t=>swap(t).accounts[8]=0,'INSTRUCTION_TOKEN_PROGRAM'],
 ['wrong sender',t=>swap(t).accounts[0]=0,'EVENT_SENDER'],
 ['wrong user account',t=>swap(t).accounts[3]=0,'EVENT_USER_ACCOUNT'],
 ['unsupported instruction',t=>{const i=swap(t),b=unbase58(i.data);b[0]^=1;i.data=b58(b);},'UNSUPPORTED_SWAP_INSTRUCTION'],
 ['wrong transfer source',t=>inputTransfer(t).accounts[0]=0,'TOKEN_CPI_ACCOUNTS'],
 ['wrong amount',t=>{const i=inputTransfer(t),b=unbase58(i.data);b[1]^=1;i.data=b58(b);},'TOKEN_CPI_AMOUNT'],
 ['wrong decimals',t=>{const i=inputTransfer(t),b=unbase58(i.data);b[9]++;i.data=b58(b);},'TOKEN_CPI_DECIMALS'],
 ['unchecked transfer',t=>{const i=inputTransfer(t),b=unbase58(i.data);b[0]=3;i.data=b58(b);},'TRANSFER_CHECKED_LAYOUT'],
 ['wrong nesting',t=>inputTransfer(t).stackHeight=2,'INSTRUCTION_LOG_BINDING'],
 ['missing instruction',t=>t.meta.innerInstructions[0].instructions.pop(),'INSTRUCTION_LOG_BINDING'],
 ['missing balance',t=>t.meta.preTokenBalances=t.meta.preTokenBalances.filter(b=>b.owner!==manifest.pool),'VAULT_BALANCE_MISSING'],
 ['wrong historical token program',t=>t.meta.preTokenBalances.find(b=>b.owner===manifest.pool).programId='wrong','TOKEN_CPI_HISTORICAL_PROGRAM'],
 ['wrong historical mint',t=>t.meta.preTokenBalances.find(b=>b.owner===manifest.pool).mint='wrong','HISTORICAL_VAULT_METADATA'],
 ['wrong historical owner',t=>t.meta.preTokenBalances.find(b=>b.owner===manifest.pool).owner='wrong','HISTORICAL_VAULT_METADATA'],
 ['unexplained vault delta',t=>t.meta.postTokenBalances.find(b=>b.owner===manifest.pool).uiTokenAmount.amount='1','VAULT_DELTA_UNRECONCILED'],
 ['loaded address corruption',t=>t.meta.loadedAddresses.writable[keys.indexOf(manifest.pool)-t.transaction.message.accountKeys.length]='wrong','INSTRUCTION_POOL'],
];
for(const [name,mutate,error] of cases)test(`reject ${name}`,()=>{const tx=structuredClone(original);mutate(tx);assert.throws(()=>reconcile(tx,manifest),new RegExp(error));});
test('base58 zero roundtrip and invalid alphabet',()=>{assert.deepEqual(unbase58(b58(Buffer.from([0,0,12,255]))),Buffer.from([0,0,12,255]));assert.throws(()=>unbase58('0'),/BASE58/);});

test('multiplier chronology remains unverified despite current agreement',()=>{const r=multiplierEvidence(manifest);assert.equal(r.issuerReportedWindowMultiplier,'1.005714560286254');assert.equal(r.historicalOnChainChronologyVerified,false);});
for(const [name,mutate,error] of [
 ['paginated history',m=>m.issuerMultiplierHistory.page.hasNextPage=true,'ISSUER_HISTORY_PAGINATED'],
 ['broken history chain',m=>m.issuerMultiplierHistory.nodes[0].previousMultiplier=999,'ISSUER_HISTORY_CHAIN'],
 ['disagrees with mint',m=>m.mintExtensions.find(e=>e.extension==='scaledUiAmountConfig').state.newMultiplier='999','ISSUER_CURRENT_EXTENSION_MISMATCH'],
 ['change inside interval',m=>m.issuerMultiplierHistory.nodes[0].activationDateTime='2026-10-25T10:39:30Z','MULTIPLIER_CHANGE_IN_WINDOW']
])test(`reject ${name}`,()=>{const m=structuredClone(manifest);mutate(m);assert.throws(()=>multiplierEvidence(m),new RegExp(error));});
