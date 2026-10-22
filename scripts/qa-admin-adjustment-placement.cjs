/** Built UI; all accounts, receipts and writes are synthetic loopback fixtures. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {chromium} = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.QA_ADJUSTMENT_OUT || path.join(root, 'output/admin-adjustment-placement'));
fs.mkdirSync(out, {recursive:true});
const source = fs.readFileSync(path.join(__dirname, 'qa-admin-practicality.cjs'), 'utf8');
const boundary = source.indexOf('async function main()');
assert.ok(boundary > 0, 'Existing synthetic fixture boundary');
const fixture = {exports:{}};
vm.runInNewContext(source.slice(0,boundary) + '\nmodule.exports={app,state,users,adjustmentReceipts};',
  {require,__dirname,process,console,module:fixture,setTimeout,clearTimeout});
const {app,state,users,adjustmentReceipts} = fixture.exports;
const report = {fixtureOnly:true,productionAccess:false,layouts:[],checks:[],pageErrors:[],blockedExternal:[],writes:[]};
const deposit = {id:'fixture-chain-deposit',asset:'USDT',amount:'500',chain:'TRON',txHash:'synthetic-chain-tx',status:'CREDITED',createdAt:'2026-10-01T12:00:00Z'};
const check = (name, condition) => {assert.ok(condition,name);report.checks.push(name);};
const countReads = suffix => state.calls.filter(r=>r.method==='GET' && r.path.endsWith(suffix)).length;

(async()=>{
  const server = app.listen(Number(process.env.QA_ADJUSTMENT_PORT || 4440),'127.0.0.1'); await once(server,'listening');
  const origin = 'http://127.0.0.1:'+server.address().port;
  const browser = await chromium.launch({headless:true});
  let fault = null;
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route=>{
      const request=route.request(), url=new URL(request.url());
      if(url.origin!==origin){report.blockedExternal.push(url.origin+url.pathname);return route.abort();}
      if(request.method()==='POST' && /\/balance-adjustments$/.test(url.pathname)){
        report.writes.push(request.postDataJSON());
        const injected=fault; fault=null;
        if(injected==='400')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Проверьте данные операции'})});
        if(injected==='500')return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Тестовая недоступность сервера'})});
        if(injected==='timeout-applied'){
          await route.fetch(); // Synthetic operation applied, reply never reaches the browser.
          await new Promise(done=>setTimeout(done,16_000));
          return route.abort().catch(()=>{});
        }
        if(injected==='timeout-not-applied'){
          await new Promise(done=>setTimeout(done,16_000));
          return route.abort().catch(()=>{});
        }
      }
      if(request.method()==='GET' && url.pathname.endsWith('/history') && state.backend==='modern'){
        state.calls.push({method:'GET',path:url.pathname.replace('/api/v1',''),query:Object.fromEntries(url.searchParams)});
        const kind=url.searchParams.get('kind');
        const items=kind==='deposits'?[deposit]:kind==='audit'?[...adjustmentReceipts.values()].map(({response:r})=>({id:r.operationId,action:'BALANCE_ADJUSTED',userId:r.userId,userEmail:users[0].email,performedByAdminEmail:'fixture-admin@example.invalid',createdAt:r.createdAt,metadata:{asset:r.asset,amount:r.amount,reason:r.reason}})):[];
        return route.fulfill({contentType:'application/json',body:JSON.stringify({items,total:items.length,page:1,pageSize:20,totalPages:1,asOf:new Date().toISOString()})});
      }
      return route.continue();
    });
    if(context.routeWebSocket)await context.routeWebSocket('**/*',s=>s.close());
    const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
    const go=async()=>{await page.goto(origin+'/admin/users/qa-user-1?tab=deposits');await page.getByRole('button',{name:'Корректировка баланса',exact:true}).waitFor();};
    const open=async()=>{await page.getByRole('button',{name:'Корректировка баланса',exact:true}).click();await page.getByRole('dialog').waitFor();};
    const prepare=async(amount='10')=>{
      await open();const dialog=page.getByRole('dialog');
      await dialog.getByLabel('Сумма со знаком + / −',{exact:true}).fill(amount);
      await dialog.getByLabel('Причина',{exact:true}).fill('Synthetic placement QA');
      await dialog.getByRole('button',{name:'Проверить корректировку',exact:true}).click();
      await dialog.getByRole('button',{name:'Подтвердить корректировку',exact:true}).waitFor();
      return dialog;
    };
    for(const [width,height] of [[1920,1080],[1440,900],[1366,900],[430,932],[390,844],[360,800],[320,740]]){
      await page.setViewportSize({width,height});await go();
      await page.getByText('synthetic-chain-tx',{exact:true}).waitFor();
      const geometry=await page.evaluate(()=>{
        const box=document.querySelector('.admin-deposit-adjustment'),button=box.querySelector('button'),history=box.nextElementSibling;
        const b=button.getBoundingClientRect(),h=history.getBoundingClientRect();
        return {button:{x:b.x,y:b.y,right:b.right,bottom:b.bottom},historyY:h.y,overflow:document.documentElement.scrollWidth>innerWidth+1,duplicate:document.querySelector('.admin-user-actions').textContent.includes('Корректировка')};
      });
      check('Deposits entry placement '+width,!geometry.overflow&&!geometry.duplicate&&geometry.button.right<=width&&geometry.button.bottom<geometry.historyY);
      await page.screenshot({path:path.join(out,'deposits-'+width+'.png'),fullPage:true});report.layouts.push({width,height,...geometry});
    }
    await page.setViewportSize({width:1440,height:1000});await go();
    await page.locator('.admin-user-actions summary').click();
    check('Delete remains in additional actions',await page.locator('.admin-user-actions').getByRole('button',{name:'Удалить аккаунт',exact:true}).count()===1);
    await page.locator('.admin-user-actions summary').click();
    const writesBeforeCancel=report.writes.length;
    let dialog=await prepare();
    check('Confirmation shows account, signed change and reason',(await dialog.innerText()).includes(users[0].email)&&(await dialog.innerText()).includes('+10')&&(await dialog.innerText()).includes('Synthetic placement QA'));
    await page.screenshot({path:path.join(out,'confirmation-desktop.png'),fullPage:true});
    await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
    check('Cancellation sends no operation',report.writes.length===writesBeforeCancel);
    check('Cancel restores focus to deposits entry',await page.getByRole('button',{name:'Корректировка баланса',exact:true}).evaluate(e=>e===document.activeElement));

    const oldBalance=users[0].balances[0].available,oldLocked=users[0].balances[0].locked;
    const profiles=countReads('/profile'),histories=countReads('/history');
    dialog=await prepare();await dialog.getByRole('button',{name:'Подтвердить корректировку',exact:true}).dblclick();
    await dialog.getByText('Корректировка подтверждена',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.admin-read-status')?.textContent?.includes('Обновлено'));
    check('Double confirmation sends one POST',report.writes.length===writesBeforeCancel+1);
    check('Success refreshes profile and visible history',countReads('/profile')>profiles&&countReads('/history')>histories);
    check('Fixture reserves unchanged',users[0].balances[0].locked===oldLocked&&users[0].balances[0].available!==oldBalance);
    await dialog.getByRole('button',{name:'Закрыть',exact:true}).last().click();
    check('Adjustment does not become a blockchain deposit',await page.locator('.admin-history-item').count()===1&&await page.getByText('synthetic-chain-tx',{exact:true}).count()===1);
    await page.getByRole('tab',{name:'Балансы',exact:true}).click();
    await page.getByText(users[0].balances[0].available,{exact:true}).waitFor();
    check('Refreshed spot and separate test balance remain visible',await page.getByText('Тестовый счёт — отдельно',{exact:true}).count()===1);
    await page.getByRole('tab',{name:'История действий',exact:true}).click();
    await page.getByText('Баланс скорректирован',{exact:true}).waitFor();check('Existing audit presentation accepts adjustment',true);
    await page.getByRole('tab',{name:'Пополнения',exact:true}).click();

    fault='400';dialog=await prepare();await dialog.getByRole('button',{name:'Подтвердить корректировку',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'Проверьте данные операции'}).waitFor();check('Validation error returns to editable form',await dialog.locator('form').count()===1);
    await dialog.getByRole('button',{name:'Отмена',exact:true}).click();

    fault='timeout-applied';dialog=await prepare();const beforeLost=report.writes.length;
    await dialog.getByRole('button',{name:'Подтвердить корректировку',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'Время ожидания истекло'}).waitFor({timeout:20_000});
    const lostKey=report.writes.at(-1).idempotencyKey;
    await dialog.getByRole('button',{name:'Проверить результат',exact:true}).click();
    await dialog.getByText('Корректировка подтверждена',{exact:true}).waitFor();
    check('Timeout with applied receipt recovers via GET without another POST',report.writes.length===beforeLost+1&&adjustmentReceipts.has('qa-user-1:'+lostKey));
    await dialog.getByRole('button',{name:'Закрыть',exact:true}).last().click();

    fault='timeout-not-applied';dialog=await prepare('-1');
    await dialog.getByRole('button',{name:'Подтвердить корректировку',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'Время ожидания истекло'}).waitFor({timeout:20_000});
    const retryIntent=report.writes.at(-1);
    await dialog.getByRole('button',{name:'Проверить результат',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'пока не найден'}).waitFor();
    await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await open();
    dialog=page.getByRole('dialog');await dialog.getByText(retryIntent.idempotencyKey,{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Повторить с исходным ключом',exact:true}).click();
    await dialog.getByText('Корректировка подтверждена',{exact:true}).waitFor();
    check('Timeout retry after reopening reuses complete immutable intent',JSON.stringify(report.writes.at(-1))===JSON.stringify(retryIntent));
    await dialog.getByRole('button',{name:'Закрыть',exact:true}).last().click();

    fault='500';dialog=await prepare();await dialog.getByRole('button',{name:'Подтвердить корректировку',exact:true}).click();
    await dialog.getByRole('button',{name:'Проверить результат',exact:true}).waitFor();
    check('Server failure is uncertain, never falsely reported as a credit',await dialog.getByText('Корректировка подтверждена',{exact:true}).count()===0);
    await dialog.getByRole('button',{name:'Отмена',exact:true}).click();

    state.backend='legacy';await go();
    check('Unsupported server explains disabled entry',await page.getByRole('button',{name:'Корректировка баланса',exact:true}).isDisabled()&&await page.getByText('Корректировка баланса недоступна на текущей версии сервера.',{exact:true}).count()===1);
    await page.screenshot({path:path.join(out,'unsupported-desktop.png'),fullPage:true});
    state.backend='modern';await go();await page.setViewportSize({width:390,height:844});
    // A fresh account has no unresolved operation from the preceding injected fault.
    await page.goto(origin+'/admin/users/qa-user-2?tab=deposits');
    dialog=await prepare();await page.screenshot({path:path.join(out,'confirmation-mobile.png'),fullPage:true});
    const modal=await dialog.boundingBox();check('Mobile confirmation fits viewport',modal.x>=0&&modal.x+modal.width<=391);
    await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
    state.session='user';await page.reload();
    await page.waitForURL(url=>!url.pathname.startsWith('/admin'));
    check('Admin permission gate prevents access',!new URL(page.url()).pathname.startsWith('/admin')&&await page.getByRole('button',{name:'Корректировка баланса',exact:true}).count()===0);
    check('No unhandled JavaScript errors',report.pageErrors.length===0);
    check('All mutation requests target existing adjustment endpoint only',state.writes.every(r=>/\/balance-adjustments$/.test(r.path)));
    await context.close();
  }catch(error){
    const pages=browser.contexts().flatMap(c=>c.pages());
    if(pages[0]){await pages[0].screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});report.failurePage=await pages[0].locator('body').innerText().catch(()=>'');}
    report.failure=String(error);throw error;
  }finally{
    await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));
    report.fixtureOperationCount=adjustmentReceipts.size;
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({layouts:report.layouts.length,checks:report.checks.length,errors:report.pageErrors,syntheticPosts:report.writes.length,fixtureOperations:report.fixtureOperationCount,productionAccess:false,evidence:out}));
})().catch(e=>{console.error(e);process.exitCode=1;});
