/** Local administrator CLI, protected by host filesystem/OS account permissions.
 * No HTTP listener, production credentials, market registry or clock override.
 * Usage: node scripts/isolated-scenario-admin.cjs history|preview|append JOURNAL SOURCE_JSON [PROPOSAL_JSON EXPECTED_REVISION REASON]
 */
const fs=require('node:fs'),os=require('node:os'),ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,filename);
const {IsolatedScenarioJournal,scenarioSourceFingerprint}=require('../src/services/listings/isolatedScenarioJournal.ts');
(async()=>{
  const [action,file,sourceFile,proposalFile,revision,reason]=process.argv.slice(2);
  if(!['history','preview','append'].includes(action)||!file||!sourceFile)throw Error('USAGE: history|preview|append JOURNAL SOURCE_JSON [PROPOSAL_JSON EXPECTED_REVISION REASON]');
  const source=JSON.parse(fs.readFileSync(sourceFile,'utf8'));
  const journal=new IsolatedScenarioJournal(file,source.config??source);
  if(action==='history'){console.log(JSON.stringify(await journal.history(),null,2));return;}
  const proposal=JSON.parse(fs.readFileSync(proposalFile,'utf8'));
  if(proposal.scope!=='ISOLATED_MODEL_ONLY')throw Error('ISOLATED_PROPOSAL_REQUIRED');
  const retired=require('../config/isolated/qvtr-candidate-20261031.json');
  if(retired.superseded&&proposal.candidateId===retired.candidateId)throw Error('SUPERSEDED_CANDIDATE');
  if(proposal.sourceConfigSha256!==scenarioSourceFingerprint(source.config??source))throw Error('CANDIDATE_SOURCE_MISMATCH');
  if(proposal.expectedSource && ['listingId','activeVersion','draftRevision'].some(k=>proposal.expectedSource[k]!==source[k]))throw Error('CANDIDATE_SOURCE_VERSION_MISMATCH');
  if(action==='append')console.log(JSON.stringify(await journal.append({id:os.userInfo().username,role:'ADMIN'},Number(revision),proposal.effectiveAt,proposal.program,reason||''),null,2));
  else console.log(JSON.stringify(await journal.preview(proposal.effectiveAt+48*3600000,proposal.effectiveAt,'5m',proposal)));
})().catch(e=>{console.error(e.message);process.exitCode=1});
