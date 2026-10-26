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
