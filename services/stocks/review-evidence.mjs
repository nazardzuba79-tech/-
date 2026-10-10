// Artifact documentation only: never alters workload, results or acceptance.
import { readFileSync,writeFileSync,existsSync,readdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
const dir=resolve(process.argv[2]),scope=process.argv[3]||'performance';
const event=process.env.GITHUB_EVENT_PATH&&existsSync(process.env.GITHUB_EVENT_PATH)?JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')):{};
const run=process.env.GITHUB_RUN_ID,repo=process.env.GITHUB_REPOSITORY,base=process.env.STOCK_COMPARISON_BASE_SHA||'f81f404269bfe4b93c19443ce7fc8b881756a366';
let s=`# Issue505 — ${scope} raw evidence\n\nPR head: ${event.pull_request?.head?.sha||'local-uncommitted'}\n\nChecked-out tree/merge: ${process.env.GITHUB_SHA||'local'}\n\nBefore baseline: ${base}\n\nWorkflow job key: ${process.env.GITHUB_JOB||'local'}\n\nWorkflow: ${run&&repo?`https://github.com/${repo}/actions/runs/${run}`:'local diagnostic only'}\n\n`;
s+='The workflow collects evidence. Green execution does not turn a failed capacity criterion into PASS. Original deadlines, workload sizes, three repetitions and financial safety gates are unchanged. Synthetic provider data and disposable accounts only; no external market/order calls.\n\n';
s+='Account comparison uses the same corrected native fixture in both images: requested limit is honored and native end is inclusive. Public adapters retain limit300 then strict-before filtering. This corrects the old mock protocol, not the reader workload. New paired results must not be directly substituted into older mock runs. Provider history starts and quote-function invocations are separate fixture counters.\n\n';
const file=join(dir,'realistic','results.json');
if(existsSync(file)){
  const data=JSON.parse(readFileSync(file,'utf8')),groups=new Map();
  for(const r of data.results){const key=[r.variant,r.allocationVcpu,r.reader.users,r.reader.pattern].join('/');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  const median=xs=>{const v=xs.filter(Number.isFinite).sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:null;};
  const fixed=(v,n=2)=>Number.isFinite(v)?v.toFixed(n):'unavailable';
  s+=`## Account workload\n\nI/O mode: ${data.ioMode}. Original CPU0.05vCPU; supplemental0.10/0.20vCPU trials, when present, remain separate table groups. RAM256MiB; 20instruments;5/20/50users;3×30s; deadline3s. Bounded I/O remains1MiB/s read,128KiB/s write; the no-artificial-I/O-cap trial is separate and is not production proof.\n\n`;
  s+='CPU is whole-process time-weighted usage; RSS is maximum sampled peak. Latencies are medians of per-run successful-request percentiles. All attempts/errors remain in raw JSON; timeouts are censored at3s and never counted successful.\n\n';
  s+='| Before/after / allocated vCPU / users / pattern | PASS repeats | Measured CPU vCPU | RSS MiB | Success p50/p95/p99 ms | All-attempt p50/p95/p99 ms | Deadlines / RATE_LIMIT / ACCOUNT_BUSY | SQL calls | History / quote fixture calls |\n|---|---:|---:|---:|---|---|---|---:|---|\n';
  for(const [key,rs]of groups){const sum=fn=>rs.reduce((a,r)=>a+(fn(r)||0),0),pct=name=>['p50','p95','p99'].map(p=>fixed(median(rs.map(r=>r.reader[name]?.[p])))).join('/');const code=x=>sum(r=>r.reader.httpErrorCodes?.[x]);s+=`| ${key} | ${rs.filter(r=>r.acceptance.pass).length}/${rs.length} | ${fixed(sum(r=>r.server.cpuMs)/sum(r=>r.server.elapsedMs),5)} | ${fixed(Math.max(...rs.map(r=>r.server.maxRssBytes))/1048576)} | ${pct('latencyMs')} | ${pct('allAttemptLatencyMs')} | ${sum(r=>r.reader.failures?.TimeoutError)}/${code('HTTP_422:RATE_LIMIT')}/${code('HTTP_503:ACCOUNT_BUSY')} | ${sum(r=>r.server.sqlCalls)} | ${sum(r=>r.server.fixtureProviderHistoryCalls)}/${sum(r=>r.server.fixtureQuoteCalls)} |\n`;}
  s+='\n## Complete error and SQL breakdown\n\nAll error codes are retained below. SQL wall includes queue-independent journal/device waits; SQL thread CPU is distinct. Fsync syscall wall/CPU and full queue samples remain in the linked raw diagnostic files.\n\n';
  for(const [key,rs]of groups){
    const sum=name=>rs.reduce((n,r)=>n+(r.server[name]||0),0),merge=field=>{const all={};for(const r of rs)for(const [code,n]of Object.entries(r.reader[field]||{}))all[code]=(all[code]||0)+n;return all;};
    const rows=rs.map(r=>({queue:r.server.accountQueue,queueDelta:r.server.accountQueueDelta,metricAgeMs:r.server.accountMetricsAgeMs,observations:r.server.observationMetrics}));
    s+=`### ${key}\n\n\`\`\`json\n${JSON.stringify({httpErrorCodes:merge('httpErrorCodes'),failures:merge('failures'),sqlCalls:sum('sqlCalls'),sqlWrites:sum('sqlWriteCalls'),sqlExec:sum('sqlExecCalls'),sqlWallMs:sum('sqlWallMs'),sqlThreadCpuMs:sum('sqlCpuMs'),sqlThreadCpuAvailable:rs.every(r=>r.server.sqlThreadCpuAvailable),perRun:rows},null,2)}\n\`\`\`\n\n`;
  }
}
s+='\n## Interpretation boundaries\n\nSQLite FULL/DELETE, atomic transactions and durable financial acknowledgements remain required. New quote-only read projections are volatile; active-order observations and execution evidence remain durable. Loss of volatile authority has a documented conservative epoch barrier. No larger queues/TTL/provider budgets are used.\n\nOriginal strict read and crypto benchmarks remain separate from authenticated account scenarios. Crypto normal50/100 p95 has the documented+5% gate. CPU affinity is not a production capacity guarantee. Raw errors and all repetitions must be reviewed, including failed groups. MOEX/SBER and commercial redistribution rights remain NOT CLEARED.\n\n## Files\n\n';
for(const name of readdirSync(dir).filter(n=>n!=='README.md'))s+=`- [${name}](${name})\n`;
writeFileSync(join(dir,'README.md'),s);console.log(`Evidence README written: ${scope}; inspect raw acceptance, not job colour.`);
