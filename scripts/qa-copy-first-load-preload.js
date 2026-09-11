/* Test-only instrumentation, injected by the loopback QA server before React.
 * Observe actual DOM commits and resource timing; never inject strategy data.
 * No production build imports this file. */
(() => {
  const run = new URL(location.href).searchParams.get('run');
  const report = {run, first:{}, hydrated:{}, firstOrder:null, finalOrder:null, sameCards:true, sameProfile:true, boxes:{}, errors:[], avatar:[], profile:null};
  const cards = new Map();
  let profile;
  const rect = el => {const b=el.getBoundingClientRect();return {x:b.x,y:b.y+scrollY,w:b.width,h:b.height};};
  const sections = el => Object.fromEntries(['.card-topline','.nazara-strategy','.card-return','.card-stats','.card-meta','.card-cta-area'].map(selector=>[selector,el.querySelector(selector) ? rect(el.querySelector(selector)):null]));
  const observe = () => {
    const observedAt = performance.now();
    const els = [...document.querySelectorAll('.trader-card[data-trader-id]')];
    if (els.length && !report.firstOrder) report.firstOrder=els.map(el=>el.dataset.traderId);
    if (els.length) report.finalOrder=els.map(el=>el.dataset.traderId);
    els.forEach(el => {
      const id=el.dataset.traderId;
      if (!cards.has(id)) {cards.set(id,el);report.first[id]=observedAt;report.boxes[id]={before:rect(el),sectionsBefore:sections(el)};}
      if (cards.get(id)!==el) report.sameCards=false;
      if (el.querySelector('.mini-chart-line') && !report.hydrated[id]) {report.hydrated[id]=observedAt;report.boxes[id].after=rect(el);report.boxes[id].sectionsAfter=sections(el);}
      if (!el.querySelector('.mini-chart-line')) report.boxes[id].lastPending=rect(el);
    });
    const p=document.querySelector('.trader-profile-page');
    if(p && !profile) {profile=p;report.profile={opened:performance.now(),hydrated:null,scrollBefore:null,scrollAfter:null};}
    if(p && profile!==p) report.sameProfile=false;
    if(p && !report.profile.hydrated) {
      if(p.querySelector('.profile-chart-line')) {report.profile.hydrated=performance.now();report.profile.scrollAfter=scrollY;}
      else report.profile.scrollBefore=scrollY;
    }
  };
  addEventListener('error', e=>report.errors.push(e.message));
  addEventListener('unhandledrejection', e=>report.errors.push(String(e.reason)));
  addEventListener('DOMContentLoaded',()=> {
    new MutationObserver(observe).observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true,attributes:true});
    document.addEventListener('load',async e=> {
      if(e.target instanceof HTMLImageElement && e.target.closest('.avatar-stack')) {
        const started=performance.now();await e.target.decode();report.avatar.push({loaded:started,decodeMs:performance.now()-started});
      }
    },true);
    observe();
  });
  const publish=()=> {
    observe();
    report.width=innerWidth;
    report.overflow=document.documentElement.scrollWidth>innerWidth;
    report.resources=performance.getEntriesByType('resource').filter(x=>/copy-trading\/marketplace|CopyTradingPage.*\.js/.test(x.name)).map(x=>({name:new URL(x.name).pathname,start:x.startTime,ttfb:x.responseStart-x.requestStart,total:x.duration,bytes:x.decodedBodySize}));
    fetch('/__qa/report/'+encodeURIComponent(run),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
  };
  setTimeout(publish,12500);
  setTimeout(publish,20000);
})();
