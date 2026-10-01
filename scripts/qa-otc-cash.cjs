// Public OTC support enquiry. All requests terminate in loopback fixtures.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..'), DIST = path.join(ROOT, 'frontend/dist');
if (process.env.CI && !process.env.OTC_CI_EVIDENCE_DIR) throw Error('CI requires fresh OTC_CI_EVIDENCE_DIR');
const parent = process.env.OTC_CI_EVIDENCE_DIR || path.join(ROOT, 'output/otc-cash');
fs.mkdirSync(parent, { recursive: true });
const OUT = fs.mkdtempSync(path.join(parent, 'support-browser-'));
const calls = [], external = [], unexpected = [], errors = [], submissions = [];
const token = `fixture.${Buffer.from(JSON.stringify({sub:'fixture-user'})).toString('base64url')}.NOT_A_VALID_SIGNATURE`;
const mime = {'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'};
let fail = false, reply;
const json = (res, body, status=200) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self';script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self';frame-src 'none';object-src 'none'");
  if (url.pathname.startsWith('/api/')) {
    calls.push({method:req.method,path:url.pathname});
    if (req.method === 'GET' && url.pathname === '/api/v1/me') return json(res, {id:'fixture-user',email:'fixture@example.invalid',role:'USER',emailVerified:true});
    if (req.method === 'GET' && url.pathname === '/api/v1/market/display/spot-snapshot') return json(res, {_display:{mode:'snapshot',refreshMs:60000,capturedAt:Date.now()},tickers:{available:false},overview:{available:false}});
    if (req.method === 'POST' && url.pathname === '/api/support') {
      assert.equal(req.headers.authorization, undefined, 'support never carries session credentials');
      assert.equal(req.headers.cookie, undefined);
      let raw=''; for await (const chunk of req) raw+=chunk;
      submissions.push(JSON.parse(raw));
      // Explicit release lets QA prove that repeated input cannot double-send.
      reply = () => json(res, fail ? {ok:false,error:'DELIVERY_FAILED'} : {ok:true}, fail ? 502 : 200);
      server.emit('support-ready');
      return;
    }
    unexpected.push({method:req.method,path:url.pathname});
    return json(res, {error:'NO_FIXTURE'}, 404);
  }
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  const file = path.resolve(DIST, '.'+decodeURIComponent(url.pathname));
  if (file!==DIST && !file.startsWith(DIST+path.sep)) {res.writeHead(403); return res.end();}
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream'); return res.end(fs.readFileSync(file));}
  const boot = `<script>localStorage.setItem('exchange_token',${JSON.stringify(token)});localStorage.setItem('exchange_lang','ru');</script>`;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(DIST,'index.html'),'utf8').replace('<head>','<head>'+boot));
});
async function main() {
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true}), checks=[]; let activePage;
  try {
    for (const width of [320,390,768,1440]) {
      fail=false; const initialSubmissions=submissions.length, initialCalls=calls.length;
      const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
      await context.route('**/*', route => {
        const url=new URL(route.request().url());
        if(url.origin!==base){external.push(url.origin+url.pathname);return route.abort();}
        return route.continue();
      });
      const page=await context.newPage();activePage=page; page.on('pageerror',e=>errors.push(e.message));
      await page.clock.install();
      await page.goto(base+'/otc',{waitUntil:'networkidle'});
      assert.equal(await page.locator('[aria-label="Создать OTC-заявку"]').count(),0);
      assert.equal(submissions.length,initialSubmissions,'opening OTC never sends');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`page overflow ${width}`);
      await page.screenshot({path:path.join(OUT,`page-${width}.png`),fullPage:true});

      const dialog=page.getByRole('dialog');
      assert.equal(await dialog.count(),0,'support is not the first OTC step');
      assert.equal(await page.getByRole('button',{name:'Продолжить в поддержку',exact:true}).count(),0,'final support action is hidden before review');

      const categoryButtons=page.getByRole('button',{name:'Выбрать категорию',exact:true});
      await categoryButtons.nth(1).click();
      assert.equal(await dialog.count(),0,'choosing a category must not open support');

      const form=page.getByRole('region',{name:'Параметры OTC-обмена'}).or(page.locator('[aria-label="Параметры OTC-обмена"]'));
      await page.locator('#otc-country').fill('Украина'); await page.keyboard.press('Enter');
      await form.getByLabel('Город получения').selectOption('geonames-703448');
      await form.getByLabel('Отдаёте').selectOption('USDT');
      await form.getByLabel('Количество, USDT').fill('10000');
      await form.getByLabel('Получаете наличными').selectOption('USD');
      assert.equal(submissions.length,initialSubmissions,'editing exchange parameters never sends');
      assert.equal(await dialog.count(),0,'support stays closed while entering parameters');

      const reviewButton=form.getByRole('button',{name:'Проверить параметры',exact:true});
      await reviewButton.click();
      await form.getByText('Cash Exchange',{exact:true}).first().waitFor();
      await form.getByText('Украина, Киев',{exact:false}).waitFor();
      await form.getByText('10000 USDT → USD наличными',{exact:false}).waitFor();
      assert.equal(await dialog.count(),0,'review still does not open support');

      const cta=form.getByRole('button',{name:'Продолжить в поддержку',exact:true});
      await cta.focus(); await page.keyboard.press('Enter'); await dialog.waitFor();
      assert.equal(await dialog.getByRole('button',{name:'Специалист',exact:true}).getAttribute('aria-pressed'),'true');
      assert.equal(await dialog.getByLabel('Сообщение',{exact:true}).inputValue(),'','no automatic OTC parameter prefill');
      assert.equal(submissions.length,initialSubmissions);
      await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'});
      assert.equal(await cta.evaluate(el=>el===document.activeElement),true,'Escape returns focus to final CTA');

      await cta.click(); await dialog.waitFor();
      const message='SYNTHETIC FIXTURE ONLY — страна: Украина; город: Киев; криптовалюта: USDT; сумма: 10000. Не выполнять обмен.';
      await dialog.getByLabel('Имя',{exact:true}).fill('Fixture Tester');
      await dialog.getByLabel('Email',{exact:true}).fill('fixture@example.invalid');
      await dialog.getByRole('radio',{name:'Другое',exact:true}).check();
      await dialog.getByLabel('Сообщение',{exact:true}).fill(message);
      assert.equal(submissions.length,initialSubmissions,'manual edits never send');
      assert.ok(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),`dialog overflow ${width}`);
      await page.screenshot({path:path.join(OUT,`manual-${width}.png`)});
      const submit=dialog.getByRole('button',{name:'Отправить специалисту',exact:true});
      const sentRequest=page.waitForRequest(r=>r.url()===base+'/api/support'), ready=once(server,'support-ready',{signal:AbortSignal.timeout(5000)});
      await submit.click(); await sentRequest;
      await page.keyboard.press('Enter');
      await page.getByRole('button',{name:'Отправка...',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Отправка...',exact:true}).isDisabled(),true);
      await ready;
      assert.equal(submissions.length,initialSubmissions+1,'one explicit send, no duplicate');
      assert.deepEqual(submissions.at(-1),{name:'Fixture Tester',email:'fixture@example.invalid',subject:'OTHER',message,website:''});
      reply();reply=undefined;
      await dialog.getByText('Обращение отправлено',{exact:true}).waitFor();
      assert.equal(await dialog.getByLabel('Сообщение',{exact:true}).inputValue(),'');
      await page.screenshot({path:path.join(OUT,`accepted-${width}.png`)});
      fail=true; await dialog.getByLabel('Сообщение',{exact:true}).fill(message);
      const failedRequest=page.waitForRequest(r=>r.url()===base+'/api/support'), failureReady=once(server,'support-ready',{signal:AbortSignal.timeout(5000)});
      await submit.click(); await failedRequest;
      await failureReady;reply();reply=undefined;
      await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.getByRole('alert').innerText(),/Не удалось отправить/);
      // React can update a textarea's default text node after success/reset;
      // a wrapping label's text then includes that value in Playwright 1.56.
      // Scope to the actual specialist form control, not label text content.
      assert.equal(await dialog.locator('.support-form textarea').inputValue(),message,'failed submission retains manual text');
      assert.equal(await dialog.getByText('Обращение отправлено',{exact:true}).count(),0,'no fake success');
      await page.screenshot({path:path.join(OUT,`failed-${width}.png`)});
      await page.clock.fastForward(86400000);
      assert.equal(submissions.length,initialSubmissions+2,'idle day adds no retry or polling');
      assert.deepEqual(calls.slice(initialCalls).filter(c=>!['/api/v1/me','/api/v1/market/display/spot-snapshot','/api/support'].includes(c.path)),[],'no OTC, balances, deposit or other financial requests');
      checks.push({width,guidedParameters:true,reviewBeforeSupport:true,manualSupport:true,focusReturn:true,fixturePosts:2,duplicatePosts:0,financialRequests:0,errorRetainsInput:true,idleSupportRequests:0});
      await context.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);
    const report={checks,errors,external,unexpected,requests:calls,productionAccess:false,emailReceiptConfirmed:false};
    fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  } catch(error) {
    if(activePage && !activePage.isClosed()) {
      await activePage.screenshot({path:path.join(OUT,'failure.png')});
      console.error(await activePage.locator('body').innerText());
    }
    console.error(JSON.stringify({calls,external,unexpected,errors})); throw error;
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;server.close();});
