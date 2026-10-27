'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const parser=require('@babel/parser');
const input=process.argv[2]||'/tmp/voltex-worker-current-20261027.mjs',output=process.argv[3]||'/tmp/voltex-worker-eclv-peak-20261027.mjs';
const original=fs.readFileSync(input,'utf8');let code=original;
function replaceFunction(name,changes){
 const ast=parser.parse(code,{sourceType:'module'}),f=ast.program.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(f,name);
 let body=code.slice(f.start,f.end);
 for(const [from,to] of changes){assert.equal(body.split(from).length-1,1,'exact old expression: '+name);body=body.replace(from,to);}
 code=code.slice(0,f.start)+body+code.slice(f.end);
}
replaceFunction('validateScenarioControls',[
 ['for (const stage of program.stages) {','for (const [index, stage] of program.stages.entries()) {'],
 ['if (target <= 0n || target > cap * 97n / 100n || target + 2n >= cap)',
  'const terminalPeak = program.scenario === "DEEP_RECOVERY" && program.afterGrowth === "range" && index === program.stages.length - 1 && stage.type === "recovery" && target === cap;\n    if (target <= 0n || (!terminalPeak && (target > cap * 97n / 100n || target + 2n >= cap)))']
]);
replaceFunction('priceAt',[[
 'let base = baseline(config, p, at);',
 'let base = baseline(config, p, at);\n  const lastStage = c.stages[c.stages.length - 1];\n  if (c.scenario === "DEEP_RECOVERY" && c.afterGrowth === "range" && p.index === c.stages.length && lastStage.type === "recovery" && p.open === cap) {\n    base = cap * (1 - .06 * smooth(Math.min(1, t / HOUR)));\n  }'
]]);
assert.equal((code.match(/\/\/# sourceMappingURL=worker\.js\.map/g)||[]).length,1);
code=code.replace('//# sourceMappingURL=worker.js.map','// Source: existing live Worker + reviewed ECLV two-function terminal-peak patch; previous map omitted.');
const a=parser.parse(original,{sourceType:'module'}).program.body,b=parser.parse(code,{sourceType:'module'}).program.body;
assert.equal(a.length,b.length);const changed=[];
for(let i=0;i<a.length;i++)if(original.slice(a[i].start,a[i].end)!==code.slice(b[i].start,b[i].end))changed.push(a[i].type==='FunctionDeclaration'?a[i].id.name:a[i].type);
assert.deepEqual(changed,['priceAt','validateScenarioControls']);
fs.writeFileSync(output,code,{mode:0o600});
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const report={source:'Actual production Worker6985ddd7-301b-4c66-a6fe-9ad6b178a097',originalSha256:sha(original),patchedSha256:sha(code),originalBytes:Buffer.byteLength(original),patchedBytes:Buffer.byteLength(code),changedRuntimeFunctions:changed,allOtherTopLevelNodesIdentical:true,staleSourceMapRemoved:true};
fs.writeFileSync('/tmp/eclv-worker-bundle-patch-proof.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
