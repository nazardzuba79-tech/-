'use strict';
/** Apply just the reviewed UI hunks to the independently reproduced live Pages source. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..'),target=process.env.AI_PAGES_WORKTREE;
if(!target)throw Error('AI_PAGES_WORKTREE required');
if(cp.execFileSync('git',['rev-parse','HEAD'],{cwd:target,encoding:'utf8'}).trim()!=='13a1bc9b92b6a42f3bac15b085d561bfb05ce5e8')throw Error('Unexpected Pages base');
const read=p=>fs.readFileSync(path.join(target,p),'utf8');
const write=(p,s)=>{fs.mkdirSync(path.dirname(path.join(target,p)),{recursive:true});fs.writeFileSync(path.join(target,p),s)};
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('UI fence not unique: '+a.slice(0,100));return s.replace(a,b)};
const edit=(p,a,b)=>write(p,once(read(p),a,b));
for(const p of ['src/shared/listingSchedule.ts','frontend/src/pages/admin/adminListingsTime.ts','frontend/src/pages/admin/ListingRescheduleDialog.tsx'])write(p,fs.readFileSync(path.join(root,p),'utf8'));
const page='frontend/src/pages/admin/AdminListingsPage.tsx';
edit(page,"import './adminListings.css';","import { canRescheduleListing, ListingRescheduleDialog } from './ListingRescheduleDialog';\nimport './adminListings.css';");
edit(page,'const [deleting, setDeleting] = useState<AdminListing | null>(null);','const [deleting, setDeleting] = useState<AdminListing | null>(null);\n  const [rescheduling, setRescheduling] = useState<AdminListing | null>(null);');
edit(page,'<button type="button" onClick={() => openEdit(listing)} data-edit-listing={listing.draft.symbol}>Изменить</button>',
  '<button type="button" onClick={() => openEdit(listing)} data-edit-listing={listing.draft.symbol}>Изменить</button>\n                  {canRescheduleListing(listing, Date.now() + clockOffsetMs) && <button type="button" disabled={busy} onClick={() => { if (canRescheduleListing(listing, Date.now() + clockOffsetMs)) setRescheduling(listing); else void load(); }} data-reschedule-listing={listing.symbol}>Перенести дату</button>}');
edit(page,'{publishing && (',`{rescheduling && <ListingRescheduleDialog listing={rescheduling} serverOffsetMs={clockOffsetMs} onClose={() => setRescheduling(null)} onSaved={async listingAt => {
        setRescheduling(null); setNotice(\`Дата \${rescheduling.symbol}/USDT перенесена: \${listingTimerLine(listingAt)}.\`);
        if (editing?.id === rescheduling.id) setEditing(null);
        await load();
      }} />}
      {publishing && (`);
const api='frontend/src/pages/admin/adminListingsApi.ts',sourceApi=fs.readFileSync(path.join(root,api),'utf8');
const validation=sourceApi.slice(sourceApi.indexOf("  } else if (valid && path.endsWith('/reschedule'))"),sourceApi.indexOf("  } else if (valid && (init.method === 'POST'"));
edit(api,"  } else if (valid && (init.method === 'POST'",validation+"  } else if (valid && (init.method === 'POST'");
const method=sourceApi.slice(sourceApi.indexOf('  reschedule: (listing:'),sourceApi.indexOf('  list: (signal?:'));
edit(api,'export const adminListingsApi = {','export const adminListingsApi = {\n'+method);
edit(api,'zonedWallTimeToUtc, zoneOffsetMs }','zonedWallTimeToUtc, zoneOffsetMs, shiftListingDate }');
const markets='frontend/src/lib/testMarkets.ts';
edit(markets,'  managed?: boolean;','  provenanceLabel?: string;\n  managed?: boolean;');
edit(markets,'        managed: true,',`        managed: true,
        ...(raw.isTradable === false && raw.provenance?.mode === 'DEMO_MODEL' && raw.provenance?.withdrawable === false
          ? { provenanceLabel: 'DEMO · SIMULATED · NO REAL TRADING' } : {}),`);
const terminal='frontend/src/components/TestMarketTerminal.tsx';
edit(terminal,'      {chart}','      {asset.provenanceLabel && <p role="status" data-demo-provenance>{asset.provenanceLabel}</p>}\n      {chart}');
edit(terminal,'<div className="vta-prelisting-card">','<div className="vta-prelisting-card">\n        {asset?.provenanceLabel && <p role="status" data-demo-provenance>{asset.provenanceLabel}</p>}');
edit('frontend/src/pages/markets-bolt/TestMarketsStrip.tsx','<small>{asset.name}</small>','<small>{asset.name}</small>\n                  {asset.provenanceLabel && <small data-demo-provenance>{asset.provenanceLabel}</small>}');
// Retain the already-published ECLV terminal exception in this older UI.
edit('frontend/src/pages/admin/listingMovementModel.ts',"export interface ListingMovement {","export interface ListingMovement {\n  terminalPeak?: 'bounded-v1';");
edit('frontend/src/pages/admin/listingMovementModel.ts',"const terminalPeak = program.scenario === 'DEEP_RECOVERY'", "const terminalPeak = (program.terminalPeak === 'bounded-v1' && stage === program.stages[program.stages.length - 1] && decimal(stage.targetPrice).isEqualTo(decimal(program.maxPrice))) || program.scenario === 'DEEP_RECOVERY'");
// The original candidate's two narrow search additions, without later History20 code.
const patch=cp.execFileSync('git',['diff','c1f13828c5d398c6792c2a20be551a7132ecf77a','879fd6444a6dff8e3b7264dbdcd05611cdc14010','--',
  'frontend/src/lib/pairList.ts','frontend/src/components/PairListSidebar.tsx'],{cwd:root});
cp.execFileSync('git',['apply','--whitespace=nowarn','-'],{cwd:target,input:patch});
console.log(cp.execFileSync('git',['-c','core.fsmonitor=false','diff','--stat'],{cwd:target,encoding:'utf8'}));
