from pathlib import Path
manifest=Path('/tmp/sampled-display-changed.txt')
changed=manifest.read_text().splitlines() if manifest.exists() else []
def patch(path,old,new):
 p=Path(path);s=p.read_text()
 if new in s:return
 if s.count(old)!=1:raise RuntimeError('Missing exact visibility anchor: '+path)
 p.write_text(s.replace(old,new,1));changed.append(path)
patch('frontend/src/lib/displaySnapshotCache.ts','this.controller = null; this.schedule(delay);',"this.controller = null; this.schedule(controller.signal.aborted && !this.closed && !(typeof document !== 'undefined' && document.hidden) ? 0 : delay);")
patch('frontend/src/components/CfdChart.tsx','finally{if(controller===request)controller=null;schedule(delay);}', 'finally{if(controller===request)controller=null;schedule(request.signal.aborted&&!cancelled&&!document.hidden?0:delay);}')
patch('frontend/src/lib/sampledDepth.ts','      schedule(DISPLAY_REFRESH_MS);',"      schedule(controller.signal.aborted && !(typeof document !== 'undefined' && document.hidden) ? 0 : DISPLAY_REFRESH_MS);")
p=Path('src/api/routes/__tests__/sampledDisplayBudget.test.ts');s=p.read_text();anchor=" test('depth parser rejects identity swaps, crossed books and malformed amounts',()=>{"
test=""" test('hiding then immediately restoring an in-flight page does not wait another minute',async()=>{
  let calls=0;global.fetch=jest.fn((_url,{signal})=>{
    if(++calls===1)return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
    return Promise.resolve(response(snap({rows:[]})));
  });
  const {SampledMarketSource}=browserModule(),source=new SampledMarketSource('/api/v1/market/display'),seen=jest.fn();
  source.addEventListener('snapshot',seen);await flush();expect(fetch).toHaveBeenCalledTimes(1);
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));
  await flush();await jest.advanceTimersByTimeAsync(1);await flush();
  expect(fetch).toHaveBeenCalledTimes(2);expect(seen).toHaveBeenCalledTimes(1);source.close();
 });
"""
if test not in s:
 if s.count(anchor)!=1:raise RuntimeError('Visibility test anchor missing')
 p.write_text(s.replace(anchor,test+anchor,1));changed.append(str(p))
manifest.write_text('\n'.join(dict.fromkeys(changed)))
print('\n'.join(dict.fromkeys(changed)))
