'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const installation=require('./installation.cjs');
const {launchStocksBrowser}=require('../qa-stocks-browser-launch.cjs');
function beginLaunch(report){report.launchAttempted=true;report.browserLaunched='UNCONFIRMED';report.cleanup.status='UNCONFIRMED';}
function failureEvidence(report,error){report.status='FAIL';report.failure={message:error.message,code:error.code||null,stack:error.stack};if(error.chromePreflight)report.chromePreflight=error.chromePreflight;const errors=[];for(const key of ['browserCleanup','serverCleanup','scratchCleanup'])if(error[key])errors.push({stage:key,message:error[key]});if(errors.length)report.cleanup={status:'FAIL',errors};}
async function main(output){
  assert.equal(process.platform,'linux');assert.ok(process.getuid()>0&&process.getuid()===process.geteuid());
  assert.ok(path.isAbsolute(output)&&!fs.existsSync(output),'fresh absolute qualification evidence directory required');
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  const report={schema:1,status:'NOT_RUN',sourceSha:process.env.QA_SOURCE_SHA,startedAt:new Date().toISOString(),launchAttempted:false,browserLaunched:false,hostPolicyChanged:false,cleanup:{status:'NOT_CREATED'}};let browser;
  try{
    const proof=installation.verifyInstallation();
    // Never import a host/tmp Playwright module before the immutable payload proof.
    const {chromium}=require(installation.manifest.prefix+'/playwright/node_modules/playwright');
    beginLaunch(report);browser=await launchStocksBrowser(chromium);report.browserLaunched=true;report.cleanup.status='PENDING';
    assert.ok(browser.stocksBrowserProof?.sandbox,'actual renderer sandbox proof required');
    report.browser=browser.stocksBrowserProof;report.provisioning={sourceSha:proof.sourceSha,package:proof.package,playwrightVersion:proof.playwrightVersion};report.status='PASS';
  }catch(error){failureEvidence(report,error);}
  finally{if(browser){try{await browser.close();report.cleanup.status='PASS';}catch(error){report.cleanup={status:'FAIL',message:error.message};report.status='FAIL';}}report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'qualification.json'),JSON.stringify(report,null,2)+'\n');}
  if(report.status!=='PASS')throw Error('native browser qualification FAIL; see qualification.json');return report;
}
if(require.main===module){assert.equal(process.argv.length,4);assert.equal(process.argv[2],'--output');main(path.resolve(process.argv[3])).then(report=>console.log(JSON.stringify({status:report.status,sourceSha:report.sourceSha,cleanup:report.cleanup}))).catch(error=>{console.error(error.stack);process.exitCode=1;});}
module.exports={main,beginLaunch,failureEvidence};
