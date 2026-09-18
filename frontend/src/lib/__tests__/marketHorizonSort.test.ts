import { readFileSync } from 'fs';
import { resolve } from 'path';

const frontend=resolve(__dirname,'../../..');
const read=(p:string)=>readFileSync(resolve(frontend,p),'utf8');

describe('Markets 7d/30d performance columns',()=>{
  test('client sorter has explicit 7d/30d nulls-last branches',()=>{
    const source=read('src/lib/catalogueStore.ts');
    expect(source).toContain("case 'change7d':");
    expect(source).toContain("nullsLast(a.market?.changePercent7d, b.market?.changePercent7d, direction)");
    expect(source).toContain("case 'change30d':");
    expect(source).toContain("nullsLast(a.market?.changePercent30d, b.market?.changePercent30d, direction)");
    // The store still makes only its one catalogue request. A horizon click is
    // a local sort key change, not a new endpoint/provider request.
    expect(source.match(/getAssetCatalogue\(/g)?.length).toBe(1);
  });

  test('table exposes 7d and 30d sortable columns and never derives them from a sparkline',()=>{
    const source=read('src/pages/markets-bolt/CatalogueTable.tsx');
    expect(source).toContain("key: 'change7d'");
    expect(source).toContain("key: 'change30d'");
    expect(source).toContain("labelKey: 'markets.change7d'");
    expect(source).toContain("labelKey: 'markets.change30d'");
    expect(source).toContain('asset.market?.changePercent7d ?? null');
    expect(source).toContain('asset.market?.changePercent30d ?? null');
    expect(source).not.toContain('sparkline');
  });
});
