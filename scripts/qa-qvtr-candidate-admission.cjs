/** Exercise the real-clock local administrator CLI. No network or production access. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const plan=require('../config/isolated/qvtr-candidate-20261031.json');
const out=path.resolve(process.env.QVTR_PREVIEW_OUT||path.join('artifacts/qvtr-isolated',plan.candidateId));
const source=path.resolve('config/isolated',plan.sourceSnapshot),proposal=path.join(out,'proposal.json');
const candidate=JSON.parse(fs.readFileSync(proposal,'utf8'));
if(candidate.effectiveAt<Date.now()+60000)throw Error('CANDIDATE_EXPIRED_REBUILD_FUTURE_BOUNDARY');
const dir=fs.mkdtempSync(path.join(out,'admission-')),journal=path.join(dir,'journal.jsonl');
function run(action,p=proposal,expectedError){
  const r=cp.spawnSync(process.execPath,['scripts/isolated-scenario-admin.cjs',action,journal,source,p,'0','QA only, isolated future revision'],{encoding:'utf8',timeout:30000,maxBuffer:10*1024*1024});
  if(expectedError){if(r.status!==1||!r.stderr.includes(expectedError))throw Error('EXPECTED_'+expectedError+': '+r.stderr);return;}
  if(r.status!==0)throw Error(r.stderr||String(r.error));return JSON.parse(r.stdout);
}
run('preview');if(fs.existsSync(journal))throw Error('PREVIEW_WROTE_JOURNAL');
for(const [name,mutate,error] of [
  ['source',x=>x.sourceConfigSha256='0'.repeat(64),'CANDIDATE_SOURCE_MISMATCH'],
  ['version',x=>x.expectedSource.activeVersion=999,'CANDIDATE_SOURCE_VERSION_MISMATCH'],
  ['expired',x=>x.effectiveAt=Math.floor((Date.now()-300000)/300000)*300000,'FUTURE_BOUNDARY_REQUIRED'],
]){const bad=JSON.parse(JSON.stringify(candidate));mutate(bad);const file=path.join(dir,name+'.json');fs.writeFileSync(file,JSON.stringify(bad));run('append',file,error);if(fs.existsSync(journal))throw Error('REJECTION_WROTE_JOURNAL');}
const saved=run('append');if(saved.revision!==1||saved.effectiveAt!==candidate.effectiveAt||!saved.author||saved.createdAt>=saved.effectiveAt)throw Error('BAD_SAVED_REVISION');
const bytes=fs.readFileSync(journal);run('append',proposal,'REVISION_CONFLICT');if(!bytes.equals(fs.readFileSync(journal)))throw Error('DUPLICATE_CHANGED_JOURNAL');
const history=run('history');if(history.length!==1||history[0].hash!==saved.hash)throw Error('RESTART_REPLAY_MISMATCH');
const report={pass:7,effectiveAt:new Date(candidate.effectiveAt).toISOString(),sourceConfigSha256:candidate.sourceConfigSha256,previewWrites:0,rejectedWrongSource:true,rejectedWrongVersion:true,rejectedExpired:true,savedRevision:1,idempotentDuplicateRejected:true,reloaded:true,scope:'ISOLATED_MODEL_ONLY'};
fs.writeFileSync(path.join(out,'admission-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
