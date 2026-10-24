'use strict';
// Build-time gate for the legacy root image only. No DB, Prisma or runtime imports.
const fs=require('node:fs'),path=require('node:path');
const PROTECTED=Object.freeze(['20261016000000_stocks_test_cash_authority','20261016170000_native_funding_model']);
function verify(root=process.cwd()){
  for(const name of PROTECTED)if(fs.existsSync(path.join(root,'prisma','migrations',name))){
    const error=new Error('ROOT_IMAGE_REQUIRES_ATTESTED_STOCKS_RELEASE: '+name);
    error.code='ROOT_IMAGE_REQUIRES_ATTESTED_STOCKS_RELEASE';throw error;
  }
  return {legacyImage:'no-protected-feature-migrations',databaseCommandsExecuted:false};
}
module.exports={verify,PROTECTED};
if(require.main===module){try{console.log(JSON.stringify(verify(process.argv[2])));}catch(e){console.error(e.code||'ROOT_IMAGE_GATE_FAILED');process.exitCode=1;}}
