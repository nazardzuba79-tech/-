'use strict';
const assert=require('node:assert/strict');
function count(output){
  const rows=output.trim().split('\n');assert.match(rows.shift(),/\bPID\b/,'Docker top requires its PID column');
  const commands=rows.map(row=>{assert.match(row,/^\s*\d+\s+/);return row.replace(/^\s*\d+\s+/,'').trim();});
  assert.equal(commands.filter(x=>/(?:^|\/)node dist\/index\.js$/.test(x)).length,1,'exactly one API');
  assert.equal(commands.filter(x=>/(?:^|\/)node dist\/marketDataCollector\.js$/.test(x)).length,1,'exactly one collector');
  return{api:1,collector:1};
}
module.exports={count};
