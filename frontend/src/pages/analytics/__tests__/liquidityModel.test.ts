import {buildLiquidityModel, demoBuckets, DEMO_PRICES, EXCHANGE_KEYS, RANGE_PERCENT, PERIOD_OPTIONS, classifyGroups, cascadeRisk, RISK_WEIGHTS, type Asset} from '../liquidityModel';

describe('canonical Analytics liquidity data', () => {
  for (const asset of ['BTC','ETH','SOL','XRP'] as Asset[]) {
    for (const range of [2,4,6,16]) {
      it(`${asset} ±${range}%: correct density, range and timeframe-specific totals`, () => {
        const totals = PERIOD_OPTIONS.map(period => {
          const raw = demoBuckets(asset,range,period);
          const model = buildLiquidityModel(raw,EXCHANGE_KEYS,asset,DEMO_PRICES[asset],range);
          expect(raw).toHaveLength(asset==='BTC'?220:asset==='ETH'?200:180);
          expect(raw[0].pct).toBeCloseTo(-range);
          expect(raw[raw.length-1].pct).toBeCloseTo(range);
          expect(model.derived.total).toBeCloseTo(raw.reduce((s,b)=>s+b.total,0),4);
          expect(model.series.at(-1)!.cumLong).toBeCloseTo(model.derived.totalLong,4);
          expect(model.series[0].cumShort).toBeCloseTo(model.derived.totalShort,4);
          return model.derived.total;
        });
        expect(new Set(totals).size).toBe(4);
      });
    }
  }

  it('applies all 32 exchange combinations to every summary, curve, wall and cluster', () => {
    const raw = demoBuckets('BTC',4,'12Ч');
    for(let mask=0;mask<32;mask++) {
      const exchanges=EXCHANGE_KEYS.filter((_,i)=>mask&(1<<i));
      const m=buildLiquidityModel(raw,exchanges,'BTC',DEMO_PRICES.BTC,4);
      const expected = raw.reduce((s,b)=>s+exchanges.reduce((sum,k)=>sum+b.exch[k],0),0);
      expect(m.derived.total).toBeCloseTo(expected,4);
      expect(m.series.every(b=>EXCHANGE_KEYS.every(k=>exchanges.includes(k)||b.exch[k]===0))).toBe(true);
      expect(m.derived.totalLong+m.derived.totalShort).toBeCloseTo(expected,4);
      for(const g of m.groups) {
        expect(g.volumeUnits).toBeCloseTo(m.series.slice(g.startIdx,g.endIdx+1).reduce((s,b)=>s+b.total,0),4);
        expect(g.peakTotal).toBe(Math.max(...m.series.slice(g.startIdx,g.endIdx+1).map(b=>b.total)));
      }
      const above=m.groups.filter(g=>g.type==='wall'&&g.peakIdx>m.currentIndex).sort((a,b)=>a.peakIdx-b.peakIdx)[0]??null;
      const below=m.groups.filter(g=>g.type==='wall'&&g.peakIdx<m.currentIndex).sort((a,b)=>b.peakIdx-a.peakIdx)[0]??null;
      expect(m.derived.wallAbove).toEqual(above);
      expect(m.derived.wallBelow).toEqual(below);
      if(mask===0) { expect(m.groups).toEqual([]); expect(m.derived.nearestVoid).toBeNull(); expect(m.derived.rankedZones).toEqual([]); }
    }
  });

  it('single-exchange totals add to the all-exchange total, without mutating inputs', () => {
    const raw=demoBuckets('ETH',4,'3Д');
    const before=JSON.stringify(raw);
    const all=buildLiquidityModel(raw,EXCHANGE_KEYS,'ETH',DEMO_PRICES.ETH,4);
    const sums=EXCHANGE_KEYS.map(k=>buildLiquidityModel(raw,[k],'ETH',DEMO_PRICES.ETH,4).derived.total);
    expect(sums.reduce((s,n)=>s+n,0)).toBeCloseTo(all.derived.total,4);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('preserves source volume when zooming out across nested ranges', () => {
    for(const asset of ['BTC','ETH','SOL','XRP'] as Asset[]) {
      for(const period of PERIOD_OPTIONS) {
        const totals=[2,4,6,16].map(range=>demoBuckets(asset,range,period).reduce((sum,b)=>sum+b.total,0));
        for(let i=1;i<totals.length;i++) expect(totals[i]).toBeGreaterThanOrEqual(totals[i-1]);
      }
    }
  });

  it('handles disconnected input without invented walls or voids', () => {
    const m=buildLiquidityModel([],EXCHANGE_KEYS,'BTC',DEMO_PRICES.BTC,4);
    expect(m.derived.total).toBe(0);
    expect(m.groups).toEqual([]);
    expect(m.derived.wallAbove).toBeNull();
    expect(m.derived.wallBelow).toBeNull();
    expect(m.derived.nearestVoid).toBeNull();
  });

  it('recognizes genuinely sparse corridors bounded by denser structures', () => {
    const m=buildLiquidityModel(demoBuckets('BTC',4,'12Ч'),EXCHANGE_KEYS,'BTC',DEMO_PRICES.BTC,4);
    expect(m.derived.nearestVoid).not.toBeNull();
    const g=m.derived.nearestVoid!.g;
    expect(g.startIdx).toBeGreaterThan(0);
    expect(g.endIdx).toBeLessThan(m.series.length-1);
    expect(g.peakTotal).toBeLessThanOrEqual(m.maxTotal*.065);
  });

  it('classifies ascending groups by their peak, and excludes an all-zero series', () => {
    const raw=demoBuckets('BTC',4,'4Ч').slice(0,3).map((b,i)=>({...b,total:[25,70,30][i],longLiq:0}));
    expect(classifyGroups(raw,100)[0].type).toBe('wall');
    expect(classifyGroups(raw.map(b=>({...b,total:0})),0)).toEqual([]);
  });

  it('uses exact percent ranges and the requested cascade weights', () => {
    expect(RANGE_PERCENT).toEqual({'±2%':2,'±4%':4,'±6%':6,GLOBAL:16});
    expect(RISK_WEIGHTS).toEqual({oi:.25,funding:.20,imbalance:.15,concentration:.25,volatility:.15});
    expect(cascadeRisk({oi:100,funding:0,imbalance:0,concentration:0,volatility:0})).toBe(25);
    expect(cascadeRisk({oi:80,funding:70,imbalance:60,concentration:90,volatility:50})).toBe(73);
    expect(cascadeRisk({oi:null,funding:70,imbalance:60,concentration:90,volatility:50})).toBeNull();
    expect(cascadeRisk({oi:NaN,funding:70,imbalance:60,concentration:90,volatility:50})).toBeNull();
  });
});
