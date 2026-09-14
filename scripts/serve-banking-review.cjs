/**
 * Visual-only browser review for Banking & Earn.
 * Bundles the actual BankingPage React component and its real CSS, but swaps
 * account/API dependencies for explicit preview fixtures. It never connects
 * to production auth, wallet, Banking ledger or order endpoints.
 */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const req = createRequire(path.join(frontend, 'package.json'));
const esbuild = req('esbuild');
const port = Number(process.env.PORT || 4179);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-banking-review-'));

const navMock = path.join(tmp, 'Nav.tsx');
const apiMock = path.join(tmp, 'bankingApi.ts');
fs.writeFileSync(navMock, `
import React from 'react';
export function Nav(){return <header className="review-nav"><div className="review-logo">VOLTEX</div><nav><span>Markets</span><span>Trade</span><span>Futures</span><span className="active">Banking &amp; Earn</span><span>Wallet</span><span>Copy Trading</span><span>Arbitrage</span></nav><div className="review-badge">PREVIEW</div></header>}
`);
fs.writeFileSync(apiMock, `
export const PREVIEW_ONLY=true;
const programs=[
 {id:'MONTHLY_17_24M',name:'Щомісячні виплати',monthlyRate:'0.17',termMonths:24,minUsd:'2500',assets:['USDT','USDC','BTC','ETH','SOL'],compound:false,payoutFrequency:'MONTHLY',lockRule:'PRINCIPAL_RETURN_UNDEFINED',enabled:true,availableFrom:null,availableUntil:null},
 {id:'COMPOUND_21_12M',name:'Накопичення',monthlyRate:'0.21',termMonths:12,minUsd:'2500',assets:['USDT','USDC','BTC','ETH','SOL'],compound:true,payoutFrequency:'MATURITY',lockRule:'PRINCIPAL_AND_REWARDS_LOCKED_TO_MATURITY',enabled:true,availableFrom:null,availableUntil:null}
];
const assets=[
 {asset:'USDT',priceUsd:'1.002',minimumAssetQty:'2495.01'},
 {asset:'USDC',priceUsd:'0.998',minimumAssetQty:'2505.02'},
 {asset:'BTC',priceUsd:'100000',minimumAssetQty:'0.02500000'},
 {asset:'ETH',priceUsd:'2500',minimumAssetQty:'1.00000000'},
 {asset:'SOL',priceUsd:'125',minimumAssetQty:'20.00000000'}
];
const config={programs,assets,rewardCurrencyRule:'SAME_AS_DEPOSIT_ASSET',usdValuesAreReferenceOnly:true,cardYield:{annualRate:'0.12',asset:'USDT',locked:false,availableCardBalance:null,accruedReward:null,dataStatus:'UNAVAILABLE',reason:'PREVIEW_NO_CARD_BALANCE'}};
const state={placements:[],ledger:[],summary:{totalUsd:'0',accruedUsd:'0',activeCount:0},cardYield:config.cardYield};
function addMonths(dateText,n){const d=new Date(dateText+'T00:00:00Z'),day=d.getUTCDate(),target=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1)),last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();return new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),Math.min(day,last))).toISOString().slice(0,10)}
function calc(body){const p=programs.find(x=>x.id===body.programId),a=assets.find(x=>x.asset===body.asset),principal=Number(body.amount),months=body.periodMonths||6,rate=Number(p.monthlyRate),monthly=p.compound?null:principal*rate,balance=p.compound?principal*Math.pow(1+rate,months):principal,rewards=p.compound?balance-principal:monthly*months,end=body.endDate||addMonths(body.startDate,months);return {programId:p.id,asset:body.asset,principal:String(principal),completedMonths:months,startDate:body.startDate,endDate:end,maturityDate:addMonths(body.startDate,p.termMonths),monthlyReward:monthly===null?null:String(monthly),totalRewards:String(rewards),balance:String(balance),profit:String(rewards),priceUsd:a.priceUsd,minimumAssetQty:a.minimumAssetQty,usdEquivalent:String(principal*Number(a.priceUsd)),rewardCurrency:body.asset}}
export const bankingApi={config:async()=>config,state:async()=>state,calculate:async body=>calc(body),createPlacement:async()=>{throw new Error('preview_only')}};
export const bankingNumber=(value,digits=2)=>{if(value===null||value===undefined||value==='')return '—';const n=Number(value);return Number.isFinite(n)?new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n):'—'};
export const bankingErrorText=()=> 'Preview mode: операції з коштами вимкнені.';
`);

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BankingPage } from './pages/BankingPage';
createRoot(document.getElementById('root')).render(<BankingPage/>);
setTimeout(()=>{
  const amount=[...document.querySelectorAll('input')].find(x=>x.getAttribute('placeholder')==='0.00');
  if(amount){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(amount,'2500');amount.dispatchEvent(new Event('input',{bubbles:true}));amount.dispatchEvent(new Event('change',{bubbles:true}));}
},250);
setTimeout(()=>{const buttons=[...document.querySelectorAll('button')];const b=buttons.find(x=>x.textContent.trim()==='Розрахувати'&&!x.disabled);if(b)b.click();},500);
`;

const plugin={name:'banking-review-alias',setup(build){
  build.onResolve({filter:/\.\.\/components\/Nav$/},()=>({path:navMock}));
  build.onResolve({filter:/\.\.\/lib\/bankingApi$/},()=>({path:apiMock}));
}};
const result=esbuild.buildSync({stdin:{contents:entry,resolveDir:path.join(frontend,'src'),sourcefile:'banking-review.tsx',loader:'tsx'},bundle:true,write:false,outdir:tmp,format:'iife',jsx:'automatic',plugins:[plugin]});
const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=result.outputFiles.find(file=>file.path.endsWith('.css'))?.text||'';
const reviewCss=`
html,body,#root{margin:0;min-height:100%;background:#f5f3ee}.review-nav{height:58px;display:flex;align-items:center;gap:28px;padding:0 30px;background:#fffefa;border-bottom:1px solid #deddd5;color:#4f5955;font-family:Arial,Helvetica,sans-serif}.review-logo{font-weight:850;letter-spacing:.12em;font-size:20px;color:#27312e}.review-nav nav{display:flex;gap:25px;align-items:stretch;height:100%}.review-nav nav span{display:flex;align-items:center;position:relative;font-size:12px;white-space:nowrap}.review-nav nav .active{color:#80602d;font-weight:700}.review-nav nav .active:after{content:'';position:absolute;height:2px;left:0;right:0;bottom:0;background:#ad843d}.review-badge{margin-left:auto;border:1px solid #d8c8a4;background:#f6eedc;border-radius:5px;padding:5px 8px;font-size:10px;color:#7f6739;font-weight:700;letter-spacing:.08em}.review-note{position:fixed;z-index:2000;right:18px;bottom:18px;max-width:310px;padding:10px 12px;border-radius:8px;background:#2d312f;color:#f8f4e9;font:11px/1.45 Arial,Helvetica,sans-serif;box-shadow:0 8px 28px #0002}.review-note b{color:#e8cc91}@media(max-width:800px){.review-nav{height:54px;padding:0 16px}.review-nav nav{overflow:auto;gap:16px}.review-nav nav span:nth-child(n+5){display:none}.review-logo{font-size:17px}.review-badge{display:none}.review-note{left:12px;right:12px;bottom:12px;max-width:none}}
`;
const html=`<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>VOLTEX Banking & Earn — Review</title><style>${css}\n${reviewCss}</style></head><body><div id="root"></div><div class="review-note"><b>PREVIEW ONLY</b> · Ізольовані демонстраційні дані. Жодного доступу до реальних балансів, акаунтів чи Banking ledger.</div><script>${js}</script></body></html>`;

const server=http.createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');
  response.setHeader('X-Robots-Tag','noindex, nofollow');
  if(request.url==='/'||request.url==='/banking'||request.url==='/banking/'){
    response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);return;
  }
  if(request.url==='/health'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({status:'ok',preview:true}));return;}
  response.writeHead(404);response.end('Not found');
});
server.listen(port,'0.0.0.0',()=>console.log(`VOLTEX Banking review on :${port}`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
