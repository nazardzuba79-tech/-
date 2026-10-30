'use strict';
const {performance}=require('node:perf_hooks');
function stamp(){return{monoMs:Number(process.hrtime.bigint())/1e6,perfMs:performance.now(),wallMs:Date.now(),originEpochMs:performance.timeOrigin};}
// IPC brackets, never an assumed NTP/Date.now offset. Same isolated Linux host only.
function alignment(sent,remote,received){
 const finite=[sent,remote,received].every(s=>s&&['monoMs','perfMs','wallMs','originEpochMs'].every(k=>Number.isFinite(s[k])));
 const rttMs=finite?received.monoMs-sent.monoMs:null;
 const valid=finite&&rttMs>=0&&rttMs<=50&&remote.monoMs>=sent.monoMs-.5&&remote.monoMs<=received.monoMs+.5
  &&[sent,remote,received].every(s=>Math.abs(s.wallMs-s.originEpochMs-s.perfMs)<=5);
 return{valid,rttMs,sent,remote,received,toleranceMs:.5};
}
function validateClocks(before,after){
 const pick=rows=>rows.filter(r=>r.valid).sort((a,b)=>a.rttMs-b.rttMs)[0];
 const a=pick(before),b=pick(after);
 const offsets=r=>[r.remote,r.sent,r.received].map(s=>s.originEpochMs+s.perfMs-s.monoMs);
 const driftMs=a&&b?Math.max(...offsets(a),...offsets(b))-Math.min(...offsets(a),...offsets(b)):null;
 return{valid:!!a&&!!b&&driftMs<=2,driftMs,before,after,limits:{rttMs:50,epochMonoDriftMs:2},basis:'same-host hrtime; signed durations retained; no network-only inference'};
}
module.exports={stamp,alignment,validateClocks};
