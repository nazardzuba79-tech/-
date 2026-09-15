/** Visual-only review of the actual Copy Trading marketplace components. */
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createRequire}=require('node:module');

const root=path.resolve(__dirname,'..');
const frontend=path.join(root,'frontend');
const req=createRequire(path.join(frontend,'package.json'));
const esbuild=req('esbuild');
const port=Number(process.env.PORT||4182);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'voltex-copy-locked-review-'));

const entry=`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Toaster} from 'sonner';
import {Marketplace,Profile} from ${JSON.stringify(path.join(frontend,'src/pages/copy-trading-bolt/components.tsx'))};
import {nazarTrader} from ${JSON.stringify(path.join(frontend,'src/pages/copy-trading-bolt/traders.ts'))};
import {CopyEligibilityProvider} from ${JSON.stringify(path.join(frontend,'src/pages/copy-trading-bolt/CopyEligibilityContext.tsx'))};
import {FeaturedAvatarProvider} from ${JSON.stringify(path.join(frontend,'src/pages/copy-trading-bolt/FeaturedAvatarContext.tsx'))};
import ${JSON.stringify(path.join(frontend,'src/pages/copy-trading-bolt/CopyTradingBolt.css'))};
import ${JSON.stringify(path.join(frontend,'src/pages/copy-trading-bolt/CopyTradingRefinement.css'))};
import ${JSON.stringify(path.join(frontend,'src/pages/copy-trading-bolt/KseniaReview.css'))};
function App(){
  const[view,setView]=useState('marketplace');
  const[selected,setSelected]=useState(nazarTrader);
  const open=(trader)=>{setSelected(trader);setView('profile');window.scrollTo(0,0)};
  return <div className={'copytrading-bolt-root '+(view==='profile'?'profile-view':'')}>
    <header className="review-nav"><strong>VOLTEX</strong><span>Copy Trading · REVIEW</span><small>изолированный visual preview</small></header>
    <div className="app"><div className="content-wrap">
      <CopyEligibilityProvider depositUsd={100000}>
        <FeaturedAvatarProvider ownerAvatar={null}>
          {view==='marketplace'?<Marketplace onOpen={open}/>:<Profile trader={selected} onBack={()=>setView('marketplace')}/>} 
        </FeaturedAvatarProvider>
      </CopyEligibilityProvider>
    </div></div>
    <Toaster position="top-right" richColors/>
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;

const result=esbuild.buildSync({stdin:{contents:entry,resolveDir:path.join(frontend,'src'),sourcefile:'copy-locked-review.tsx',loader:'tsx'},bundle:true,write:false,outdir:tmp,format:'iife',jsx:'automatic',nodePaths:[path.join(frontend,'node_modules')]});
const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=result.outputFiles.find(file=>file.path.endsWith('.css'))?.text||'';
const reviewCss=`html,body,#root{margin:0;min-height:100%;background:#050607}.review-nav{height:54px;display:flex;align-items:center;gap:22px;padding:0 26px;background:#101216;color:#e9edf2;border-bottom:1px solid #262a30;font:13px Arial,sans-serif;position:sticky;top:0;z-index:999}.review-nav strong{letter-spacing:.13em;font-size:18px}.review-nav span{color:#ff9f1a;font-weight:700}.review-nav small{margin-left:auto;color:#777f8a}`;
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>VOLTEX Copy Trading locked list review</title><style>${css}\n${reviewCss}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
const server=http.createServer((request,response)=>{response.setHeader('Cache-Control','no-store');response.setHeader('X-Robots-Tag','noindex,nofollow');if(request.url==='/'||request.url.startsWith('/copy-trading')){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);return;}if(request.url==='/health'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({status:'ok',preview:true,kind:'copy-locked-list'}));return;}response.writeHead(404);response.end('Not found');});
server.listen(port,'0.0.0.0',()=>console.log(`VOLTEX Copy Trading review on :${port}`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
