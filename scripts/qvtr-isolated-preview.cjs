/* Offline artifact builder. No network, API, trading registry, timers or credentials. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS,esModuleInterop:true,resolveJsonModule:true}
}).outputText,filename);
const { parseListingConfig } = require('../src/services/listings/listingConfig.ts');
const { IsolatedScenarioJournal } = require('../src/services/listings/isolatedScenarioJournal.ts');
const { qvtrIsolatedCandidate, QVTR_PEAK_AT, QVTR_CORRECTION_END } = require('../src/services/listings/qvtrIsolatedCandidate.ts');
const plan = require('../config/isolated/qvtr-candidate-20261031.json');
const snapshot = require(path.join('../config/isolated',plan.sourceSnapshot));
const effectiveAt = Date.parse(plan.effectiveAt);
const boundaryLabel = new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(effectiveAt);
const html = data => `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QVTR — ізольована модель</title>
<style>*{box-sizing:border-box}body{margin:0;background:#11151c;color:#eef1f5;font:15px system-ui}main{max-width:1440px;margin:auto;padding:24px}h1{font-size:24px}strong{color:#ffd166}.notice{border:1px solid #ffd166;padding:14px;border-radius:8px}button{margin:12px 6px 12px 0;padding:10px 18px;background:#283342;color:white;border:1px solid #657286;border-radius:5px}button[aria-pressed=true]{border-color:#ffd166;color:#ffd166}svg{width:100%;height:60vh;min-height:320px;background:#171e29}p{line-height:1.6}#details{overflow-wrap:anywhere}footer{color:#b2bdcc} @media(max-width:500px){main{padding:12px}h1{font-size:20px}}</style>
<main><h1>QAVENTRA · QVTR/USDT — модельний preview</h1><p class="notice"><strong>ІЗОЛЬОВАНА СИМУЛЯЦІЯ · НЕ ДЛЯ ТОРГІВЛІ</strong><br>Прогнозована траєкторія з контрольними цінами. Це не фактичні угоди, ліквідність або підтверджена дохідність. Застосовано лише до локального журналу.</p>
<p>Ревізія 1 · початок моделі: ${boundaryLabel} Київ (${plan.effectiveAt} UTC). Майбутній anchor обчислено з незмінної моделі v1; він ще не є спостереженою production-ціною.</p>
<p>31.10 20:30 Київ: <strong>0.53830 USDT · +3745%</strong>. Корекція з 01.11 04:00 Київ до <strong>0.32298 USDT · −40%</strong>. Завершення 01.11 20:30 Київ — погоджена контрольна точка.</p>
<nav aria-label="Таймфрейм">${Object.keys(data).map(k=>`<button data-interval="${k}" aria-pressed="${k==='5m'}">${k}</button>`).join('')}</nav><svg viewBox="0 0 1200 600" preserveAspectRatio="none" role="img" aria-label="Модельний свічковий графік QVTR"></svg><p id="details"></p><footer>Snapshot: ${snapshot.publicObservedAt}. Спостережена ціна ${snapshot.lastPrice} USDT. Публічний ринок, ордери та баланси не підключені. Для застосування в іншому середовищі потрібні окреме рішення, свіжа межа й контроль джерела ціни.</footer></main>
<script>const data=${JSON.stringify(data)};const svg=document.querySelector('svg');function draw(k){const rows=data[k];const lo=Math.min(...rows.map(c=>c.low))*.97,hi=Math.max(...rows.map(c=>c.high))*1.03;const y=v=>560-(v-lo)/(hi-lo)*520;const w=1100/rows.length;svg.innerHTML='<text x="25" y="25" fill="#b2bdcc">Ізольована модель · '+k+'</text>'+rows.map((c,i)=>{const x=60+i*w,color=c.close>=c.open?'#3bd49a':'#ff6b7a';return '<line x1="'+x+'" x2="'+x+'" y1="'+y(c.high)+'" y2="'+y(c.low)+'" stroke="'+color+'"/><rect x="'+(x-w*.3)+'" y="'+Math.min(y(c.open),y(c.close))+'" width="'+Math.max(.3,w*.6)+'" height="'+Math.max(.5,Math.abs(y(c.open)-y(c.close)))+'" fill="'+color+'"/>'}).join('');document.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.interval===k)));document.querySelector('#details').textContent=rows.length+' модельних свічок · '+new Date(rows[0].openTime).toISOString()+' — '+new Date(rows.at(-1).openTime).toISOString();}document.querySelectorAll('button').forEach(b=>b.onclick=()=>draw(b.dataset.interval));draw('5m');</script></html>`;
(async()=>{
  if(plan.superseded)throw Error('SUPERSEDED_USE_OBSERVED_NOW_REVIEW');
  const out=path.resolve(process.env.QVTR_PREVIEW_OUT||path.join('artifacts/qvtr-isolated',plan.candidateId));fs.mkdirSync(out,{recursive:true});
  const source=parseListingConfig(snapshot.config);
  if(snapshot.listingId!==plan.expectedListingId||snapshot.activeVersion!==plan.expectedActiveVersion||snapshot.draftRevision!==plan.expectedDraftRevision)throw Error('SOURCE_VERSION_DRIFT');
  const proposal=qvtrIsolatedCandidate(source,effectiveAt);
  const sealed=JSON.parse(fs.readFileSync(path.join('config/isolated',plan.candidateId.replace('qvtr-','qvtr-future-')+'.json'),'utf8'));
  if(sealed.effectiveAt!==effectiveAt||sealed.sourceConfigSha256!==proposal.sourceConfigSha256||sealed.anchor!==proposal.anchor||JSON.stringify(sealed.program)!==JSON.stringify(proposal.program))throw Error('CANDIDATE_DEFINITION_DRIFT');
  // Replay clock belongs only to this sealed offline artifact. Never use it for a live append.
  const journal=new IsolatedScenarioJournal(path.join(out,'journal.jsonl'),source,()=>Date.parse(snapshot.publicObservedAt));
  const before=await journal.history(),data={};
  if(before.length && (before.length!==1 || before[0].effectiveAt!==effectiveAt || JSON.stringify(before[0].program)!==JSON.stringify(proposal.program)))throw Error('CANDIDATE_JOURNAL_MISMATCH');
  const end=QVTR_CORRECTION_END+7*3600000;
  for(const interval of ['1m','5m','15m','1h'])data[interval]=(await journal.preview(end,effectiveAt,interval,before.length?undefined:proposal)).candles;
  if(!before.length)await journal.append({id:'offline-preview-operator',role:'ADMIN'},0,effectiveAt,proposal.program,'Owner-approved QVTR future-boundary candidate and correction completion');
  fs.writeFileSync(path.join(out,'index.html'),html(data));
  fs.writeFileSync(path.join(out,'proposal.json'),JSON.stringify({...proposal,candidateId:plan.candidateId,expectedSource:{listingId:snapshot.listingId,activeVersion:snapshot.activeVersion,draftRevision:snapshot.draftRevision},productionApplicable:false,observedAt:snapshot.publicObservedAt,isolatedApplyDeadline:new Date(effectiveAt-60000).toISOString()},null,2));
  fs.writeFileSync(path.join(out,'series.json'),JSON.stringify(data));
  console.log(JSON.stringify({out,revision:(await journal.history()).length,effectiveAt:new Date(effectiveAt),anchor:proposal.anchor,peakAt:new Date(QVTR_PEAK_AT),peak:.53830,correction:.32298,scope:'ISOLATED_MODEL_ONLY'}));
})().catch(e=>{console.error(e);process.exitCode=1});
