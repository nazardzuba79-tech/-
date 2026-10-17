import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importHistoricalCsv } from '../../pages/admin/listingHistoricalImport';
import { archiveSelection, coversHistoricalSelection, historicalArchiveInfo,
  HISTORICAL_PRESETS, prepareHistoricalArchive, sha256Text, verifyHistoricalArchive } from '../../pages/admin/historicalArchiveStore';

function csv(hours=2300, start='2018-01-01T00:00:00Z'): string {
  const epoch=Date.parse(start)/1000;
  let price=100;
  return Array.from({length:hours},(_,i)=>{
    const open=price,close=open*(1+(i%3===0?.015:i%3===1?-.009:.002));
    price=close;
    return [epoch+i*3600,open,Math.max(open,close)*1.004,Math.min(open,close)*.996,close,500,12].join(',');
  }).join('\n');
}

describe('offline historical movement library — no bundled prices, no provider calls',()=>{
  test('preset names carry dates and instrument only, never fabricated OHLC',()=>{
    expect(HISTORICAL_PRESETS.map(p=>p.id)).toEqual(expect.arrayContaining([
      'btc-2018-jan','btc-2018-oct','eth-2021-jan','eth-2021-apr','sol-2022-jan'
    ]));
    expect(HISTORICAL_PRESETS.every(p=>p.hours===2160&&!('bars' in p))).toBe(true);
  });

  test('validates every hour of a long source CSV before caching',()=>{
    const source=csv();
    const info=historicalArchiveInfo(source,'BTC/USDT');
    expect(info.firstHour).toBe('2018-01-01T00:00:00.000Z');
    expect(info.hours).toBe(2300);
    expect(info.endExclusive).toBe(new Date(Date.parse('2018-01-01T00:00:00Z')+2300*3600000).toISOString());
    expect(info.byteLength).toBe(new TextEncoder().encode(source).byteLength);
    const lines=source.split('\n');
    lines.splice(1500,1);
    expect(()=>historicalArchiveInfo(lines.join('\n'),'BTC/USDT')).toThrow(/Пропущенный/);
  });

  test('ready-to-select periods require a real matching local archive, with no implied availability',()=>{
    const info=historicalArchiveInfo(csv(2300),'BTC/USDT');
    const archive={source:'BTC/USDT' as const,...info};
    expect(coversHistoricalSelection(archive,'BTC/USDT','2018-01-01',2160)).toBe(true);
    expect(coversHistoricalSelection(archive,'BTC/USDT','2018-04-01',2160)).toBe(false);
    expect(coversHistoricalSelection(archive,'ETH/USDT','2018-01-01',2160)).toBe(false);
    expect(coversHistoricalSelection(archive,'BTC/USDT','2018-02-30',24)).toBe(false);
    expect(coversHistoricalSelection(archive,'BTC/USDT','2018-03-10',2160)).toBe(false);
  });

  test('reusing one archive selects exact 90-day movement with no acceleration or source dollars',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
    Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
    try {
      const history=csv(3000);
      const archive=await prepareHistoricalArchive(history,'BTC/USDT','btc_2018.csv');
      await expect(verifyHistoricalArchive(archive)).resolves.toBeUndefined();
      expect(archive.id).toContain('BTC-USDT:');
      expect(archive.version).toBe(2);
      expect(archive.sha256).toHaveLength(64);
      expect(await sha256Text(history)).toBe(archive.sha256);
      // Price, volume and raw CSV are NOT stored: IndexedDB keeps movement triples only.
      expect(archive.movements).toHaveLength(3000);
      expect(archive).not.toHaveProperty('csv');
      expect(archive).not.toHaveProperty('originalPrices');
      expect(archive.storedBytes).toBeLessThan(archive.byteLength);
      expect(archive.movementDigest).toBe(await sha256Text(JSON.stringify(archive.movements)));
      const selected=archiveSelection(archive,{startDateUtc:'2018-01-15',hours:2160});
      expect(selected.bars).toHaveLength(2160);
      expect(selected.sourceStart).toBe('2018-01-15T00:00:00.000Z');
      expect(selected.provenance).toBe('USER_SUPPLIED_UNVERIFIED');
      expect(selected).toEqual(importHistoricalCsv(history,'BTC/USDT',{startDateUtc:'2018-01-15',hours:2160}));
      expect(JSON.stringify(selected)).not.toMatch(/"volume"|"price"/);
      const changed=archive.movements.map(bar=>[...bar] as [number,number,number]);
      // Tamper the close but leave OHLC valid: SHA-256 must still reject it.
      changed[0][2] += 1;
      await expect(verifyHistoricalArchive({...archive,movements:changed}))
        .rejects.toThrow(/Контрольная сумма/);
      await expect(verifyHistoricalArchive({...archive,movements:archive.movements.slice(1)}))
        .rejects.toThrow(/повреждён/);
    } finally {
      if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);
      else Reflect.deleteProperty(globalThis,'crypto');
    }
  });

  test('the admin preserves existing staged growth, fall and server-side publish block',()=>{
    const root=resolve(__dirname,'../..');
    const editor=readFileSync(resolve(root,'pages/admin/ListingHistoricalEditor.tsx'),'utf8');
    const library=readFileSync(resolve(root,'pages/admin/ListingHistoricalLibrary.tsx'),'utf8');
    const config=readFileSync(resolve(__dirname,'../../../../src/services/listings/listingConfig.ts'),'utf8');
    expect(editor).toContain('appendClip(clip)');
    expect(editor).toContain('<ListingHistoricalLibrary');
    expect(library).toContain('loadHistoricalArchive(id)');
    expect(library).toContain('data-use-historical-preset');
    expect(config).toContain('HISTORICAL_RIGHTS_UNVERIFIED');
  });
});
