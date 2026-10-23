'use strict';
// No SSH, Docker, installation or privilege changes. Uses an existing Node/PG.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{cleanEnv}=require('./policy.cjs');
if(process.platform!=='linux'){console.error('ISOLATED_LINUX_ONLY_NO_PROCESS_STARTED');process.exit(64);}
if(['DATABASE_URL','DIRECT_URL','SHADOW_DATABASE_URL','NODE_OPTIONS'].some(k=>process.env[k])){console.error('AMBIENT_CONFIGURATION_DENIED');process.exit(64);}
const [root,pgBin,out,attestation,...extra]=process.argv.slice(2);
if(!root||!pgBin||!out||!attestation||extra.length||!fs.existsSync(attestation)||fs.existsSync(out)){console.error('EXPLICIT_EXISTING_ISOLATION_ATTESTATION_AND_FRESH_PATHS_REQUIRED');process.exit(64);}
const child=cp.spawn(process.execPath,['--max-old-space-size=256',path.join(__dirname,'run.cjs'),'--root',root,'--pg-bin',pgBin,'--out',out,'--scope','isolated-linux','--ack','SYNTHETIC_LOCAL_ONLY','--attestation',attestation,'--run-local'],{stdio:'inherit',env:cleanEnv()});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
