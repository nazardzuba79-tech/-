const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {disposableUrl,fixture}=require('./testing/disposable-postgres.cjs');
const available=!!disposableUrl();
function pg(name,fn){test('real PostgreSQL: '+name,{timeout:30000,skip:available?false:'NOT_RUN: no confirmed disposable local PostgreSQL URL; SQLite/mock is not acceptance'},fn);}

// The Stocks routes read session, owner and contact block in one query
// (requireAuth singleSessionRead). Every case must answer exactly as the
// original per-request checks on /api/v1/me answer for the same token.
async function setup(t){
  const f=await fixture(t,{wallClock:true}),jwt=require('jsonwebtoken');
  const {contactEmailHash}=require('../../src/services/ContactEmailPolicy.ts');
  const suffix=crypto.randomBytes(6).toString('hex');let at=Date.now()-60_000;
  const user=async(name,{email=name+'-'+suffix+'@example.invalid',role='USER'}={})=>{
    const id='session-read-'+name+'-'+suffix;
    await f.db.user.create({data:{id,email,passwordHash:'synthetic-no-password-login',referralCode:crypto.randomBytes(10).toString('hex'),role}});
    return{id,email};
  };
  const session=async(u,data={})=>{
    const s=await f.db.session.create({data:{userId:u.id,...data}});
    return{id:s.id,token:jwt.sign({sub:u.id,sid:s.id},process.env.JWT_SECRET,{expiresIn:'1h'})};
  };
  const contact=async(email,action)=>{at+=1000;await f.db.auditLog.create({data:{action,metadata:{emailHash:contactEmailHash(email),email},createdAt:new Date(at)}});};
  const status=async(path,token)=>(await fetch(f.apiOrigin+path,{headers:{authorization:'Bearer '+token}})).status;
  const both=async token=>({stocks:await status('/api/v1/stocks-test-cash/identity',token),original:await status('/api/v1/me',token)});
  const same=async(token,expected,label)=>{const r=await both(token);assert.deepEqual(r,{stocks:expected,original:expected},label);};
  return{f,jwt,user,session,contact,same};
}

pg('active, revoked, foreign and unknown sessions match the original checks on every request',async t=>{
  const s=await setup(t),alice=await s.user('alice'),bob=await s.user('bob'),a=await s.session(alice);
  await s.same(a.token,200,'active');
  await s.f.db.session.update({where:{id:a.id},data:{revokedAt:new Date()}});
  await s.same(a.token,401,'revoked on the very next request');
  const foreign=s.jwt.sign({sub:bob.id,sid:(await s.session(alice)).id},process.env.JWT_SECRET,{expiresIn:'1h'});
  await s.same(foreign,401,'session of another user');
  await s.same(s.jwt.sign({sub:alice.id,sid:crypto.randomUUID()},process.env.JWT_SECRET,{expiresIn:'1h'}),401,'unknown session');
});

pg('contact block and unblock follow the latest event, including addresses outside SQL normalization',async t=>{
  const s=await setup(t);
  for(const [name,email] of [['plain'],['mixed',' Mixed.Case-'+crypto.randomBytes(4).toString('hex')+'@Example.INVALID '],['tab','\tTab-'+crypto.randomBytes(4).toString('hex')+'@example.invalid'],['unicode','Ünïcode-'+crypto.randomBytes(4).toString('hex')+'@Example.invalid']]){
    const u=await s.user(name,email?{email}:{}),x=await s.session(u);
    await s.same(x.token,200,name+' before any event');
    await s.contact(u.email,'CONTACT_EMAIL_BLOCKED');
    await s.same(x.token,403,name+' blocked');
    await s.contact(u.email,'CONTACT_EMAIL_UNBLOCKED');
    await s.same(x.token,200,name+' unblocked');
    await s.contact(u.email,'CONTACT_EMAIL_BLOCKED');
    await s.same(x.token,403,name+' blocked again');
  }
});

pg('remembered sessions keep the admin-only and idle limits',async t=>{
  const s=await setup(t),old=new Date(Date.now()-13*3600_000),idle=new Date(Date.now()-31*24*3600_000);
  const userOld=await s.session(await s.user('remembered-user'),{remembered:true,createdAt:old});
  await s.same(userOld.token,401,'remembered non-admin older than 12h');
  const admin=await s.user('remembered-admin',{role:'ADMIN'});
  await s.same((await s.session(admin,{remembered:true,createdAt:old})).token,200,'remembered admin');
  await s.same((await s.session(admin,{remembered:true,createdAt:old,lastSeenAt:idle})).token,401,'remembered admin idle over 30 days');
  await s.same((await s.session(await s.user('fresh-remembered'),{remembered:true})).token,200,'remembered non-admin within 12h');
});

pg('a stale last-seen time is still refreshed after the combined read',async t=>{
  const s=await setup(t),before=new Date(Date.now()-10*60_000),x=await s.session(await s.user('touch'),{lastSeenAt:before});
  assert.equal((await fetch(s.f.apiOrigin+'/api/v1/stocks-test-cash/identity',{headers:{authorization:'Bearer '+x.token}})).status,200);
  const end=Date.now()+5000;let seen;
  while(Date.now()<end){seen=(await s.f.db.session.findUnique({where:{id:x.id}})).lastSeenAt;if(seen>before)break;await new Promise(r=>setTimeout(r,20));}
  assert.ok(seen>before,'lastSeenAt refreshed');
});

pg('an identity batch reads its sessions together and answers every bearer exactly as it would alone',async t=>{
  const s=await setup(t),old=new Date(Date.now()-13*3600_000);
  const alice=await s.user('batch-alice'),bob=await s.user('batch-bob'),admin=await s.user('batch-admin',{role:'ADMIN'});
  const outside=await s.user('batch-outside',{email:' Outside.Case-'+crypto.randomBytes(4).toString('hex')+'@Example.INVALID '});
  const blocked=await s.user('batch-blocked'),a=await s.session(alice),revoked=await s.session(bob,{revokedAt:new Date()});
  await s.contact(blocked.email,'CONTACT_EMAIL_BLOCKED');await s.contact(outside.email,'CONTACT_EMAIL_BLOCKED');
  const tokens=[a.token,
    s.jwt.sign({sub:alice.id,sid:a.id},process.env.JWT_SECRET,{expiresIn:'2h'}),
    revoked.token,
    s.jwt.sign({sub:bob.id,sid:a.id},process.env.JWT_SECRET,{expiresIn:'1h'}),
    s.jwt.sign({sub:alice.id,sid:crypto.randomUUID()},process.env.JWT_SECRET,{expiresIn:'1h'}),
    (await s.session(blocked)).token,(await s.session(outside)).token,
    (await s.session(await s.user('batch-remembered'),{remembered:true,createdAt:old})).token,
    (await s.session(admin,{remembered:true,createdAt:old})).token,
    s.jwt.sign({sub:alice.id},process.env.JWT_SECRET,{expiresIn:'1h'}),
    s.jwt.sign({sub:alice.id,sid:a.id,exp:Math.floor(Date.now()/1000)-10},process.env.JWT_SECRET),
    (await s.session(bob)).token];
  const alone=[];
  for(const token of tokens){
    const r=await fetch(s.f.apiOrigin+'/api/v1/stocks-test-cash/identity',{headers:{authorization:'Bearer '+token}});
    alone.push(r.status===200?{issuer:s.f.issuer,subject:(await r.json()).subject}:{error:r.status===503?'AUTH_UNAVAILABLE':'AUTH_REQUIRED'});
  }
  assert.deepEqual(alone.map(x=>x.subject??x.error),[alice.id,alice.id,'AUTH_REQUIRED','AUTH_REQUIRED','AUTH_REQUIRED','AUTH_REQUIRED','AUTH_REQUIRED','AUTH_REQUIRED',admin.id,'AUTH_REQUIRED','AUTH_REQUIRED',bob.id]);
  const r=await fetch(s.f.apiOrigin+'/api/v1/stocks-test-cash/identities',{method:'POST',headers:{'content-type':'application/json','x-stocks-authority-key':s.f.gatewayKey},body:JSON.stringify({tokens})});
  assert.equal(r.status,200);
  assert.deepEqual((await r.json()).results,alone);
  // Nothing is kept: a sign-out between two batches is refused by the next one.
  await s.f.db.session.update({where:{id:a.id},data:{revokedAt:new Date()}});
  const again=await fetch(s.f.apiOrigin+'/api/v1/stocks-test-cash/identities',{method:'POST',headers:{'content-type':'application/json','x-stocks-authority-key':s.f.gatewayKey},body:JSON.stringify({tokens:tokens.slice(0,2)})});
  assert.deepEqual((await again.json()).results,[{error:'AUTH_REQUIRED'},{error:'AUTH_REQUIRED'}]);
});

// #613 (review 6488847153): the time at which a batched check judges a bearer. A batch reads all of its
// sessions in one statement, so each bearer is judged at that statement's snapshot, which is never before
// the request arrived (a request only joins a batch that has not been sent). Characterized against the
// single check at the same instant: an uncommitted sign-out is not yet visible to either; a sign-out that
// commits while the batch waits to be sent, or before its statement runs, refuses the bearer; one that
// commits after the statement read the session leaves that answer standing, exactly as a single check
// whose read came first, and the bearer's very next request is refused.
pg('a delayed identity batch judges each bearer at its own session read, as a single check at that instant',async t=>{
  const s=await setup(t),alice=await s.user('delay-alice'),bob=await s.user('delay-bob');
  const a=await s.session(alice),b=await s.session(bob);
  const batch=async tokens=>{const r=await fetch(s.f.apiOrigin+'/api/v1/stocks-test-cash/identities',{method:'POST',headers:{'content-type':'application/json','x-stocks-authority-key':s.f.gatewayKey},body:JSON.stringify({tokens})});assert.equal(r.status,200);return (await r.json()).results.map(x=>x.subject??x.error);};
  const single=async token=>(await fetch(s.f.apiOrigin+'/api/v1/stocks-test-cash/identity',{headers:{authorization:'Bearer '+token}})).status;
  // 1. A sign-out held in an open transaction: neither the batch nor a single check sees it (plain reads, no row wait).
  let updated,commit;const isUpdated=new Promise(r=>updated=r),committed=new Promise(r=>commit=r);
  const signOut=s.f.other.$transaction(async tx=>{await tx.session.update({where:{id:a.id},data:{revokedAt:new Date()}});updated();await committed;},{timeout:20000});
  await isUpdated;
  assert.deepEqual(await batch([a.token,b.token]),[alice.id,bob.id]);
  assert.equal(await single(a.token),200);
  // 2. Committed: the next batch and the next single check both refuse it; the other bearer is unaffected.
  commit();await signOut;
  assert.deepEqual(await batch([a.token,b.token]),['AUTH_REQUIRED',bob.id]);
  assert.equal(await single(a.token),401);
  // 3. Through the gateway's adapter, with the batch held on its way to the authority: a sign-out that commits
  //    after the request arrived but before the batch is read refuses it.
  const {createAuthorityAdapter}=await import('./authority-adapter.mjs');
  let beforeRead=async()=>{},afterRead=async()=>{};
  const adapter=createAuthorityAdapter({endpoint:s.f.apiOrigin+'/api/v1/stocks-test-cash',issuer:s.f.issuer,gatewayKey:s.f.gatewayKey,fetchImpl:async(url,options)=>{
    if(url.endsWith('/identities'))await beforeRead();
    const response=await fetch(url,options);
    if(url.endsWith('/identities'))await afterRead();
    return response;
  }});
  t.after(()=>adapter.close());
  const check=token=>adapter.runWithRequest({headers:{authorization:'Bearer '+token}},()=>adapter.authenticate(undefined,{})).then(p=>p.subject,e=>e.code);
  const c=await s.session(bob);
  beforeRead=async()=>{beforeRead=async()=>{};await s.f.db.session.update({where:{id:c.id},data:{revokedAt:new Date()}});};
  assert.equal(await check(c.token),'AUTH_REQUIRED','signed out while the batch waited: refused');
  // 4. A sign-out that commits after the authority read the session (while the answer is on its way back): that
  //    answer stands, as a single check whose read came first; the very next check is refused.
  const d=await s.session(bob);
  afterRead=async()=>{afterRead=async()=>{};await s.f.db.session.update({where:{id:d.id},data:{revokedAt:new Date()}});};
  assert.equal(await check(d.token),bob.id,'read before the sign-out: admitted, as a single check read then would be');
  assert.equal(await check(d.token),'AUTH_REQUIRED','the next check after the sign-out: refused');
  assert.equal(await single(d.token),401);
});
