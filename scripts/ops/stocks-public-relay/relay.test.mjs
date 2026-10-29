import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createPublicRelay } from './relay.mjs';
import { verifySignedSnapshot, InvalidSnapshot } from './verify.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const mint = '11111111111111111111111111111111';
const pool = '22222222222222222222222222222222';
let time = 1793280000000;
const makePage = () => ({
  schema: 'voltex.solana-ohlcv.v1', instrumentId: `SOLANA:${mint}:${pool}`, interval:'1m', priceKind:'raw-token', quoteCurrency:'USDC',
  range:{from:1793280000, to:1793280120},
  candles:[{time:1793280000,open:1.1,high:1.2,low:1.0,close:1.15,volume:100,tradeCount:2,proofDigest:'a'.repeat(64)}],
  gaps:[{time:1793280060,reason:'NO_TRADES'}],
  provenance:{status:'ACCEPTED',intervalComplete:true,finality:'finalized',synthetic:false,receiptsHash:'b'.repeat(64),acceptedTradeCount:2,
    source:{network:'solana-mainnet-beta',program:'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',quoteMint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',mint,pool},
    gates:{programIdentity:true,poolState:true,mintChronology:true,feeChronology:true,completeness:true,executionBinding:true}}
});
const seal = (page = makePage(), offset = 0) => {
  const payloadB64 = Buffer.from(JSON.stringify({issuedAtMs:time,expiresAtMs:time+25000+offset,page})).toString('base64url');
  return {payloadB64,signatureB64:sign(null,Buffer.from(payloadB64,'base64url'),privateKey).toString('base64url')};
};

test('accepts correctly signed, complete, finalized SOLANA page', () => {
  const got=verifySignedSnapshot(seal(),pub,time);assert.equal(got.id.interval,'1m');
});
test('signature tampering, stale and unknown proofs fail closed', () => {
  const e=seal();const tampered={...e,payloadB64:Buffer.from(JSON.stringify({issuedAtMs:time,expiresAtMs:time+10000,page:makePage()})).toString('base64url')};
  assert.throws(()=>verifySignedSnapshot(tampered,pub,time), /SIGNATURE_INVALID/);
  assert.throws(()=>verifySignedSnapshot(e,pub,time+30000), /SNAPSHOT_STALE/);
  const page=makePage();page.provenance.gates.completeness=false;
  assert.throws(()=>verifySignedSnapshot(seal(page),pub,time), /PROOF_UNVERIFIED/);
});
test('rejects numeric prices in gaps and incomplete or wrong mint data', () => {
  const page=makePage();page.candles[0].time=1793280060;
  assert.throws(()=>verifySignedSnapshot(seal(page),pub,time), /COVERAGE_INVALID/);
  page.candles[0].time=1793280000;page.provenance.source.quoteMint='x';
  assert.throws(()=>verifySignedSnapshot(seal(page),pub,time), /SOURCE_UNAVAILABLE/);
});

test('serves public signed bytes only, never API or finance; expired data returns 503', async () => {
  let file=Buffer.from(JSON.stringify(seal()));
  const relay=createPublicRelay({snapshotPath:'fixture',publicKey:pub,clock:()=>time,read:()=>file});
  await new Promise(ok=>relay.server.listen(0,'127.0.0.1',ok));
  const base=`http://127.0.0.1:${relay.server.address().port}`;
  try {
    const url=`${base}/v1/public/ohlcv?instrumentId=${encodeURIComponent(`SOLANA:${mint}:${pool}`)}&interval=1m`;
    let r=await fetch(url);assert.equal(r.status,200);assert.deepEqual(await r.json(),seal());
    r=await fetch(`${base}/api/v1/balances`);assert.equal(r.status,404);
    r=await fetch(`${base}/api/v1/orders`,{method:'POST',body:'{}'});assert.equal(r.status,405);
    r=await fetch(`${base}/health`);assert.equal(r.status,200);assert.equal((await r.json()).streams,0);
    time+=30000;r=await fetch(url);assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'SOURCE_UNAVAILABLE'});
  } finally {await relay.close();}
});

test('SSE fan-out is bounded, and closes clients without identity data', async () => {
  time=1793280000000;
  let file=Buffer.from(JSON.stringify(seal()));
  const relay=createPublicRelay({snapshotPath:'fixture',publicKey:pub,clock:()=>time,read:()=>file,maxStreams:1,tickMs:10});
  await new Promise(ok=>relay.server.listen(0,'127.0.0.1',ok));
  const base=`http://127.0.0.1:${relay.server.address().port}`;
  const url=`${base}/v1/public/stream?instrumentId=${encodeURIComponent(`SOLANA:${mint}:${pool}`)}&interval=1m`;
  const ctrl=new AbortController();
  try {
    const r=await fetch(url,{signal:ctrl.signal});assert.equal(r.status,200);
    const reader=r.body.getReader();let d=await reader.read();assert.match(new TextDecoder().decode(d.value),/event: signed-page/);
    assert.equal(relay.activeStreams(),1);
    const second=await fetch(url);assert.equal(second.status,503);assert.equal(second.headers.get('retry-after'),'1');
    ctrl.abort();await reader.cancel().catch(()=>{});
  } finally {await relay.close();}
});
