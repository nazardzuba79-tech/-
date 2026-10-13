import { readFileSync,writeFileSync,readdirSync,mkdirSync,cpSync,existsSync } from 'node:fs';
import { resolve,relative,sep,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex'),canonical=bytes=>bytes.toString('utf8').replace(/\r\n/g,'\n');
const roots=['services/stocks','services/stocks-global','services/stocks-simulator'];
const inventory=root=>{const files=[];const visit=folder=>{for(const entry of readdirSync(resolve(root,folder),{withFileTypes:true})){const file=folder+'/'+entry.name;if(entry.isDirectory())visit(file);else if(entry.isFile())files.push(file);else throw Error('REGISTRATION_SPECIAL_SOURCE_FILE');}};for(const folder of roots)visit(folder);return files.sort();};
const outside=(source,out)=>{const rel=relative(resolve(source),resolve(out));if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'))throw Error('REGISTRATION_OUTPUT_MUST_BE_OUTSIDE_INPUT');};
export function prepareCandidate(baseline,candidateTree,out,candidateRevision){
 if(!/^[a-f0-9]{40}$/.test(candidateRevision??''))throw Error('REGISTRATION_EXACT_CANDIDATE_REVISION_REQUIRED');
 baseline=resolve(baseline);candidateTree=resolve(candidateTree);out=resolve(out);outside(baseline,out);outside(candidateTree,out);
 if(existsSync(out)&&readdirSync(out).length)throw Error('REGISTRATION_OUTPUT_NOT_EMPTY');
 const expected=JSON.parse(readFileSync(resolve(here,'sources.json'),'utf8')),reviewed=JSON.parse(readFileSync(resolve(here,'registration-sources.json'),'utf8'));
 if(reviewed.baselineRevision!==expected.revision||reviewed.candidateFile!=='services/stocks-global/account-worker.mjs')throw Error('REGISTRATION_MANIFEST_INVALID');
 const baseFiles=inventory(baseline),wanted=Object.keys(expected.files).sort();if(JSON.stringify(baseFiles)!==JSON.stringify(wanted))throw Error('REGISTRATION_BASELINE_FILESET_MISMATCH');
 for(const file of wanted)if(hash(canonical(readFileSync(resolve(baseline,file))))!==expected.files[file])throw Error('REGISTRATION_BASELINE_CHANGED '+file);
 const candidateFiles=inventory(candidateTree),allowed=new Set(reviewed.allowedNonRuntimeChanges),seen=new Set(candidateFiles),changes=[],excluded=[];
 for(const file of wanted)if(!seen.has(file))throw Error('REGISTRATION_CANDIDATE_FILE_MISSING '+file);
 for(const file of candidateFiles){
  const bytes=readFileSync(resolve(candidateTree,file)),digest=hash(canonical(bytes));
  if(file===reviewed.candidateFile){if(digest!==reviewed.candidateCanonicalSha256||digest===expected.files[file])throw Error('REGISTRATION_UNREVIEWED_CANDIDATE_HASH');changes.push({file,baselineSha256:expected.files[file],candidateSha256:digest});continue;}
  if(expected.files[file]===digest)continue;
  if(!allowed.has(file))throw Error('REGISTRATION_OTHER_RUNTIME_CHANGE '+file);
  excluded.push({file,canonicalSha256:digest,reason:'Explicit non-runtime test/diagnostic file; not copied into either service image.'});
 }
 if(changes.length!==1)throw Error('REGISTRATION_EXPECTED_ONE_RUNTIME_CHANGE');
 mkdirSync(out,{recursive:true});for(const folder of roots)cpSync(resolve(baseline,folder),resolve(out,folder),{recursive:true});
 writeFileSync(resolve(out,reviewed.candidateFile),canonical(readFileSync(resolve(candidateTree,reviewed.candidateFile))));
 const serviceFiles=inventory(out).map(file=>({file,sha256:hash(canonical(readFileSync(resolve(out,file))))}));
 if(serviceFiles.length!==wanted.length||serviceFiles.some(({file,sha256})=>sha256!==(file===reviewed.candidateFile?reviewed.candidateCanonicalSha256:expected.files[file])))throw Error('REGISTRATION_BUILT_SOURCE_MISMATCH');
 return{baselineRevision:expected.revision,candidateRevision,reviewedManifestSha256:hash(readFileSync(resolve(here,'registration-sources.json'))),runtimeChanges:changes,excludedNonRuntimeChanges:excluded,serviceFiles,notes:['Full candidate service directories were inspected. Any change outside the single runtime file or exact non-runtime allowlist is rejected.','Both service images contain the baseline92files; candidate changes only the reviewed account-worker.mjs. Diagnostic/test additions and changed summarize-launch.cjs are excluded from service images.']};
}
