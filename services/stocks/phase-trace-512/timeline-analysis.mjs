// Validates capture completeness independently of workload acceptance.
const columns=['attempt','startMs','endMs','route','httpStatus','outcome','transportCode','publicCode','clientCancellation','responseComplete'];
const routes={1:'state',2:'chart',3:'history-page'};
const count=(object,key)=>object[key]=(object[key]??0)+1;
const equalCounts=(a,b)=>Object.keys({...a,...b}).every(key=>(a[key]??0)===(b[key]??0));
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]:null;
const bucketNames=['0–3s','3–6s','6–12s','12–30s','30s+'];
const bucket=ms=>ms<3000?0:ms<6000?1:ms<12000?2:ms<30000?3:4;
export function reconcile(reader){
 const t=reader.requestTimeline,issues=[];
 if(!t?.enabled||t.format!==1||!Array.isArray(t.rows)||!Number.isSafeInteger(t.maxRows)||t.maxRows<=0||JSON.stringify(t.columns)!==JSON.stringify(columns))return {pass:false,issues:['TIMELINE_FORMAT_OR_GATE_INVALID']};
 if(!t.complete||t.dropped!==0||t.begun!==t.ended||t.begun!==reader.requests||t.rows.length!==reader.requests||t.rows.length>t.maxRows)issues.push('TIMELINE_INCOMPLETE_OR_OVERFLOW');
 const counters={requests:0,ok:0,errors:0,statuses:{},failures:{},httpErrorCodes:{},byOperation:{}};
 const bins={byStart:bucketNames.map(range=>({range,requests:0,errors:0,failures:{},byOperation:{}})),byEnd:bucketNames.map(range=>({range,requests:0,errors:0,failures:{},byOperation:{}}))};
 const durations=[];let previousStart=-1;
 for(const row of t.rows){
  const [attempt,start,end,route,status,outcome,transport,publicCode,cancel,complete]=row;
  if(row.length!==columns.length||attempt!==counters.requests+1||!Number.isFinite(start)||start<previousStart||!Number.isFinite(end)||end<start||!routes[route]||![1,2].includes(outcome)||![0,1,2,3].includes(cancel)||![0,1].includes(complete)||!Number.isInteger(status)||status<0||status>599||(status>0&&status<100)){
   issues.push('TIMELINE_ROW_INVALID');continue;
  }
  previousStart=start;counters.requests++;durations.push(end-start);
  const operation=routes[route],op=counters.byOperation[operation]??={ok:0,errors:0,failures:{},httpErrorCodes:{}};
  if(complete)count(counters.statuses,String(status));
  if(outcome===1){counters.ok++;op.ok++;if(!complete||status!==200||transport!==null||publicCode!==null||cancel!==0)issues.push('TIMELINE_SUCCESS_INVALID');}
  else{counters.errors++;op.errors++;if(typeof transport!=='string')issues.push('TIMELINE_FAILURE_CODE_MISSING');count(counters.failures,transport);count(op.failures,transport);}
  if(publicCode!==null){const key=`HTTP_${status}:${publicCode}`;count(counters.httpErrorCodes,key);count(op.httpErrorCodes,key);if(!complete||outcome!==2||status===200||transport!==`HTTP_${status}`)issues.push('TIMELINE_HTTP_FAILURE_INVALID');}
  if(transport==='DEADLINE_3000MS'&&cancel!==1)issues.push('TIMELINE_DEADLINE_CANCELLATION_MISSING');
  for(const [key,time] of [['byStart',start],['byEnd',end]]){
   const b=bins[key][bucket(time)];b.requests++;if(outcome===2){b.errors++;count(b.failures,transport);count(b.byOperation,operation);}
  }
 }
 for(const key of ['requests','ok','errors'])if(counters[key]!==reader[key])issues.push('TIMELINE_'+key.toUpperCase()+'_MISMATCH');
 for(const key of ['statuses','failures','httpErrorCodes'])if(!equalCounts(counters[key],reader[key]??{}))issues.push('TIMELINE_'+key.toUpperCase()+'_MISMATCH');
 for(const operation of new Set([...Object.keys(reader.byOperation??{}),...Object.keys(counters.byOperation)])){
  const a=counters.byOperation[operation],b=reader.byOperation?.[operation];
  if(!a||!b||a.ok!==b.ok||a.errors!==b.errors||!equalCounts(a.failures,b.failures??{})||!equalCounts(a.httpErrorCodes,b.httpErrorCodes??{}))issues.push('TIMELINE_OPERATION_MISMATCH_'+operation);
 }
 const allAttemptLatencyMs={p50:percentile(durations,.5),p95:percentile(durations,.95),p99:percentile(durations,.99),max:durations.length?Math.max(...durations):null};
 for(const key of Object.keys(allAttemptLatencyMs)){
  const a=allAttemptLatencyMs[key],b=reader.allAttemptLatencyMs?.[key];if(a===null?b!==null:!Number.isFinite(b)||Math.abs(a-b)>0.000001)issues.push('TIMELINE_DURATION_MISMATCH_'+key);
 }
 return {pass:issues.length===0,issues:[...new Set(issues)],counters,allAttemptLatencyMs,bins,notes:['Start and end windows are separate. A late timeout does not establish when its request began.','Timing establishes temporal distribution only, not proof that registrations, SQL or CPU caused an individual failure.','Capture completeness PASS does not change original zero-error/three-second workload acceptance.']};
}
