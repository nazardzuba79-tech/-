import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
function evaluate(file: string, overrides: Record<string, unknown> = {}) {
  const compiled = ts.transpileModule(readFileSync(resolve(frontend, 'src', file), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const output: any = {};
  new Function('require', 'exports', compiled)((name: string) => overrides[name] ?? req(name), output);
  return output;
}
const priceChange = evaluate('lib/priceChange.ts');
const marketModule = evaluate('pages/home/useHomeMarket.ts', {
  '../../lib/api': { api: {} }, '../../lib/priceChange': priceChange,
  '../../lib/futuresConfigStore': { futuresConfigStore: {} },
});
const liveValue = evaluate('pages/home/LiveValue.tsx', { './useHomeMarket': marketModule });
const { SapphireTerminal } = evaluate('pages/home/SapphireTerminal.tsx', {
  './useHomeMarket': marketModule, './LiveValue': liveValue,
  './TerminalPreview': { PreviewCandles: ({candles,livePrice}:any) => React.createElement('svg', {'data-chart-count':candles.length, 'data-price':livePrice}) },
  '../../components/Logo': { LogoMark: () => null },
  '../../components/CryptoIcon': { CryptoIcon: ({symbol}:any) => React.createElement('i', {'data-logo':symbol}) },
  'react-router-dom': { Link: ({to,children,...props}:any) => React.createElement('a', {...props,href:to}, children) },
});
const now = Date.UTC(2026, 8, 12, 12, 0, 0);
const makeMarket = () => ({
  tickers: Array.from({length:14},(_,i)=>({pair:`${i?'COIN'+i:'BTC'}/USDT`,base:i?'COIN'+i:'BTC',quote:'USDT',price:100+i,high:120+i,low:90+i,change:i,quoteVolume:100000-i})),
  tickerSource:'kraken',tickersStale:false,logoOf:()=>undefined,
  hero: {pair:'BTC/USDT',streaming:true,stale:false,livePrice:100,updatedAt:now,
    bookStatus:'ok',tradesStatus:'ok',candlesStatus:'ok',
    book:{timestamp:now,bids:Array.from({length:12},(_,i)=>({price:String(99-i),quantity:'2'})),asks:Array.from({length:12},(_,i)=>({price:String(101+i),quantity:'1'}))},
    candles:[{time:now/1000,open:98,high:103,low:97,close:100,volume:10}],
    trades:Array.from({length:8},(_,i)=>({id:String(i),time:now-i*1000,side:i%2?'SELL':'BUY',price:String(100+i),quantity:'0.12345'})),
  },
});
const render = (market:any) => renderToStaticMarkup(React.createElement(SapphireTerminal,{market}));
test('dense screen renders real summary, 12 market logos, 20 depth levels and six public executions',()=>{
  const html=render(makeMarket());
  expect(html.match(/class="pair"/g)).toHaveLength(12);
  expect(html.match(/data-logo=/g)).toHaveLength(13);
  expect(html.match(/class="book-row ask"/g)).toHaveLength(10);
  expect(html.match(/class="book-row bid"/g)).toHaveLength(10);
  expect(html.match(/class="hs-trade-row"/g)).toHaveLength(6);
  expect(html).toContain('Buy 66.7%'); expect(html).toContain('Sell 33.3%');
  expect(html).toContain('width:50%'); expect(html).toContain('width:100%');
  expect(html).toContain('24h High'); expect(html).toContain('24h Volume (USDT)');
  expect(html).toContain('12:00:00'); expect(html).toContain('0.12345');
  expect(html).not.toMatch(/<form|<input|NaN|Infinity|undefined/);
});
test('received updates change chart, depth, public trades and receipt timestamp',()=>{
  const market=makeMarket(), before=render(market);
  market.hero.livePrice=102; market.hero.book.timestamp=now+2000;
  market.hero.book.bids[0].quantity='4';market.hero.trades[0].price='102.50';
  const after=render(market);
  expect(after).not.toBe(before);expect(after).toContain('data-price="102"');
  expect(after).toContain('12:00:02');expect(after).toContain('102.50');
  expect(after).toContain('Buy 68.8%');expect(after).toContain('width:25%');
});
test('missing and invalid data remains unavailable with no synthetic prices or activity',()=>{
  const market:any=makeMarket();market.tickers=[];market.tickersStale=true;
  market.hero={...market.hero,streaming:false,livePrice:null,candles:[],updatedAt:null,book:{bids:[{price:'NaN',quantity:'Infinity'}],asks:[{price:'',quantity:''}]},trades:[{time:now,price:'0',quantity:'1',side:'BUY'}]};
  const html=render(market);
  expect(html).toContain('data-stale="true"'); expect(html).toContain('Data unavailable');
  expect(html).toContain('Buy —');expect(html).toContain('Updated — UTC');
  expect(html).not.toMatch(/class="book-row|class="hs-trade-row|data-chart-count|NaN|Infinity|undefined|>0\.00</);
});
test('trade links retain selected pair and have no execution or account controls',()=>{
  const market=makeMarket();market.hero.pair='ETH/USDT';
  const html=render(market), order=html.match(/<aside class="ts-order"[\s\S]*?<\/aside>/)?.[0]??'';
  expect(order.match(/href="\/trade\?pair=ETH%2FUSDT"/g)).toHaveLength(3);
  expect(order).not.toMatch(/<form|<input|side=|balance|account/i);
});