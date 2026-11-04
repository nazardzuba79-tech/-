'use strict';
// Read-only gate. It neither copies files nor connects to a service/database.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const value=k=>{const i=process.argv.indexOf(k);if(i<0||!process.argv[i+1])throw Error('Required '+k);return process.argv[i+1];};
try{
 const m=JSON.parse(fs.readFileSync(value('--manifest'))),root=path.resolve(value('--dist'));
 if(value('--image')!==m.installedImage)throw Error('API image drift');
 if(hash(fs.readFileSync(value('--worker')))!==m.installedWorkerSha256)throw Error('Worker code drift');
 const mismatches=[];
 for(const [p,expected]of Object.entries(m.before)){
  if(!p.startsWith('api/')||p.split('/').includes('..'))throw Error('Invalid manifest path');
  const file=path.join(root,p.slice(4)),actual=fs.existsSync(file)?hash(fs.readFileSync(file)):null;
  if(actual!==expected)mismatches.push(p);
 }
 if(mismatches.length)throw Error('Installed module drift: '+mismatches.join(', '));
 console.log(JSON.stringify({gate:'PINNED_BASE_PASS',modules:Object.keys(m.before).length,readOnly:true,activationAuthorized:false}));
}catch(e){console.error(e.message);process.exitCode=1;}
