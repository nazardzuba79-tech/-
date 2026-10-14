import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowSourceInput,compiledArtifactMetadata } from './workflow-source.mjs';
const sha='a'.repeat(40),repo={full_name:'nazardzuba79-tech/-'};
function context(){return {eventName:'pull_request',repo:{owner:'nazardzuba79-tech',repo:'-'},runId:123,runAttempt:1,
  payload:{action:'synchronize',before:'b'.repeat(40),after:sha,pull_request:{number:512,head:{repo,ref:'dot/stocks-owner-usdt-portfolio-20261013',sha},base:{repo}}}};}
function github(runs=[{id:123,head_sha:sha,event:'pull_request',path:'.github/workflows/stocks-review.yml',repository:repo}]){
  return {rest:{actions:{listWorkflowRuns:async()=>({data:{total_count:runs.length,workflow_runs:runs}}),
    listWorkflowRunArtifacts:async()=>({data:{total_count:1,artifacts:[{id:44,name:'stocks-local-stage-'+sha,expired:false,
      digest:'sha256:'+'c'.repeat(64),size_in_bytes:4096,workflow_run:{id:123,head_sha:sha}}]}})}}};
}
test('read-only metadata produces complete exact-head history and compiled receipt metadata',async()=>{
  const input=await workflowSourceInput({context:context(),github:github(),approvedPolicySha256:'d'.repeat(64)});
  assert.deepEqual(input.history.runIds,['123']);assert.equal(input.history.complete,true);
  const a=await compiledArtifactMetadata({context:context(),github:github(),sourceSha:sha});assert.equal(a.artifactId,'44');assert.equal(a.bytes,4096);
});
test('wrong scope or rerun is rejected before API access',async()=>{
  let calls=0;const api=github();api.rest.actions.listWorkflowRuns=async()=>{calls++;throw Error('unexpected');};
  const c=context();c.runAttempt=2;await assert.rejects(workflowSourceInput({context:c,github:api,approvedPolicySha256:'d'.repeat(64)}));assert.equal(calls,0);
});
test('duplicate or truncated history cannot claim complete',async()=>{
  const api=github();api.rest.actions.listWorkflowRuns=async()=>({data:{total_count:2,workflow_runs:[]}});
  await assert.rejects(workflowSourceInput({context:context(),github:api,approvedPolicySha256:'d'.repeat(64)}),/TRACE_HISTORY_TRUNCATED/);
});
test('wrong-head artifact fails instead of downloading',async()=>{
  const api=github();const original=api.rest.actions.listWorkflowRunArtifacts;api.rest.actions.listWorkflowRunArtifacts=async()=>{
    const r=await original();r.data.artifacts[0].workflow_run.head_sha='b'.repeat(40);return r;};
  await assert.rejects(compiledArtifactMetadata({context:context(),github:api,sourceSha:sha}));
});
