const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {chromium}=require(process.env.QA_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const pointer=JSON.parse(fs.readFileSync('artifacts/qvtr-isolated/current-output.json','utf8')),out=pointer.out;
  const record=JSON.parse(fs.readFileSync(path.join(out,'review.json'),'utf8')),series=JSON.parse(fs.readFileSync(path.join(out,'series.json'),'utf8'));
  if(record.startAt!==record.observation.serverTime||record.candidate.anchor!==record.observation.lastPrice||record.promotionAllowed!==false)throw Error('BAD_NOW_RECORD');
  for(const [at,price] of [['2026-10-31T18:30Z',.5383],['2026-11-01T02:00Z',.5383],['2026-11-01T18:30Z',.32298]])if(series['1m'].find(c=>c.openTime===Date.parse(at))?.open!==price)throw Error('TARGET_MISMATCH');
  const before=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,'series.json'))).digest('hex');
  const replay=cp.spawnSync(process.execPath,['scripts/qvtr-now-review.cjs','replay'],{encoding:'utf8',timeout:60000});if(replay.status)throw Error(replay.stderr);
  if(crypto.createHash('sha256').update(fs.readFileSync(path.join(out,'series.json'))).digest('hex')!==before)throw Error('REPLAY_CHANGED_SERIES');
  const current=JSON.parse(fs.readFileSync('config/isolated/qvtr-review-current.json','utf8'));
  const rejected=cp.spawnSync(process.execPath,['scripts/isolated-scenario-admin.cjs','append',path.join(out,'never-promote.jsonl'),'config/isolated/qvtr-source-20261031-refresh.json',path.join('config/isolated',current.record),'0','must reject'],{encoding:'utf8'});
  if(rejected.status!==1||!rejected.stderr.includes('ISOLATED_PROPOSAL_REQUIRED')||fs.existsSync(path.join(out,'never-promote.jsonl')))throw Error('PROMOTION_NOT_REJECTED');
  const browser=await chromium.launch({headless:true}),checks=[];
  try{for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith('file:')?r.continue():(external.push(r.request().url()),r.abort()));
    await page.goto('file:///'+path.join(out,'index.html').replace(/\\/g,'/'));
    for(const interval of ['1m','5m','15m','1h']){await page.locator(`[data-interval="${interval}"]`).click();
      if(!await page.evaluate(({count,t0})=>document.querySelectorAll('svg rect').length===count&&document.body.scrollWidth<=innerWidth&&document.body.innerText.includes(t0)&&document.body.innerText.includes('ІЗОЛЬОВАНА МОДЕЛЬ'),{count:series[interval].length,t0:new Date(record.startAt).toISOString()}))throw Error('LAYOUT_OR_TIMING');checks.push({width,interval,pass:true});}
    await page.locator('[data-interval="5m"]').click();await page.screenshot({path:path.join(out,`preview-${width}.png`),fullPage:true});await page.reload();
    if(!await page.locator('body').innerText().then(t=>t.includes(new Date(record.startAt).toISOString())))throw Error('T0_CHANGED_ON_RELOAD');
    if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));await page.close();
  }}finally{await browser.close();}
  const report={startAt:new Date(record.startAt).toISOString(),sourceObservedAt:new Date(record.observation.serverTime).toISOString(),anchor:record.observation.lastPrice,checks,promotionRejected:true,seriesReplayIdentical:true,externalRequests:0,pageErrors:0};
  fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:checks.length,startAt:report.startAt,anchor:report.anchor,promotionRejected:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
