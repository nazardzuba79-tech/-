'use strict';
// One-use, authenticated, encrypted CI transport. Never upload the plaintext image.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{pipeline}=require('stream/promises');
const dir=path.resolve('output/history20-container-cycle');
(async()=>{
 if(process.env.GITHUB_REPOSITORY!=='nazardzuba79-tech/-')throw Error('Wrong repository');
 const key=Buffer.from(process.env.HISTORY20_ISOLATED_IMAGE_KEY||'','hex');
 if(key.length!==32)throw Error('Missing temporary transport key');
 fs.mkdirSync(dir,{recursive:true});
 const r=await fetch('https://api.github.com/repos/nazardzuba79-tech/-/releases/assets/710571243',{headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/octet-stream'}});
 if(!r.ok)throw Error('Encrypted input HTTP '+r.status);
 const encrypted=path.join(dir,'base.aes'),plain=path.join(dir,'base.tar.gz');
 await pipeline(r.body,fs.createWriteStream(encrypted));
 const fd=fs.openSync(encrypted,'r'),size=fs.fstatSync(fd).size,iv=Buffer.alloc(12),tag=Buffer.alloc(16);
 fs.readSync(fd,iv,0,12,0);fs.readSync(fd,tag,0,16,size-16);fs.closeSync(fd);
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
 await pipeline(fs.createReadStream(encrypted,{start:12,end:size-17}),decipher,fs.createWriteStream(plain));
 const hash=crypto.createHash('sha256');for await(const b of fs.createReadStream(plain))hash.update(b);
 if(hash.digest('hex')!=='f3eb7da41a25c98f72437274a7377690876a0d0f32d62cb80d76f2ecf6970399')throw Error('Base transport integrity failure');
 fs.unlinkSync(encrypted);console.log('PINNED_ENCRYPTED_BASE_VERIFIED');
})().catch(e=>{console.error(e.message);process.exitCode=1});
