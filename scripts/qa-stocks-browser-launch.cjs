// QA only. A missing trusted installation or observable sandbox is a failure, never a fallback.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {assertLinux,inspectChrome,inspectBrowserProcess,safeLaunch,CHROME,selectedChrome}=require('./qa-stocks-public-nss.cjs');
const {privateEnvironment}=require('./qa-stocks-chrome-preflight.cjs');

function sandboxTable(rows,evaluation){
  assert.ok(Array.isArray(rows)&&rows.length>0&&rows.length<32,'bounded sandbox status table required');
  const values=new Map();
  for(const row of rows){assert.ok(Array.isArray(row)&&row.length===2);assert.ok(!values.has(row[0]),'duplicate sandbox status');values.set(row[0],row[1]);}
  // Chromium 155: chrome/browser/resources/sandbox_internals/sandbox_internals.ts.
  assert.equal(values.get('Layer 1 Sandbox'),'Namespace','Chrome namespace sandbox required');
  for(const name of ['PID namespaces','Network namespaces','Seccomp-BPF sandbox','Seccomp-BPF sandbox supports TSYNC'])assert.equal(values.get(name),'Yes',name+' is not verified');
  assert.equal(evaluation,'You are adequately sandboxed.','Chrome sandbox evaluation failed');
  return Object.fromEntries(values);
}
function rendererStatus(text,uid,browserFilters){
  assert.ok(typeof text==='string'&&text.length<65536,'bounded renderer proc status required');
  assert.ok(Number.isInteger(uid)&&uid>0,'non-root renderer identity required');
  const field=name=>{const rows=text.split('\n').filter(row=>row.startsWith(name+':'));assert.equal(rows.length,1,'unique renderer '+name+' required');return rows[0].slice(name.length+1).trim();};
  const uids=field('Uid').split(/\s+/).map(Number);assert.deepEqual(uids,[uid,uid,uid,uid],'renderer identity mismatch');
  assert.equal(field('NoNewPrivs'),'1','renderer NoNewPrivs required');assert.equal(field('Seccomp'),'2','renderer seccomp filter required');
  assert.match(field('CapEff'),/^0+$/,'renderer effective capabilities must be empty');
  const filters=Number(field('Seccomp_filters'));assert.ok(Number.isSafeInteger(browserFilters)&&browserFilters>=0,'browser seccomp baseline required');
  assert.ok(Number.isSafeInteger(filters)&&filters>browserFilters,'renderer must install additional seccomp filtering beyond container/browser baseline');
  return {uid,noNewPrivs:1,seccomp:2,seccompFilters:filters,browserSeccompFilters:browserFilters,effectiveCapabilities:field('CapEff')};
}
function procStart(pid){
  const text=fs.readFileSync('/proc/'+pid+'/stat','utf8'),end=text.lastIndexOf(')');assert.ok(end>0&&text.length<65536);
  const value=text.slice(end+2).trim().split(/\s+/)[19];assert.match(value,/^\d+$/);return value;
}
async function verifyRendererSandbox(browser,chrome){
  assertLinux(process.platform);
  const context=await browser.newContext({serviceWorkers:'block',ignoreHTTPSErrors:false});let session;
  try{
    await context.route('**/*',route=>route.abort());
    await context.routeWebSocket('**/*',socket=>socket.close());
    const page=await context.newPage();await page.goto('chrome://sandbox/',{waitUntil:'load',timeout:10000});
    const rows=await page.locator('#sandbox-status tr').evaluateAll(nodes=>nodes.map(node=>Array.from(node.querySelectorAll('td'),cell=>cell.textContent.trim())));
    const table=sandboxTable(rows,(await page.locator('#evaluation').innerText()).trim());
    const normal=await context.newPage();await normal.goto('about:blank');await normal.evaluate(()=>document.body.textContent='Owned sandbox admission fixture');
    session=await browser.newBrowserCDPSession();const {processInfo}=await session.send('SystemInfo.getProcessInfo');
    const browsers=processInfo.filter(row=>row.type==='browser');assert.equal(browsers.length,1,'unique actual browser process required');
    const browserPid=browsers[0].id;assert.ok(Number.isSafeInteger(browserPid)&&browserPid>0);const browserStart=procStart(browserPid);
    assert.equal(fs.realpathSync('/proc/'+browserPid+'/exe'),chrome.resolved,'browser seccomp baseline executable mismatch');
    const filterRows=fs.readFileSync('/proc/'+browserPid+'/status','utf8').split('\n').filter(row=>row.startsWith('Seccomp_filters:'));
    assert.equal(filterRows.length,1,'browser seccomp filter baseline unavailable');const browserFilters=Number(filterRows[0].split(':')[1].trim());
    const renderers=processInfo.filter(row=>row.type==='renderer');assert.ok(renderers.length>0&&renderers.length<=32,'bounded actual renderer process evidence required');
    const processes=renderers.map(row=>{
      assert.ok(Number.isSafeInteger(row.id)&&row.id>0);const pid=row.id,startTimeTicks=procStart(pid);
      const actualExecutable=fs.realpathSync('/proc/'+pid+'/exe');assert.equal(actualExecutable,chrome.resolved,'renderer executable mismatch');
      const status=rendererStatus(fs.readFileSync('/proc/'+pid+'/status','utf8'),process.getuid(),browserFilters);
      assert.equal(procStart(pid),startTimeTicks,'renderer process changed during inspection');
      return {pid,startTimeTicks,actualExecutable,...status};
    });
    assert.equal(procStart(browserPid),browserStart,'browser changed during renderer inspection');
    return {status:'PASS',table,processes,note:'Observed browser namespace status and additional actual renderer seccomp filtering; not a production security or capacity attestation'};
  }finally{try{if(session)await session.detach();}finally{await context.close();}}
}
function launchOptions(options={}){
  assert.ok(options&&typeof options==='object'&&!Array.isArray(options));
  for(const key of Object.keys(options))assert.ok(['headless','executablePath'].includes(key),'unreviewed browser launch option: '+key);
  assert.ok(options.headless===undefined||options.headless===true,'headless QA only');
  const executablePath=selectedChrome();assert.ok(options.executablePath===undefined||options.executablePath===executablePath,'unverified browser override prohibited');
  return {headless:true,executablePath,chromiumSandbox:true,timeout:30000};
}
async function launchStocksBrowser(chromium,options={}){
  assertLinux(process.platform);const settings=launchOptions(options);
  const temporary=fs.realpathSync(os.tmpdir()),home=fs.mkdtempSync(path.join(temporary,'voltex-stocks-browser-'));
  const marker=randomUUID(),initial=fs.lstatSync(home);assert.equal(initial.mode&0o777,0o700);
  fs.writeFileSync(path.join(home,'owned-browser'),marker,{flag:'wx',mode:0o600});
  const cleanup=()=>{
    const st=fs.lstatSync(home);assert.ok(st.isDirectory()&&!st.isSymbolicLink());assert.equal(st.uid,process.getuid());
    assert.equal(st.ino,initial.ino);assert.equal(st.dev,initial.dev);assert.equal(st.mode&0o777,0o700);
    assert.equal(fs.realpathSync(home),home);assert.equal(path.dirname(home),temporary);assert.equal(fs.readFileSync(path.join(home,'owned-browser'),'utf8'),marker);
    fs.rmSync(home,{recursive:true,force:false});
  };
  let server,browser;
  try{
    for(const name of ['config','data','cache','run','tmp'])fs.mkdirSync(path.join(home,name),{mode:0o700});
    const env=privateEnvironment(home),chrome=inspectChrome(settings.executablePath,env),previousTmp=process.env.TMPDIR;
    process.env.TMPDIR=env.TMPDIR;
    try{server=await chromium.launchServer({...settings,env,args:['--no-proxy-server','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--disable-default-apps']});}
    finally{if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;}
    safeLaunch(server.process().spawnargs);
    const profiles=server.process().spawnargs.filter(arg=>arg.startsWith('--user-data-dir='));assert.equal(profiles.length,1);
    const profile=profiles[0].slice('--user-data-dir='.length);assert.equal(path.dirname(fs.realpathSync(profile)),env.TMPDIR);
    const processProof=inspectBrowserProcess(server.process(),chrome);
    browser=await chromium.connect(server.wsEndpoint());assert.equal(browser.version(),chrome.version,'actual browser version mismatch');
    const sandbox=await verifyRendererSandbox(browser,chrome);
    Object.defineProperty(browser,'stocksBrowserProof',{value:{chrome,process:processProof,sandbox},enumerable:false});
    console.log('[stocks-browser-admission] '+JSON.stringify(browser.stocksBrowserProof));
    const close=browser.close.bind(browser);let closing;
    browser.close=()=>closing||(closing=(async()=>{try{await close();}finally{try{await server.close();}finally{cleanup();}}})());
    return browser;
  }catch(error){
    try{if(browser)await browser.close();}catch(closeError){error.browserCleanup=closeError.message;}
    try{if(server)await server.close();}catch(closeError){error.serverCleanup=closeError.message;}
    try{cleanup();}catch(closeError){error.scratchCleanup=closeError.message;}
    throw error;
  }
}
module.exports={launchStocksBrowser,launchOptions,sandboxTable,rendererStatus,verifyRendererSandbox};
