// Local, public-data-only visual review. Not a production launcher, account,
// PostgreSQL substitute or trading simulator. All financial paths stay OFF.
import { createServer } from '../services/stocks-global/server.mjs';
import { LiveMarketHub } from '../services/stocks-global/live-market.mjs';
import { LIVE_PROVIDERS } from '../services/stocks-global/live-catalog.mjs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
if(!process.argv.includes('--public-read-only')||process.env.NODE_ENV==='production')throw Error('LOCAL_PUBLIC_REVIEW_ONLY');
const hub=new LiveMarketHub({liveVenues:LIVE_PROVIDERS});
const port=Number(process.env.STOCKS_REVIEW_PORT||4484);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('LOCAL_PORT_INVALID');
const app=await createServer({port,financialEnabled:false,hub,autoPoll:false,
  // Mandatory server argument; financialEnabled:false never opens this file.
  dataPath:resolve(tmpdir(),'voltex-live-review-NO-LEDGER-OPENED.json'),
  dist:resolve('frontend/dist')});
console.log(JSON.stringify({url:`http://127.0.0.1:${app.port}/stocks`,financialEnabled:false,mode:'local-public-market-view-only',authentication:'browser-test-session-only; normal production login unchanged'}));
let closing=false;const stop=async()=>{if(closing)return;closing=true;await app.close();hub.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
