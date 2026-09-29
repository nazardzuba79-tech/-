// Local-only review fixture, not imported by the application entrypoint.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../src/lib/i18n';
import { DepositModal as HeaderDeposit } from '../src/components/DepositModal';
import { DepositModal as WalletDeposit } from '../src/pages/wallet-v3/DepositModal';
import '../src/index.css';
import '../src/pages/settings-arctic/tailwind-utilities.css';
import '../src/pages/wallet-v3/wallet.css';

localStorage.setItem('exchange_lang', 'ru');
const evm = '0x' + '1'.repeat(40);
const rails = [
  ['bitcoin','BTC','bitcoin','Bitcoin','Native','bc1q'+'a'.repeat(38)],
  ['ethereum','ETH','ethereum','Ethereum','Native',evm],
  ['tether','USDT','ethereum','Ethereum','ERC-20',evm],
  ['tether','USDT','tron','TRON','TRC-20','T'+'A'.repeat(33)],
  ['usd-coin','USDC','ethereum','Ethereum','ERC-20','0x'+'2'.repeat(40)],
  ['binancecoin','BNB','bsc','BNB Smart Chain','Native',evm],
  ['solana','SOL','solana','Solana','Native','A'.repeat(44)],
  ['polygon-ecosystem-token','POL','polygon','Polygon','Native',evm],
  ['the-open-network','TON','ton','TON','Native','UQ'+'A'.repeat(46)],
];
const entries=rails.map(([assetId,asset,networkId,networkName,standard,address])=>({assetId,asset,networkId,networkName,standard,address,enabled:true,memo:'',memoLabel:'',memoAllowed:true}));
const fixture={entries,requests:[] as string[],fail:false,delayMs:0};
(window as any).__depositFixture=fixture;
const originalFetch=window.fetch.bind(window);
window.fetch=async (input,init)=>{
  const url=String(input);
  if(url.includes('/api/')) {
    fixture.requests.push(url);
    if(url.endsWith('/deposit-catalogue')) {
      if(fixture.delayMs) await new Promise(resolve=>setTimeout(resolve,fixture.delayMs));
      return new Response(JSON.stringify({version:'fixture-1',entries:fixture.entries.filter(e=>e.enabled&&e.address)}),{status:fixture.fail?503:200,headers:{'Content-Type':'application/json'}});
    }
    throw new Error('Unexpected fixture API request: '+url);
  }
  return originalFetch(input,init);
};
function Preview(){
  const [entry,setEntry]=useState<'header'|'wallet'|null>(null);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const update=()=>setRevision(x=>x+1);
    window.addEventListener('qa-parent-render',update);
    return ()=>window.removeEventListener('qa-parent-render',update);
  },[]);
  return <div className="vx-wallet-root" style={{minHeight:'100vh',background:'#f5f6f8',color:'#172033',padding:24}}>
    <h1>VOLTEX · Deposit</h1><p>Локальний preview · тестові адреси, кошти не надсилати</p>
    <div style={{display:'flex',gap:16,flexWrap:'wrap',marginTop:24}}>
      <button onClick={()=>setEntry('header')}>Header Deposit</button>
      <button onClick={()=>setEntry('wallet')}>Wallet Deposit</button>
      <button data-testid="rerender" onClick={()=>setRevision(x=>x+1)}>Re-render {revision}</button>
    </div>
    {entry==='header'&&<HeaderDeposit onClose={()=>setEntry(null)}/>}
    <WalletDeposit open={entry==='wallet'} onClose={()=>setEntry(null)}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Preview/></LanguageProvider>);
