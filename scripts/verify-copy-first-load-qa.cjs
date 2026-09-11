// Verify exported QA measurements, without controlling a browser.
// node scripts/verify-copy-first-load-qa.cjs before.json after.json
const assert = require('node:assert/strict');
const fs = require('node:fs');
const [before,after] = process.argv.slice(2).map(file=>JSON.parse(fs.readFileSync(file,'utf8')));
for(const run of [before,after]) {
  const b=run.browser;
  assert.ok(b,'Browser measurements were published');
  assert.equal(b.resources.filter(r=>r.name.endsWith('/copy-trading/marketplace')).length,1);
  assert.deepEqual(b.firstOrder.slice(0,2),['VX-001','VX-KSENIA']);
  assert.deepEqual(b.firstOrder,b.finalOrder);
  assert.equal(new Set(b.finalOrder).size,16);
  assert.equal(b.sameCards,true);
  assert.equal(b.overflow,false);
  assert.deepEqual(b.errors,[]);
}
for(const id of ['VX-001','VX-KSENIA']) {
  assert.ok(after.browser.hydrated[id]>after.browser.first[id],'Skeleton really preceded the payload');
  const boxes=after.browser.boxes[id];
  for(const key of ['w','h']) assert.ok(Math.abs(boxes.before[key]-boxes.after[key])<0.1,`${id} changed ${key}`);
  // Last pending geometry isolates response hydration from earlier font swap
  // or unrelated header/ticker settlement, which first geometry also records.
  const pending=boxes.lastPending || boxes.before;
  for(const key of ['x','y']) assert.ok(Math.abs(pending[key]-boxes.after[key])<0.1,`${id} moved on hydration`);
}
const endpoint=run=>run.browser.resources.find(r=>r.name.endsWith('/copy-trading/marketplace'));
assert.ok(endpoint(after).start<endpoint(before).start,'The real request starts earlier');
assert.ok(after.browser.hydrated['VX-001']<before.browser.hydrated['VX-001'],'Live values arrive earlier');
console.log(JSON.stringify({width:after.browser.width,requests:[1,1],requestStart:[endpoint(before).start,endpoint(after).start],
  live:[before.browser.hydrated['VX-001'],after.browser.hydrated['VX-001']],sameCards:true,stableGeometry:true,overflow:false},null,2));
