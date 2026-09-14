/** Temporary, deterministic review preparation. Creates unreferenced Git blobs only; never commits, updates refs or deploys. Remove after prepared files are committed. */
const fs=require('node:fs'),cp=require('node:child_process');
const changed=new Set();
function edit(path,old,next){let s=fs.readFileSync(path,'utf8');if(s.split(old).length!==2)throw Error(`Source changed: ${path}: ${old.slice(0,70)}`);fs.writeFileSync(path,s.replace(old,next));changed.add(path);}
function append(path,text){fs.appendFileSync(path,text);changed.add(path);}
edit('frontend/src/lib/privateTradingApi.ts','  notional?:PrivateDecimal;','  notional?:PrivateDecimal; realizedPnl?:PrivateDecimal; unrealizedRoiPercent?:PrivateDecimal;\n  usdUnrealizedPnl?:PrivateDecimal; usdRealizedPnl?:PrivateDecimal;');
edit('src/private-trading/service.ts','      entryNotional: money(number(valuationQuantity).times(position.entryPrice)),',`      entryNotional: money(number(valuationQuantity).times(position.entryPrice)),
      // Display only; immutable execution, fee and funding fields remain authoritative.
      realizedPnl: money(number(position.realizedGross).minus(position.openingFees).minus(position.closingFees).plus(position.fundingNet)),
      unrealizedRoiPercent: roiPercent(position.unrealizedPnl, position.allocatedMargin),
      usdUnrealizedPnl: null, usdRealizedPnl: null,`);
edit('frontend/src/lib/chartTrading.ts','  pnl: number;','  pnl: number;\n  status?: string;');
edit('frontend/src/lib/chartTrading.ts','  onTradeSelect(id: string): void;','  onTradeSelect(id: string): void;\n  /** Requests confirmation; never executes on a chart click. */\n  onTradeClose?(id: string): void;');
edit('frontend/src/lib/privateChartPresentation.ts',"quantity:Number(position.status==='OPEN'?position.quantity:position.initialQuantity??position.quantity),pnl,","quantity:Number(position.status==='OPEN'?position.quantity:position.initialQuantity??position.quantity),pnl,status:position.status,");
edit('frontend/src/components/PriceChart.tsx',"import './DrawingTools.css';","import './DrawingTools.css';\nimport { PrivatePositionLines } from './PrivatePositionLines';");
edit('frontend/src/components/PriceChart.tsx',"    if (selectedTrade) {\n      const base = pair.split('/')[0];",`    for (const trade of relevant.filter(t => t.status === 'OPEN')) {
      if (visibleSeries && Number.isFinite(trade.entryPrice) && trade.entryPrice > 0) {
        privateLinesRef.current.push(visibleSeries.createPriceLine({price:trade.entryPrice,title:'',color:trade.side==='LONG'?'#13ad75':'#f33b57',lineWidth:1,lineStyle:LineStyle.Dotted,axisLabelVisible:true}));
      }
    }
    if (selectedTrade) {`);
edit('frontend/src/components/PriceChart.tsx',"      addLine(selectedTrade.entryPrice, `${selectedTrade.side} ${selectedTrade.quantity} ${base} · P&L ${selectedTrade.pnl >= 0 ? '+' : ''}${selectedTrade.pnl.toFixed(2)} USDT`, '#e9b44c', LineStyle.Solid);","      if (selectedTrade.status !== 'OPEN') addLine(selectedTrade.entryPrice, 'Entry', '#7d8188', LineStyle.Dotted);");
edit('frontend/src/components/PriceChart.tsx','          <div ref={containerRef} style={styles.chart} />','          <div ref={containerRef} style={styles.chart} />\n          {privateTrading?.enabled && chartReady && <PrivatePositionLines chart={chartRef.current} series={seriesRef.current} interaction={privateTrading} pair={pair}/>}');
edit('frontend/src/pages/private-trading/PrivateTradingPage.tsx',"import './privateTrading.css';","import './privateTrading.css';\nimport './privateReferencePositions.css';");
edit('frontend/src/pages/private-trading/PrivateTradingPage.tsx',"  function closeOnChart(id:string){selectTrade(id);setExitId(id);setSelectedCandle(null);setSelecting('exit');}",`  function closeOnChart(id:string){selectTrade(id);setExitId(id);setSelectedCandle(null);setSelecting('exit');}
  function closeFromChart(id:string){
    if(busy)return;
    const position=chartPositions.find(row=>row.id===id&&row.status==='OPEN');if(!position)return;
    if(position.mode==='HISTORICAL_REPLAY')closeOnChart(id);
    else{setError('');setAction({kind:'close',position});}
  }`);
edit('frontend/src/pages/private-trading/PrivateTradingPage.tsx','onTradeSelect:setSelectedTradeId,onSelectionModeChange:chooseChartMode','onTradeSelect:setSelectedTradeId,onTradeClose:closeFromChart,onSelectionModeChange:chooseChartMode');
const positions='frontend/src/pages/private-trading/PrivatePositions.tsx';
edit(positions,"import { Image as ImageIcon,X } from 'lucide-react';","import { Image as ImageIcon,X } from 'lucide-react';\nimport './privateReferencePositions.css';");
edit(positions,'  return <section className="private-bottom-panel">',`  const referencePositions=()=>positionRows.length?<table className="private-reference-table"><colgroup>{[170,98,114,96,112,122,184,144,132,196].map((width,i)=><col key={i} style={{width}}/>)}</colgroup>
    <thead><tr><th>Контракт</th><th>Кол-во</th><th>Стоим.</th><th>Цена Входа</th><th>Цена маркировки</th><th>Цена ликвидац.</th><th>Нереализованный P&amp;L(ROI)</th><th>Реализованный P&amp;L</th><th>TP/SL</th><th>Закрыть как</th></tr></thead>
    <tbody>{privateEffectiveSort(positionRows).map(position=>{
      const unavailable=position.dataStatus==='UNAVAILABLE';
      const base=position.symbol.replace(/USDT$/,'');
      const profit=unavailable?null:position.unrealizedPnl;
      const roi=unavailable?null:position.unrealizedRoiPercent;
      const tone=(value:string|null|undefined)=>value===null||value===undefined?'':Number(value)<0?'negative':'positive';
      const quantity=privateNumber(position.quantity,8).replace(/(\\.\\d*?[1-9])0+$|\\.0+$/,'$1');
      return <tr key={position.id} aria-selected={selectedId===position.id} tabIndex={onSelect?0:undefined}
        onClick={event=>{if(!(event.target as HTMLElement).closest('button,a,input'))onSelect?.(position.id);}}
        onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onSelect?.(position.id);}}}>
        <td className={\`private-ref-contract \${position.side==='LONG'?'long':'short'}\`}><button type="button" onClick={()=>onShowEntry?.(position.id)} disabled={!onShowEntry} title="Показать вход на графике"><strong>{position.symbol} <small>Бесср.</small></strong></button>
          <span className={position.side==='LONG'?'positive':'negative'}>{position.mode==='HISTORICAL_REPLAY'?'По истории':'Изолир. торговля'} {privateNumber(position.leverage)}x</span>{unavailable&&<small>Обновление котировки</small>}{position.mode==='HISTORICAL_REPLAY'&&<><small className="private-ref-asof">На: {privateUtc(position.asOf)}</small><button type="button" className="private-ref-advance" disabled={busy} onClick={()=>onAdvance(position.id)}>Обновить до сейчас</button></>}
        </td>
        <td className={position.side==='LONG'?'positive':'negative'}>{quantity} <span>{base}</span></td>
        <td>{privateNumber(unavailable?null:position.notional)} <span className="private-ref-unit">USDT</span></td>
        <td>{privateNumber(position.entryPrice,2)}</td>
        <td>{privateNumber(unavailable?null:position.markPrice,2)}</td>
        <td className="private-ref-liquidation">{privateNumber(unavailable?null:position.liquidationPrice,2)}</td>
        <td><div className="private-ref-pnl-with-share"><div className={tone(profit)}><span>{privateNumber(profit,4)} <span>USDT</span></span><span>({privateNumber(roi)}{roi!==null&&roi!==undefined?'%':''})</span><small>{privateNumber(unavailable?null:position.usdUnrealizedPnl)} USD</small></div>
          <button type="button" className="private-ref-share" disabled={busy||unavailable} aria-label={\`Открыть карточку \${position.symbol}\`} title="Карточка P&L" onClick={()=>onCard(position.id)}><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7 9M7 3H3v10h10V9" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg></button>
        </div></td>
        <td className={tone(position.realizedPnl)}><span className="private-ref-realized">{privateNumber(position.realizedPnl,4)} USDT</span><small>{privateNumber(position.usdRealizedPnl)} USD</small></td>
        <td><button type="button" className="private-ref-pill" disabled={busy||position.mode!=='DEMO_LIVE'} title={position.mode==='DEMO_LIVE'?'Изменить TP/SL':'Изменение TP/SL исторического сценария недоступно в этой панели'} onClick={()=>onAction({kind:'protection',position})}>{position.takeProfit!=null||position.stopLoss!=null?\`\${privateNumber(position.takeProfit,2)} / \${privateNumber(position.stopLoss,2)}\`:'+ Добавить'}</button></td>
        <td><div className="private-ref-close-buttons">{position.mode==='DEMO_LIVE'?<><button type="button" className="private-ref-pill" disabled title="Лимитное закрытие пока недоступно в приватном режиме">Лимитный</button><button type="button" className="private-ref-pill" disabled={busy||unavailable} onClick={()=>onAction({kind:'close',position})}>Рыночный</button></>:<button type="button" className="private-ref-pill" disabled={busy||!onCloseOnChart} onClick={()=>onCloseOnChart?.(position.id)}>Закрыть на графике</button>}</div></td>
      </tr>;
    })}</tbody></table>:<div className="private-empty">Нет открытых позиций</div>;
  return <section className="private-bottom-panel private-reference-panel">`);
edit(positions,"{tab==='positions'&&table(positionRows,true)}","{tab==='positions'&&referencePositions()}");
edit(positions,"[['positions',`Позиции (${positionRows.length})`],['orders',`Открытые ордера (${activeOrders.length})`]","[['orders',`Открытые ордера (${activeOrders.length})`],['positions',`Позиции (${positionRows.length})`]");
edit(positions,'<div className="private-bottom-tabs" role="tablist" aria-label="Приватный торговый счёт">','<div className="private-bottom-tabs" role="tablist" aria-label="Приватный торговый счёт"><span className="private-reference-demo">▣ Демо трейдинг</span>');
edit(positions,'<th>Средний вход</th><th>Mark Price</th>',"<th>Цена Входа</th><th>{active?'Цена маркировки':'Цена выхода'}</th>");
edit(positions,'privateNumber(position.entryPrice,6)','privateNumber(position.entryPrice,2)');
edit(positions,"privateNumber(position.dataStatus==='UNAVAILABLE'?null:position.markPrice,6)","privateNumber(position.dataStatus==='UNAVAILABLE'?null:position.markPrice,2)");
// Bind the unchanged PNG delivery path to the actual extracted source artwork.
const card='frontend/src/lib/privateResultCard.ts';let text=fs.readFileSync(card,'utf8');
const a=text.indexOf('// The existing rising ribbon'),b=text.indexOf('/** One frozen server snapshot',a);if(a<0||b<0)throw Error('Card source changed');
const art=fs.readFileSync('scripts/qa-private-reference-artwork.txt','utf8');
fs.writeFileSync(card,"import { privateCardArtwork } from './privateCardArtwork';\n"+text.slice(0,a)+art+'\n\n'+text.slice(b));changed.add(card);
const test='frontend/src/lib/__tests__/privateTradingFrontend.test.ts';
edit(test,"const cardRenderer=load('lib/privateResultCard.ts',{'./privateTradingApi':api});","const cardRenderer=load('lib/privateResultCard.ts',{'./privateTradingApi':api,'./privateCardArtwork':load('lib/privateCardArtwork.ts')});");
edit(test,"expect(nodes(tree).filter(n=>n.type==='small'&&text(n)==='Итого')).toHaveLength(1);expect(text(tree)).not.toContain('Net');expect(text(tree)).toContain('Прибыль, USDT');","expect(text(tree)).not.toContain('Net');expect(text(tree)).toContain('Нереализованный P&L(ROI)');expect(text(tree)).toContain('20.0000');");
for(const name of ['chartDrawings.test.ts','priceChartMarketOrders.test.ts']){
 const file='frontend/src/lib/__tests__/'+name,key=name.startsWith('chartDrawings')?'id':'name';let source=fs.readFileSync(file,'utf8');const old=`if (${key} === '../lib/chartTrading') return chartTrading;`;if(!source.includes(old))throw Error('Test imports changed');source=source.split(old).join(old+`\n    if (${key} === './PrivatePositionLines') return { PrivatePositionLines: () => null };`);fs.writeFileSync(file,source);changed.add(file);
}
append('src/private-trading/__tests__/service.runtime.test.ts',`\ndescribe('reference table server DTO',()=>{
 test('fees and signed funding are realized, USD stays unknown, stored position unchanged',()=>{
  const f=fixture(),position=Object.freeze({id:'dto',mode:'HISTORICAL_REPLAY',status:'OPEN',symbol:'XYZUSDT',quantity:'2',initialQuantity:'2',entryPrice:'100',markPrice:'101',asOf:new Date(NOW).toISOString(),realizedGross:'5',openingFees:'1',closingFees:'0.25',fundingNet:'-0.10',unrealizedPnl:'2',allocatedMargin:'100'});
  const before=JSON.stringify(position),dto=(f.service as any).positionDto(position);
  expect(dto.realizedPnl).toBe('3.65');expect(dto.unrealizedRoiPercent).toBe('2');expect(dto.usdUnrealizedPnl).toBeNull();expect(dto.usdRealizedPnl).toBeNull();expect(JSON.stringify(position)).toBe(before);
  expect((f.service as any).positionDto({...position,allocatedMargin:'0'}).unrealizedRoiPercent).toBeNull();
 });
});\n`);
changed.add('frontend/src/lib/privateCardArtwork.ts');
const entries=[];for(const path of changed){if(!/^(frontend\/src\/|src\/private-trading\/)/.test(path))throw Error('Path denied');const data=JSON.stringify({content:fs.readFileSync(path).toString('base64'),encoding:'base64'});const reply=JSON.parse(cp.execFileSync('gh',['api','repos/'+process.env.GITHUB_REPOSITORY+'/git/blobs','--input','-'],{input:data,encoding:'utf8'}));entries.push({path,mode:'100644',type:'blob',sha:reply.sha});}
fs.writeFileSync('private-reference-prepared-tree.json',JSON.stringify(entries,null,2));
console.log(JSON.stringify(entries,null,2));
