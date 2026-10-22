import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteReader } from './server.mjs';
const BASE=1800000000000;
function fixture(t){let time=BASE,sourceTime=BASE,calls=0;const quote=createQuoteReader({now:()=>time,hub:{quote:async()=>{calls++;return{instrumentId:'fixture',timestamp:sourceTime,receivedAt:time,eventId:'source-'+sourceTime};}}});t.after(()=>quote.close());return{quote,advance:()=>time+=100,source:value=>sourceTime=value,calls:()=>calls};}
test('post-demand authority read reacquires instead of reusing a pre-demand cache entry',async t=>{const f=fixture(t);await f.quote('fixture');f.advance();f.source(BASE+100);const q=await f.quote('fixture',{minimumTimestamp:BASE+100});assert.equal(f.calls(),2);assert.equal(q.timestamp,BASE+100);});
test('ordinary viewer keeps the same two-second cache without extra source starts',async t=>{const f=fixture(t);await f.quote('fixture');f.advance();f.source(BASE+100);const q=await f.quote('fixture');assert.equal(f.calls(),1);assert.equal(q.timestamp,BASE);});
test('a provider that still returns an older source time is never relabelled as post-demand',async t=>{const f=fixture(t);await f.quote('fixture');f.advance();const q=await f.quote('fixture',{minimumTimestamp:BASE+100});assert.equal(f.calls(),2);assert.equal(q.timestamp,BASE);assert.equal(q.eventId,'source-'+BASE);});
