// Summarize an actual V8 CPU profile; raw samples remain in the artifact.
import { readFileSync } from 'node:fs';
const profile=JSON.parse(readFileSync(process.argv[2],'utf8'));
const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();
for(const node of nodes.values())for(const child of node.children??[])parents.set(child,node.id);
const totals=new Map(),categories=new Map();let totalUs=0;
const group=stack=>{
  const leaf=stack[0];if(leaf?.functionName==='(idle)')return 'idle';if(leaf?.functionName==='(garbage collector)')return 'garbageCollection';
  if(stack.some(f=>/node:sqlite/.test(f.url)||/^(encodedHistory|history)$/.test(f.functionName)&&/stocks\/core\.mjs/.test(f.url)))return 'historySqlAndRows';
  if(stack.some(f=>/^(parseCandles|normalizeCandles)$/.test(f.functionName)))return 'candlePreparation';
  if(stack.some(f=>/^(encoded|JSON\.stringify)$/.test(f.functionName)))return 'serialization';
  if(stack.some(f=>/^(peek|get)$/.test(f.functionName)&&/stocks\/core\.mjs/.test(f.url)))return 'cache';
  if(stack.some(f=>/node:_http|node:net|node:stream/.test(f.url)))return 'httpAndSocket';
  if(stack.some(f=>/stocks-global\/accounts\.mjs/.test(f.url)))return 'accountStorage';
  return 'otherOrUnattributed';
};
for(let i=0;i<(profile.samples??[]).length;i++){
  const node=nodes.get(profile.samples[i]);if(!node)continue;const us=profile.timeDeltas?.[i]??0;totalUs+=us;
  const frames=[];for(let current=node;current;current=nodes.get(parents.get(current.id)))frames.push(current.callFrame);
  const f=node.callFrame,key=`${f.functionName||'(anonymous)'} @ ${f.url||'(native)'}:${f.lineNumber+1}`;
  totals.set(key,(totals.get(key)??0)+us);const category=group(frames);categories.set(category,(categories.get(category)??0)+us);
}
console.log(JSON.stringify({sampleCount:profile.samples?.length??0,elapsedMs:(profile.endTime-profile.startTime)/1000,sampledMs:totalUs/1000,categories:Object.fromEntries([...categories].map(([name,us])=>[name,{ms:us/1000,share:us/totalUs}])),topFrames:[...totals].sort((a,b)=>b[1]-a[1]).slice(0,35).map(([frame,us])=>({frame,ms:us/1000,share:us/totalUs})),notes:['Sampled wall-clock attribution includes idle and CPU throttling; use process.cpuUsage/cgroup data for CPU consumption.','Category names are stack heuristics; full profile and exact top frames are retained for diagnosis.','Microprofile synchronous boundaries give SQL/JSON/preparation stage costs separately.']}));
