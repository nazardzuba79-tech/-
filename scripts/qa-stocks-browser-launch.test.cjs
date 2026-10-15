'use strict';
// Fixed native-path selection is exercised without launching a browser.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {launchOptions,sandboxTable,rendererStatus}=require('./qa-stocks-browser-launch.cjs');
const {CHROME}=require('./qa-stocks-public-nss.cjs');
test('Stocks launch options bind installed Chrome and enable sandbox without arbitrary overrides',()=>{
  const previous=process.env.VOLTEX_STOCKS_NATIVE_BROWSER;delete process.env.VOLTEX_STOCKS_NATIVE_BROWSER;try{
  assert.deepEqual(launchOptions(),{headless:true,executablePath:CHROME,chromiumSandbox:true,timeout:30000});
  assert.deepEqual(launchOptions({headless:true,executablePath:CHROME}),launchOptions());
  for(const value of [{headless:false},{executablePath:'/tmp/chromium'},{chromiumSandbox:false},{args:['--no-sandbox']},{env:{}},{ignoreDefaultArgs:true},[],null])assert.throws(()=>launchOptions(value));
  }finally{if(previous===undefined)delete process.env.VOLTEX_STOCKS_NATIVE_BROWSER;else process.env.VOLTEX_STOCKS_NATIVE_BROWSER=previous;}
});
test('explicit native selection retains sandbox and rejects legacy/arbitrary executable overrides',()=>{
  const previous=process.env.VOLTEX_STOCKS_NATIVE_BROWSER;const {EXECUTABLE}=require('./stocks-browser-native/installation.cjs');try{
    process.env.VOLTEX_STOCKS_NATIVE_BROWSER='1';assert.deepEqual(launchOptions(),{headless:true,executablePath:EXECUTABLE,chromiumSandbox:true,timeout:30000});
    assert.throws(()=>launchOptions({executablePath:CHROME}));assert.throws(()=>launchOptions({executablePath:'/tmp/chrome'}));assert.throws(()=>launchOptions({chromiumSandbox:false}));
    process.env.VOLTEX_STOCKS_NATIVE_BROWSER='0';assert.throws(()=>launchOptions());
  }finally{if(previous===undefined)delete process.env.VOLTEX_STOCKS_NATIVE_BROWSER;else process.env.VOLTEX_STOCKS_NATIVE_BROWSER=previous;}
});
const rows=[['Layer 1 Sandbox','Namespace'],['PID namespaces','Yes'],['Network namespaces','Yes'],['Seccomp-BPF sandbox','Yes'],['Seccomp-BPF sandbox supports TSYNC','Yes']];
test('browser-reported sandbox requires namespace, seccomp, TSYNC and positive evaluation',()=>{
  assert.equal(sandboxTable(rows,'You are adequately sandboxed.')['Layer 1 Sandbox'],'Namespace');
  for(let i=0;i<rows.length;i++){
    const altered=rows.map(row=>row.slice());altered[i][1]='No';assert.throws(()=>sandboxTable(altered,'You are adequately sandboxed.'));
    assert.throws(()=>sandboxTable(rows.filter((_,index)=>index!==i),'You are adequately sandboxed.'));
  }
  for(const evaluation of ['You are NOT adequately sandboxed.','','Unknown'])assert.throws(()=>sandboxTable(rows,evaluation));
  assert.throws(()=>sandboxTable([...rows,rows[0]],'You are adequately sandboxed.'));
});
const status='Name:\tchrome\nUid:\t1001\t1001\t1001\t1001\nNoNewPrivs:\t1\nSeccomp:\t2\nSeccomp_filters:\t2\nCapEff:\t0000000000000000\n';
test('actual renderer proc status requires matching non-root identity, no privileges and seccomp',()=>{
  assert.equal(rendererStatus(status,1001,1).seccomp,2);
  for(const text of [status.replace('NoNewPrivs:\t1','NoNewPrivs:\t0'),status.replace('Seccomp:\t2','Seccomp:\t0'),status.replace('Seccomp:\t2','Seccomp:\t1'),status.replace('CapEff:\t0000000000000000','CapEff:\t0000000000000001'),status.replace('1001\t1001\t1001\t1001','1001\t0\t1001\t1001'),status+'Seccomp:\t2\n',status.replace('NoNewPrivs:\t1\n',''),status.replace('Seccomp_filters:\t2\n',''),''])assert.throws(()=>rendererStatus(text,1001,1));
  assert.throws(()=>rendererStatus(status,0,1));assert.throws(()=>rendererStatus(status,1002,1));
  for(const baseline of [2,3,undefined,-1,NaN])assert.throws(()=>rendererStatus(status,1001,baseline));
});
