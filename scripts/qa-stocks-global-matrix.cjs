// Additional Issue505 coverage; the original overload assertions remain intact.
// Runs only against the parent's disposable account server and synthetic hub.
const path=require('node:path');
const widths=[1920,1707,1440,1366,430,390,360,320];
const languages=['ru','en','zh','es','hi','ja','ko'];
// Independently reviewed visible labels: a Russian fallback cannot pass a locale case.
const labels={
  ru:{chart:'График',trade:'Торговля',positions:'Позиции / заявки',price:'Цена',amount:'Количество',total:'Итого',choice:'RU',limit:'Limit'},
  en:{chart:'Chart',trade:'Trade',positions:'Positions / orders',price:'Price',amount:'Amount',total:'Total',choice:'EN',limit:'Limit'},
  es:{chart:'Gráfico',trade:'Operar',positions:'Posiciones / órdenes',price:'Precio',amount:'Cantidad',total:'Total',choice:'ES',limit:'Límite'},
  zh:{chart:'图表',trade:'交易',positions:'持仓 / 订单',price:'价格',amount:'数量',total:'总额',choice:'中文',limit:'限价'},
  hi:{chart:'चार्ट',trade:'ट्रेडिंग',positions:'पोज़िशन / ऑर्डर',price:'मूल्य',amount:'मात्रा',total:'कुल',choice:'हिन्दी',limit:'लिमिट'},
  ja:{chart:'チャート',trade:'取引',positions:'ポジション / 注文',price:'価格',amount:'数量',total:'合計',choice:'日本語',limit:'指値'},
  ko:{chart:'차트',trade:'거래',positions:'포지션 / 주문',price:'가격',amount:'수량',total:'총액',choice:'한국어',limit:'지정가'},
};
const chartReady=async page=>await page.locator('.vxg-ohlc').count()>0&&/\d+\.\d{2}/.test(await page.locator('.vxg-ohlc').innerText());
module.exports=async function globalMatrix({browser,origin,id,prefix,local,out,report,check,until}){
  report.matrix=[];
  for(const lang of languages){
    const text=labels[lang];
    const principal=`matrix-${lang}`,seed=await local(principal,`state?id=${encodeURIComponent(id)}`);
    await local(principal,'refresh',{id},seed.token);
    const context=await browser.newContext({viewport:{width:1440,height:900},locale:lang,serviceWorkers:'block'});
    let reads=0,writes=0,hidden=false;const requests=[],inflight=new Set();
    await context.addInitScript(({lang,principal})=>{
      localStorage.setItem('exchange_lang',lang);localStorage.setItem('exchange_token',`fixture-overload-${principal}`);
      window.__stocksMatrixHidden=false;
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__stocksMatrixHidden});
    },{lang,principal});
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin){report.externalBlocked.push({matrix:true,lang,type:'http'});return route.fulfill({status:503,body:'Fixture blocks outside network'});}
      if(req.method()!=='GET'&&req.method()!=='HEAD'){writes++;report.unexpectedWrites.push({matrix:true,lang,method:req.method(),path:url.pathname});return route.fulfill({status:403,body:'Read-only browser matrix'});}
      if(url.pathname.startsWith(prefix)){requests.push(url.pathname+url.search);if(['state','history'].includes(url.pathname.slice(prefix.length)))reads++;return route.continue();}
      if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:'{"error":"FIXTURE_REAL_API_DISABLED"}'});
      return route.continue();
    });
    if(context.routeWebSocket)await context.routeWebSocket('**/*',socket=>{report.externalBlocked.push({matrix:true,lang,type:'websocket'});socket.close();});
    const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push({matrix:true,lang,message:e.message}));
    page.on('request',req=>{if(new URL(req.url()).pathname.startsWith(prefix))inflight.add(req);});
    page.on('requestfinished',req=>inflight.delete(req));page.on('requestfailed',req=>inflight.delete(req));
    try{
      // Date-only staleness leaves native timers/frames intact for pointer input.
      // Fully controlled timers are tested only after every responsive interaction.
      await page.clock.setFixedTime(new Date(Date.now()+65000));
      await page.goto(origin+'/stocks/'+encodeURIComponent(id));
      await until(async()=>await page.locator('.vxg-active-asset').count()>0&&(await page.locator('.vxg-active-asset').innerText()).includes('AAPLX'),'global matrix catalogue');
      await until(()=>chartReady(page),'global matrix candle rendering');
      for(const width of widths){
        await page.setViewportSize({width,height:width<500?844:width===1366?768:width===1920?1080:900});
        const tabs=page.locator('.vxg-mobile-tabs');
        for(const label of [text.chart,text.trade,text.positions])check(await tabs.getByRole('button',{name:label,exact:true,includeHidden:true}).count()===1,`${lang}/${width}: translated tab ${label}`);
        if(width<500)await tabs.getByRole('button',{name:text.chart,exact:true}).click();
        await page.locator('.vxg-chart-section canvas').first().waitFor({state:'visible'});
        const chart=await page.locator('.vxg-chart-section').boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
        check(viewport.scroll<=viewport.width+1,`${lang}/${width}: no page horizontal overflow`);
        check(chart.x>=-1&&chart.x+chart.width<=width+1,`${lang}/${width}: chart stays within viewport`);
        if(width>=1366){const ticket=await page.locator('.vxg-ticket').boundingBox();check(chart.x+chart.width<=ticket.x+1,`${lang}/${width}: chart does not cover ticket`);}
        const historyReads=interval=>requests.filter(raw=>{const u=new URL(raw,origin);return u.pathname===prefix+'history'&&u.searchParams.get('interval')===interval;}).length;
        const before=historyReads('1h');await page.locator('.vxg-timeframes').getByRole('button',{name:'1h',exact:true}).click();
        await until(()=>historyReads('1h')>before,'selected timeframe read missing');
        const after=historyReads('15m');await page.locator('.vxg-timeframes').getByRole('button',{name:'15m',exact:true}).click();
        await until(()=>historyReads('15m')>after,'return timeframe read missing');
        if(width<500)await tabs.getByRole('button',{name:text.trade,exact:true}).click();
        const ticket=page.locator('.vxg-ticket');await ticket.getByLabel(text.amount,{exact:true}).fill('0.5');
        check(await ticket.getByLabel(text.total,{exact:true}).count()===1,`${lang}/${width}: total label is translated`);
        await ticket.locator('.vxg-submit').scrollIntoViewIfNeeded();
        check(await ticket.locator('.vxg-submit').isVisible(),`${lang}/${width}: trade action is reachable`);
        check(await ticket.locator('.vxg-submit').isDisabled(),`${lang}/${width}: stale fixture quote cannot admit Market order`);
        if(width<500){
          await ticket.locator('.vxg-submit').evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
          check(await ticket.locator('.vxg-submit').evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&(hit===el||el.contains(hit));}),`${lang}/${width}: reachable trade action is not covered by bottom navigation`);
        }
        if(width<500){await tabs.getByRole('button',{name:text.positions,exact:true}).click();check(await page.locator('.vxg-account-tabs').isVisible(),`${lang}/${width}: positions and orders remain reachable`);}
        let screenshot=null;if(lang==='ru'||width===390||width===1440){screenshot=`fixture-matrix-${lang}-${width}.png`;await page.screenshot({path:path.join(out,screenshot),fullPage:true});}
        report.matrix.push({lang,width,fixtureOnly:true,screenshot,financialWrites:writes,languageLabels:[text.chart,text.trade,text.positions,text.amount,text.total]});
      }
      // A real language control changes context while mounted. Pause only market
      // demand through the existing visibility fixture; no page reload or clock jump.
      await page.setViewportSize({width:1440,height:900});
      const ticket=page.locator('.vxg-ticket');
      await ticket.locator('.vxg-order-types').getByRole('button',{name:text.limit,exact:true}).click();
      await ticket.getByLabel(text.amount,{exact:true}).fill('0.625');await ticket.getByLabel(text.price,{exact:true}).fill('95.25');
      const amountElement=await ticket.getByLabel(text.amount,{exact:true}).elementHandle(),chartElement=await page.locator('.vxg-chart-section canvas').first().elementHandle();
      await page.evaluate(()=>{window.__stocksMatrixHidden=true;document.dispatchEvent(new Event('visibilitychange'));});hidden=true;
      await until(()=>inflight.size===0,'language switch market request drain');
      const switchReads=reads,switchWrites=writes,next=lang==='en'?'ru':'en',nextText=labels[next];
      const switchLanguage=async target=>{
        await page.locator('.vxo-original-header').getByRole('button',{name:'Language / Язык / 语言',exact:true}).click();
        await page.locator('.vxo-original-header').getByRole('button',{name:labels[target].choice,exact:true}).click();
        await until(async()=>await ticket.getByLabel(labels[target].amount,{exact:true}).count()===1,'Stocks language context switch');
      };
      await switchLanguage(next);
      check(await ticket.getByLabel(nextText.amount,{exact:true}).inputValue()==='0.625'&&await ticket.getByLabel(nextText.price,{exact:true}).inputValue()==='95.25',`${lang}: language switch preserves Limit form values`);
      check(await amountElement.evaluate(el=>el.isConnected)&&await chartElement.evaluate(el=>el.isConnected),`${lang}: language switch retains mounted form and chart`);
      check(reads===switchReads&&writes===switchWrites,`${lang}: language switch starts no market or financial requests while hidden`);
      await switchLanguage(lang);
      check(await ticket.getByLabel(text.amount,{exact:true}).inputValue()==='0.625'&&await ticket.getByLabel(text.price,{exact:true}).inputValue()==='95.25',`${lang}: return language preserves form`);
      check(reads===switchReads&&writes===switchWrites,`${lang}: return language starts no market or financial requests`);
      report.languageSwitches??=[];report.languageSwitches.push({from:lang,to:next,formPreserved:true,chartMounted:true,additionalReads:reads-switchReads,additionalWrites:writes-switchWrites});
      await page.evaluate(()=>{window.__stocksMatrixHidden=false;document.dispatchEvent(new Event('visibilitychange'));});hidden=false;
      // Advancing a paused Chromium clock before resize/input can suppress the
      // native pointerdown/click sequence. Keep real native interaction above;
      // the same normal/hidden/recovery timer assertions run after the last click.
      await page.clock.install({time:new Date(Date.now()+65000)});await page.clock.pauseAt(new Date(Date.now()+66000));
      // Register the application's polling timers under the newly installed
      // controlled clock, rather than retaining pre-install native intervals.
      await page.reload();
      await until(()=>chartReady(page),'controlled-clock chart readiness');
      const first=reads;await page.clock.runFor(3100);await until(()=>reads>first,'normal visible state polling');
      check(reads>first,`${lang}: normal visible polling continues`);
      await page.evaluate(()=>{window.__stocksMatrixHidden=true;document.dispatchEvent(new Event('visibilitychange'));});hidden=true;
      const paused=reads;await page.clock.runFor(60000);
      check(reads===paused,`${lang}: hidden visibility fixture performs no state/history polling`);
      await page.evaluate(()=>{window.__stocksMatrixHidden=false;document.dispatchEvent(new Event('visibilitychange'));});hidden=false;
      await until(()=>reads>paused,'visible recovery did not resume reads');
      check(writes===0,`${lang}: visibility recovery does not submit mutations`);
      check(writes===0,`${lang}: full viewport matrix has no financial mutations`);
    }catch(error){report.matrixFailure={lang,reads,writes,requests,error:String(error)};if(!page.isClosed()){report.matrixFailure.body=(await page.locator('body').innerText()).slice(0,12000);await page.screenshot({path:path.join(out,`fixture-matrix-failed-${lang}.png`),fullPage:true});}throw error;}
    finally{if(hidden)await page.evaluate(()=>{window.__stocksMatrixHidden=false;});await context.close();}
  }
};
