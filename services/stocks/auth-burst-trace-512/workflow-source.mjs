// Read-only GitHub metadata adapter. Does not download or execute any artifact.
import assert from 'node:assert/strict';
import { REPOSITORY, HEAD_REF, WORKFLOW_PATH } from './launch-gate.mjs';

export async function workflowSourceInput({ context, github, approvedPolicySha256 }) {
  const p=context.payload,pr=p?.pull_request;
  assert.equal(context.eventName,'pull_request');assert.equal(p.action,'synchronize');assert.equal(pr?.number,512);
  assert.equal(context.repo.owner+'/'+context.repo.repo,REPOSITORY);
  assert.equal(pr.head.repo.full_name,REPOSITORY);assert.equal(pr.base.repo.full_name,REPOSITORY);assert.equal(pr.head.ref,HEAD_REF);
  for(const value of [pr.head.sha,p.before,p.after])assert.match(value||'',/^[a-f0-9]{40}$/);
  assert.equal(p.after,pr.head.sha);assert.match(approvedPolicySha256||'',/^[a-f0-9]{64}$/);
  const runId=String(context.runId),runAttempt=Number(context.runAttempt);
  assert.match(runId,/^[1-9][0-9]{0,19}$/);assert.equal(runAttempt,1);
  const event={eventName:context.eventName,action:p.action,repository:REPOSITORY,number:512,
    headRepository:pr.head.repo.full_name,baseRepository:pr.base.repo.full_name,headRef:pr.head.ref,
    headSha:pr.head.sha,beforeSha:p.before,runId,runAttempt,workflowPath:WORKFLOW_PATH};
  const runs=[],seen=new Set();let total=null,complete=false;
  for(let page=1;page<=10;page++) {
    const response=await github.rest.actions.listWorkflowRuns({owner:context.repo.owner,repo:context.repo.repo,
      workflow_id:'stocks-review.yml',head_sha:event.headSha,per_page:100,page});
    assert.ok(response?.data&&Array.isArray(response.data.workflow_runs));
    const count=response.data.total_count;assert.ok(Number.isSafeInteger(count)&&count>=0&&count<1000,'TRACE_HISTORY_BUDGET');
    if(total===null)total=count;assert.equal(count,total,'TRACE_HISTORY_CHANGED');
    assert.ok(response.data.workflow_runs.length<=100);
    for(const run of response.data.workflow_runs) {
      const id=String(run.id);assert.match(id,/^[1-9][0-9]{0,19}$/);assert.ok(!seen.has(id),'TRACE_HISTORY_DUPLICATE');seen.add(id);
      assert.equal(run.head_sha,event.headSha);assert.equal(run.event,'pull_request');
      assert.ok(run.path===WORKFLOW_PATH||run.path?.startsWith(WORKFLOW_PATH+'@'),'TRACE_HISTORY_WORKFLOW');
      assert.equal(run.repository?.full_name,REPOSITORY);runs.push(id);
    }
    if(runs.length===total){complete=true;break;}
    assert.ok(runs.length<total&&response.data.workflow_runs.length===100,'TRACE_HISTORY_TRUNCATED');
  }
  assert.ok(complete,'TRACE_HISTORY_INCOMPLETE');
  return {event,approvedPolicySha256,history:{workflowPath:WORKFLOW_PATH,headSha:event.headSha,complete,runIds:runs}};
}

export async function compiledArtifactMetadata({context,github,sourceSha}) {
  assert.match(sourceSha,/^[a-f0-9]{40}$/);
  const name='stocks-local-stage-'+sourceSha,all=[];let total=null;
  for(let page=1;page<=10;page++) {
    const response=await github.rest.actions.listWorkflowRunArtifacts({owner:context.repo.owner,repo:context.repo.repo,
      run_id:context.runId,per_page:100,page});
    assert.ok(response?.data&&Array.isArray(response.data.artifacts));
    const count=response.data.total_count;assert.ok(Number.isSafeInteger(count)&&count>=0&&count<1000);
    if(total===null)total=count;assert.equal(count,total,'TRACE_ARTIFACT_HISTORY_CHANGED');
    all.push(...response.data.artifacts);
    if(all.length===total)break;
    assert.ok(all.length<total&&response.data.artifacts.length===100,'TRACE_ARTIFACT_HISTORY_TRUNCATED');
  }
  assert.equal(all.length,total);assert.equal(new Set(all.map(x=>x.id)).size,all.length);
  const matches=all.filter(x=>x.name===name);assert.equal(matches.length,1,'TRACE_STAGE_ARTIFACT_AMBIGUOUS');
  const a=matches[0];assert.equal(a.expired,false);assert.match(a.digest||'',/^sha256:[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(a.size_in_bytes)&&a.size_in_bytes>0&&a.size_in_bytes<=256*1024**2);
  assert.equal(String(a.workflow_run?.id),String(context.runId));assert.equal(a.workflow_run?.head_sha,sourceSha);
  return {artifactId:String(a.id),runId:String(context.runId),sourceSha,name,expired:a.expired,
    archiveSha256:a.digest.slice(7),bytes:a.size_in_bytes};
}
