'use strict';
// Real CLI + loopback-only synthetic HTTP store. No production, DB or accounts.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('node:http'),{execFile}=require('node:child_process');
const {readFileSync}=require('node:fs'),path=require('node:path');
const FILE=JSON.parse(readFileSync(path.join(__dirname,'../config/test-markets/eclv-20261103.draft.json'),'utf8'));
const clone=x=>structuredClone(x);
const old=()=>{const d=clone(FILE);d.listingAt='2026-11-03T13:00:00Z';d.simulationProgram.maxPrice='0.518';d.simulationProgram.stages.at(-1).targetPrice='0.435';return d;};
const row=()=>({id:'eclv-existing',symbol:'ECLV',draft:{...old(),simulationProfile:'PULLBACK_TREND',wickModel:'NATURAL_V1'},draftRevision:4,activeVersion:null,active:null,countdown:null,versions:[]});
const TOKEN='synthetic-admin-session-never-a-real-token';
async function fixture(records,options={},check){
  const calls=[];let state=clone(records),lost=!!options.loseResponse;
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    calls.push({method:req.method,path:req.url,ifMatch:req.headers['if-match']});
    if(req.headers.authorization!=='Bearer '+TOKEN){res.writeHead(401);return res.end('{}');}
    const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
    if(req.method==='GET'&&req.url==='/api/v1/admin/listings')return send(200,{serverTime:Date.parse('2026-10-27T12:00:00Z'),listings:state});
    if(req.method==='PUT'&&req.url==='/api/v1/admin/listings/eclv-existing/draft'){
      const current=state.find(r=>r.id==='eclv-existing');
      if(options.conflict||req.headers['if-match']!==String(current.draftRevision))return send(409,{error:'revision_conflict'});
      const config=JSON.parse(raw).config;
      assert.equal(config.seed,current.draft.seed);
      current.draft={schemaVersion:1,...config,simulationProfile:current.draft.simulationProfile,wickModel:current.draft.wickModel};
      if(options.corruptProfile)current.draft.simulationProfile='CALM_TREND';
      current.draftRevision++;
      if(lost){lost=false;return res.destroy();}
      return send(200,{id:current.id,draftRevision:current.draftRevision,draft:current.draft});
    }
    return send(405,{error:'synthetic fixture refuses every other write'});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const run=(args=['--update'])=>new Promise(resolve=>execFile(process.execPath,[path.join(__dirname,'eclv-draft-import.cjs'),...args],{
    timeout:10000,env:{PATH:process.env.PATH,VOLTEX_API:'http://127.0.0.1:'+server.address().port,VOLTEX_ADMIN_TOKEN:TOKEN},
  },(e,stdout,stderr)=>{
    assert.ok(!(stdout+stderr).includes(TOKEN));
    resolve({code:e?(typeof e.code==='number'?e.code:-1):0,out:stdout+stderr});
  }));
  try{await check({run,calls,get state(){return state;}});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('one CAS PUT updates the existing private id and keeps seed/profile/QVTR; repeat sends no write',async()=>{
  const qvtr={id:'qvtr-other',symbol:'QVTR',draft:{seed:'qaventra-20261028-v1'},draftRevision:7};
  await fixture([row(),qvtr],{},async f=>{
    const r=await f.run();assert.equal(r.code,0,r.out);assert.match(r.out,/UPDATED existing private draft eclv-existing/);
    const saved=f.state[0];assert.equal(saved.id,'eclv-existing');assert.equal(saved.draftRevision,5);
    assert.equal(saved.draft.listingAt,'2026-11-06T13:00:00Z');assert.equal(saved.draft.simulationProgram.stages.at(-1).targetPrice,'1.01472');
    assert.equal(saved.draft.seed,'eclavo-20261103-v1');assert.equal(saved.draft.simulationProfile,'PULLBACK_TREND');assert.equal(saved.draft.wickModel,'NATURAL_V1');
    assert.deepEqual(f.state[1],qvtr);
    assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);assert.equal(f.calls.find(c=>c.method==='PUT').ifMatch,'4');
    assert.equal((await f.run()).code,0);assert.equal(f.calls.filter(c=>c.method!=='GET').length,1);
    assert.equal(f.calls.some(c=>c.method==='POST'),false);
  });
});
test('missing or duplicate ECLV never falls back to creation',async()=>{
  for(const rows of [[],[row(),{...row(),id:'eclv-second'}]])await fixture(rows,{},async f=>{assert.equal((await f.run()).code,2);assert.ok(f.calls.every(c=>c.method==='GET'));});
});
test('every published/timer state is refused without a PUT',async()=>{
  for(const countdown of [null,{state:'staged'},{state:'running'},{state:'paused'}]){
    const r=row();r.activeVersion=1;r.active=clone(r.draft);r.countdown=countdown;r.versions=[{version:1}];
    await fixture([r],{},async f=>{assert.equal((await f.run()).code,2);assert.ok(f.calls.every(c=>c.method==='GET'));});
  }
});
test('unexpected identity/seed/phase edits are not overwritten',async()=>{
  for(const mutate of [d=>d.seed='another-existing-seed',d=>d.logo='different-logo',d=>d.initialPrice='0.0150',d=>d.tradable=true,d=>d.simulationProgram.stages[2].durationHours=97]){
    const r=row();mutate(r.draft);
    await fixture([r],{},async f=>{assert.equal((await f.run()).code,2);assert.ok(f.calls.every(c=>c.method==='GET'));});
  }
});
test('409 CAS conflict is not retried or overwritten',async()=>{
  await fixture([row()],{conflict:true},async f=>{assert.equal((await f.run()).code,2);assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);assert.equal(f.state[0].draftRevision,4);});
});
test('a lost response after commit is resolved by a read-only repeat, never a second PUT',async()=>{
  await fixture([row()],{loseResponse:true},async f=>{
    assert.equal((await f.run()).code,1);assert.equal(f.state[0].draftRevision,5);
    assert.equal((await f.run()).code,0);assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
  });
});
test('server profile mismatch is surfaced rather than silently accepted',async()=>{
  await fixture([row()],{corruptProfile:true},async f=>{assert.equal((await f.run()).code,3);assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);});
});
test('create and update cannot be combined',async()=>{
  await fixture([row()],{},async f=>{assert.equal((await f.run(['--create','--update'])).code,1);assert.equal(f.calls.length,0);});
});

test('an already moved November6 private Draft completes only the approved cap/recovery update',async()=>{
  const r=row();r.draft.listingAt=FILE.listingAt;
  await fixture([r],{},async f=>{
    const result=await f.run();assert.equal(result.code,0,result.out);
    assert.equal(f.state[0].id,r.id);assert.equal(f.state[0].draftRevision,5);
    assert.equal(f.state[0].draft.listingAt,FILE.listingAt);assert.equal(f.state[0].draft.logo,r.draft.logo);
    assert.equal(f.state[0].draft.simulationProgram.maxPrice,'1.01472');
    assert.equal(f.state[0].draft.simulationProgram.stages.at(-1).targetPrice,'1.01472');
    assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);assert.equal(f.calls.some(c=>c.method==='POST'),false);
  });
});
