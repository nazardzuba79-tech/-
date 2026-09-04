export type Asset = 'BTC' | 'ETH' | 'SOL' | 'XRP'
export type ExchangeKey = 'binance' | 'bybit' | 'okx' | 'deribit' | 'bitget'
export type ZoomKey = '±2%' | '±4%' | '±6%' | 'GLOBAL'
export type PeriodKey = '4Ч' | '12Ч' | '24Ч' | '3Д'
type ZoneType = 'wall' | 'cluster' | 'void'
export const EXCHANGE_KEYS: ExchangeKey[] = ['binance', 'bybit', 'okx', 'deribit', 'bitget']
export const EXCHANGE_LABEL: Record<ExchangeKey, string> = { binance: 'Binance', bybit: 'Bybit', okx: 'OKX', deribit: 'Deribit', bitget: 'Bitget' }
export const EXCHANGE_COLOR: Record<ExchangeKey, string> = { binance: '#d9a531', bybit: '#c96b4a', okx: '#4f83b0', deribit: '#5f9c82', bitget: '#8b7fb0' }
const EXCHANGE_BASE: Record<ExchangeKey, number> = { binance: 1.0, bybit: 0.85, okx: 0.75, deribit: 0.55, bitget: 0.6 }

interface Feature { offsetPct: number; widthPct: number; amp: number; shape: 'spike' | 'cluster' | 'shelf'; side: number; exch: Partial<Record<ExchangeKey, number>> }
interface VoidZone { fromPct: number; toPct: number; factor: number }
interface AssetConfig { bucketCount: number; defaultRangePct: number; volumeScale: number; features: Feature[]; voids: VoidZone[] }

const ASSET_CONFIG: Record<Asset, AssetConfig> = {
  BTC: {
    bucketCount: 220,
    defaultRangePct: 4,
    volumeScale: 3.1e6,
    features: [
      { offsetPct: -4.6, widthPct: 0.6, amp: 20, shape: 'cluster', side: 0.55, exch: { deribit: 2.0, binance: 1.0 } },
      { offsetPct: -2.05, widthPct: 0.18, amp: 52, shape: 'spike', side: 0.8, exch: { binance: 2.2, bybit: 1.6 } },
      { offsetPct: -0.85, widthPct: 0.5, amp: 16, shape: 'cluster', side: 0.3, exch: { bybit: 1.4, okx: 0.9 } },
      { offsetPct: 1.35, widthPct: 0.22, amp: 38, shape: 'spike', side: -0.85, exch: { bitget: 2.4, deribit: 1.1 } },
      { offsetPct: 3.4, widthPct: 0.9, amp: 13, shape: 'shelf', side: -0.35, exch: { okx: 1.8, deribit: 1.3 } },
      { offsetPct: 5.8, widthPct: 1.4, amp: 9, shape: 'shelf', side: -0.25, exch: { binance: 1.1, bitget: 1.0 } },
    ],
    voids: [
      { fromPct: -3.7, toPct: -2.9, factor: 0.05 },
      { fromPct: -1.6, toPct: -1.1, factor: 0.05 },
      { fromPct: 0.05, toPct: 0.55, factor: 0.07 },
      { fromPct: 2.0, toPct: 2.7, factor: 0.06 },
      { fromPct: 4.2, toPct: 5.0, factor: 0.07 },
    ],
  },
  ETH: {
    bucketCount: 200,
    defaultRangePct: 4.5,
    volumeScale: 1.4e6,
    features: [
      { offsetPct: -5.6, widthPct: 1.3, amp: 9, shape: 'shelf', side: 0.4, exch: { bybit: 1.3, binance: 1.0 } },
      { offsetPct: -3.1, widthPct: 0.6, amp: 24, shape: 'cluster', side: 0.6, exch: { binance: 2.0, okx: 1.2 } },
      { offsetPct: -1.4, widthPct: 0.16, amp: 48, shape: 'spike', side: 0.85, exch: { bybit: 2.3, deribit: 1.0 } },
      { offsetPct: 0.6, widthPct: 0.3, amp: 14, shape: 'cluster', side: -0.2, exch: { okx: 1.5, bitget: 1.1 } },
      { offsetPct: 2.2, widthPct: 0.2, amp: 33, shape: 'spike', side: -0.8, exch: { deribit: 2.1, bitget: 1.4 } },
      { offsetPct: 4.0, widthPct: 1.1, amp: 11, shape: 'shelf', side: -0.3, exch: { binance: 1.2, okx: 1.0 } },
    ],
    voids: [
      { fromPct: -4.6, toPct: -3.9, factor: 0.06 },
      { fromPct: -2.6, toPct: -1.9, factor: 0.05 },
      { fromPct: -0.7, toPct: 0.05, factor: 0.07 },
      { fromPct: 1.05, toPct: 1.75, factor: 0.06 },
      { fromPct: 2.8, toPct: 3.5, factor: 0.07 },
    ],
  },
  SOL: {
    bucketCount: 180,
    defaultRangePct: 5,
    volumeScale: 0.62e6,
    features: [
      { offsetPct: -6.2, widthPct: 1.5, amp: 8, shape: 'shelf', side: -0.2, exch: { bitget: 1.1, bybit: 1.0 } },
      { offsetPct: -4.0, widthPct: 0.7, amp: 19, shape: 'cluster', side: 0.5, exch: { binance: 1.8, bybit: 1.3 } },
      { offsetPct: -2.1, widthPct: 0.18, amp: 44, shape: 'spike', side: 0.82, exch: { okx: 2.2, binance: 1.1 } },
      { offsetPct: -0.6, widthPct: 0.28, amp: 13, shape: 'cluster', side: 0.1, exch: { bybit: 1.4, deribit: 0.9 } },
      { offsetPct: 1.1, widthPct: 0.2, amp: 30, shape: 'spike', side: -0.75, exch: { bitget: 2.0, deribit: 1.2 } },
      { offsetPct: 3.3, widthPct: 1.0, amp: 12, shape: 'shelf', side: -0.4, exch: { okx: 1.5, binance: 1.0 } },
    ],
    voids: [
      { fromPct: -5.3, toPct: -4.6, factor: 0.06 },
      { fromPct: -3.3, toPct: -2.6, factor: 0.05 },
      { fromPct: -1.5, toPct: -0.95, factor: 0.07 },
      { fromPct: 0.15, toPct: 0.65, factor: 0.06 },
      { fromPct: 1.8, toPct: 2.6, factor: 0.07 },
    ],
  },
  XRP: {
    bucketCount: 180,
    defaultRangePct: 5,
    volumeScale: 0.18e6,
    features: [
      { offsetPct: -5.6, widthPct: 1.2, amp: 7, shape: 'shelf', side: 0.3, exch: { bybit: 1.0, binance: 0.9 } },
      { offsetPct: -3.4, widthPct: 0.6, amp: 14, shape: 'cluster', side: 0.35, exch: { binance: 1.5, okx: 1.2 } },
      { offsetPct: -1.7, widthPct: 0.2, amp: 30, shape: 'spike', side: 0.6, exch: { bybit: 1.8, binance: 1.1 } },
      { offsetPct: 0.4, widthPct: 0.25, amp: 12, shape: 'cluster', side: -0.3, exch: { okx: 1.3, bitget: 1.0 } },
      { offsetPct: 1.9, widthPct: 0.18, amp: 40, shape: 'spike', side: -0.88, exch: { deribit: 2.3, bitget: 1.5 } },
      { offsetPct: 4.0, widthPct: 1.2, amp: 16, shape: 'shelf', side: -0.5, exch: { deribit: 1.6, okx: 1.1 } },
    ],
    voids: [
      { fromPct: -4.7, toPct: -4.0, factor: 0.06 },
      { fromPct: -2.9, toPct: -2.2, factor: 0.05 },
      { fromPct: -1.1, toPct: -0.2, factor: 0.07 },
      { fromPct: 0.9, toPct: 1.4, factor: 0.06 },
      { fromPct: 2.5, toPct: 3.3, factor: 0.07 },
    ],
  },
}

export const ZOOM_OPTIONS: ZoomKey[] = ['±2%', '±4%', '±6%', 'GLOBAL']
export const PERIOD_OPTIONS: PeriodKey[] = ['4Ч', '12Ч', '24Ч', '3Д']
const PERIOD_PROFILE: Record<PeriodKey, { microMult: number; farMult: number; extra: number; noise: number }> = {
  '4Ч': { microMult: 1.5, farMult: 0.45, extra: 2, noise: 0.7 },
  '12Ч': { microMult: 1.15, farMult: 0.8, extra: 3, noise: 0.85 },
  '24Ч': { microMult: 1, farMult: 1, extra: 4, noise: 1 },
  '3Д': { microMult: 0.8, farMult: 1.35, extra: 6, noise: 1.15 },
}
const NEAR_THRESHOLD_PCT = 1.5

interface Bucket { price: number; pct: number; total: number; exch: Record<ExchangeKey, number>; longLiq: number; shortLiq: number }

function hashSeed(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h) || 1
}
function makeRng(seed: number) {
  let s = seed
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
}
function shapeContribution(distPct: number, f: Feature): number {
  const d = distPct / f.widthPct
  if (f.shape === 'spike') return f.amp * Math.exp(-(d * d) * 4.2)
  if (f.shape === 'shelf') {
    const ad = Math.abs(d)
    return ad < 1 ? f.amp * (1 - ad * 0.35) : f.amp * Math.exp(-((ad - 1) ** 2) * 2.2)
  }
  return f.amp * Math.exp(-(d * d) * 1.15)
}

function generateBuckets(asset: Asset, basePrice: number, rangePct: number, period: PeriodKey, resolution?: number) {
  const cfg = ASSET_CONFIG[asset]
  const bucketCount = resolution ?? cfg.bucketCount
  const profile = PERIOD_PROFILE[period]
  const rng = makeRng(hashSeed(asset + period + rangePct.toFixed(2)))
  const min = basePrice * (1 - rangePct / 100)
  const max = basePrice * (1 + rangePct / 100)
  const step = (max - min) / (bucketCount - 1)
  const currentIndex = Math.max(0, Math.min(bucketCount - 1, Math.round((basePrice - min) / step)))

  const extraFeatures: Feature[] = []
  for (let e = 0; e < profile.extra; e++) {
    const offsetPct = (rng() - 0.5) * Math.min(rangePct, 4) * 1.7
    const keys = EXCHANGE_KEYS.filter(() => rng() > 0.55)
    const exch: Partial<Record<ExchangeKey, number>> = {}
    for (const k of keys.length ? keys : [EXCHANGE_KEYS[Math.floor(rng() * EXCHANGE_KEYS.length)]]) exch[k] = 1 + rng() * 1.3
    extraFeatures.push({ offsetPct, widthPct: 0.12 + rng() * 0.22, amp: 6 + rng() * 11, shape: 'spike', side: (rng() - 0.5) * 2, exch })
  }
  const allFeatures = [...cfg.features, ...extraFeatures]

  const buckets: Bucket[] = []
  for (let i = 0; i < bucketCount; i++) {
    const price = min + i * step
    const pct = ((price - basePrice) / basePrice) * 100
    let raw = (0.1 + rng() * 0.2) * profile.noise
    let sideAcc = 0
    let sideWeight = 0
    const exchAcc: Record<ExchangeKey, number> = { binance: 0, bybit: 0, okx: 0, deribit: 0, bitget: 0 }
    for (const f of allFeatures) {
      const dist = pct - f.offsetPct
      if (Math.abs(dist) > f.widthPct * 3.4) continue
      const periodMult = Math.abs(f.offsetPct) <= NEAR_THRESHOLD_PCT ? profile.microMult : profile.farMult
      const contrib = shapeContribution(dist, f) * periodMult
      if (contrib <= 0) continue
      raw += contrib
      sideAcc += f.side * contrib
      sideWeight += contrib
      for (const k of EXCHANGE_KEYS) exchAcc[k] += (f.exch[k] ?? 0.08) * contrib
    }
    if (Math.abs(pct) < NEAR_THRESHOLD_PCT) {
      raw += (rng() * 0.55 - 0.18) * (1 - Math.abs(pct) / NEAR_THRESHOLD_PCT)
    }
    for (const v of cfg.voids) {
      if (pct >= v.fromPct && pct <= v.toPct) raw *= v.factor
    }
    raw = Math.max(0.025, raw)
    const total = raw
    const longShare = sideWeight > 0 ? Math.min(0.95, Math.max(0.05, 0.5 + (sideAcc / sideWeight) * 0.46)) : Math.min(0.6, Math.max(0.4, 0.5 + (rng() - 0.5) * 0.16))
    const baseSum = EXCHANGE_KEYS.reduce((s, k) => s + EXCHANGE_BASE[k], 0)
    const exch = {} as Record<ExchangeKey, number>
    const featSum = EXCHANGE_KEYS.reduce((s, k) => s + exchAcc[k], 0)
    for (const k of EXCHANGE_KEYS) {
      const baselineShare = (EXCHANGE_BASE[k] / baseSum) * 0.18
      const featShare = featSum > 0 ? (exchAcc[k] / featSum) * 0.82 : (EXCHANGE_BASE[k] / baseSum) * 0.82
      exch[k] = total * (baselineShare + featShare)
    }
    buckets.push({ price, pct, total, exch, longLiq: total * longShare, shortLiq: total * (1 - longShare) })
  }
  return { buckets, currentIndex, bucketCount }
}

export function formatPrice(asset: Asset, value: number): string {
  if (asset === 'BTC' || asset === 'ETH') return `$${Math.round(value).toLocaleString('en-US')}`
  if (asset === 'SOL') return `$${value.toFixed(2)}`
  return `$${value.toFixed(4)}`
}
export function formatUsd(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}
export function formatDistance(pct: number): string {
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

interface ZoneGroup { type: ZoneType | 'mixed'; startIdx: number; endIdx: number; peakIdx: number; peakTotal: number; volumeUnits: number; longShare: number }

export function classifyGroups(series: Bucket[], maxTotal: number): ZoneGroup[] {
  if (!series.length || maxTotal <= 0) return []
  const bucketCount = series.length
  const WALL_T = maxTotal * 0.55
  const CLUSTER_T = maxTotal * 0.22
  const VOID_T = maxTotal * 0.065
  const groups: ZoneGroup[] = []
  let i = 0
  while (i < bucketCount) {
    const b = series[i]
    const isElevated = b.total >= CLUSTER_T
    const isVoidStart = b.total <= VOID_T
    let j = i
    if (isElevated) {
      while (j + 1 < bucketCount && series[j + 1].total >= CLUSTER_T) j++
    } else if (isVoidStart) {
      while (j + 1 < bucketCount && series[j + 1].total <= VOID_T) j++
    }
    let peakIdx = i
    let peakTotal = b.total
    let volumeUnits = 0
    let longSum = 0
    for (let k = i; k <= j; k++) {
      const bb = series[k]
      volumeUnits += bb.total
      longSum += bb.longLiq
      if (bb.total > peakTotal) { peakTotal = bb.total; peakIdx = k }
    }
    // classify by the group's PEAK amplitude, not its starting bucket, so a
    // wall reached partway through an ascending group is never mislabeled as a cluster
    const kind: ZoneType | 'mixed' = isElevated ? (peakTotal >= WALL_T ? 'wall' : 'cluster') : isVoidStart ? 'void' : 'mixed'
    groups.push({ type: kind, startIdx: i, endIdx: j, peakIdx, peakTotal, volumeUnits, longShare: volumeUnits > 0 ? longSum / volumeUnits : 0.5 })
    i = j + 1
  }
  return groups
}


export const RANGE_PERCENT: Record<ZoomKey, number> = {'±2%':2,'±4%':4,'±6%':6,GLOBAL:16}
export const DEMO_PRICES: Record<Asset, number> = {BTC:68420, ETH:3511, SOL:184.72, XRP:0.624}
const HOURS: Record<PeriodKey, number> = {'4Ч':4,'12Ч':12,'24Ч':24,'3Д':72}

/** Synthetic reference fixtures only. Values are USD, never provider data. */
export function demoBuckets(asset: Asset, rangePct: number, period: PeriodKey): Bucket[] {
  const count = ASSET_CONFIG[asset].bucketCount
  // Generate one fixed, fine-grained source for the whole ±16% domain.
  // Zoom only crops/rebins that source; it never invents another market or
  // loses volume just because a wider range has larger display buckets.
  const source = generateBuckets(asset, DEMO_PRICES[asset], 16, period, count * 8).buckets
  const scale = ASSET_CONFIG[asset].volumeScale * HOURS[period] / 24 / 20
  const result: Bucket[] = Array.from({length:count},(_,i)=> {
    const pct = -rangePct + 2 * rangePct * i / (count-1)
    return {price:DEMO_PRICES[asset]*(1+pct/100),pct,total:0,longLiq:0,shortLiq:0,exch:{binance:0,bybit:0,okx:0,deribit:0,bitget:0}}
  })
  for (const b of source) {
    if (b.pct < -rangePct - 1e-9 || b.pct > rangePct + 1e-9) continue
    const i = Math.max(0,Math.min(count-1,Math.round((b.pct+rangePct)/(2*rangePct)*(count-1))))
    const target = result[i]
    target.total += b.total*scale
    target.longLiq += b.longLiq*scale
    target.shortLiq += b.shortLiq*scale
    for (const k of EXCHANGE_KEYS) target.exch[k] += b.exch[k]*scale
  }
  return result
}

/** The only filter/aggregation pipeline used by the chart and every summary. */
export function buildLiquidityModel(buckets: Bucket[], exchanges: ExchangeKey[], asset: Asset, basePrice: number, rangePct: number) {
  const selected = new Set(exchanges)
  let runningLong = 0, runningShort = 0
  const series = buckets.map(b => {
    const exch = Object.fromEntries(EXCHANGE_KEYS.map(k=>[k,selected.has(k) ? b.exch[k] : 0])) as Record<ExchangeKey,number>
    const total = Object.values(exch).reduce((s,v)=>s+v,0)
    const ratio = b.total > 0 ? total / b.total : 0
    const longLiq = b.longLiq * ratio, shortLiq = b.shortLiq * ratio
    return {...b,exch,total,longLiq,shortLiq,cumLong:(runningLong += longLiq),cumShort:0}
  })
  for (let i=series.length-1;i>=0;i--) series[i].cumShort = (runningShort += series[i].shortLiq)
  const bucketCount = series.length
  const currentIndex = series.reduce((best,b,i)=> Math.abs(b.price-basePrice)<Math.abs(series[best].price-basePrice) ? i : best,0)
  const maxTotal = Math.max(0,...series.map(b=>b.total))
  const maxCumulative = Math.max(0,runningLong,runningShort)
  const groups = classifyGroups(series,maxTotal)
  const derived = (()=> {
    const totalLong = series.reduce((s, b) => s + b.longLiq, 0)
    const totalShort = series.reduce((s, b) => s + b.shortLiq, 0)
    const longSharePct = totalLong + totalShort > 0 ? (totalLong / (totalLong + totalShort)) * 100 : 50

    const significant = groups.filter((g) => g.type === 'wall' || g.type === 'cluster')
    const voidsWide = groups.filter((g) => g.type === 'void' && g.startIdx > 0 && g.endIdx < bucketCount - 1 && g.endIdx - g.startIdx >= Math.max(2, Math.round(bucketCount * 0.02)))

    const largest = significant.reduce<ZoneGroup | null>((best, g) => (!best || g.peakTotal > best.peakTotal ? g : best), null)
    const nearestAbove = significant.filter((g) => series[g.peakIdx].price > basePrice).sort((a, b) => a.peakIdx - b.peakIdx)[0] ?? null
    const nearestBelow = significant.filter((g) => series[g.peakIdx].price < basePrice).sort((a, b) => b.peakIdx - a.peakIdx)[0] ?? null
    const wallAbove = significant.filter((g) => g.type === 'wall' && series[g.peakIdx].price > basePrice).sort((a, b) => a.peakIdx - b.peakIdx)[0] ?? null
    const wallBelow = significant.filter((g) => g.type === 'wall' && series[g.peakIdx].price < basePrice).sort((a, b) => b.peakIdx - a.peakIdx)[0] ?? null
    const nearestVoid = voidsWide.map((g) => ({ g, dist: g.startIdx <= currentIndex && g.endIdx >= currentIndex ? 0 : Math.min(Math.abs(g.startIdx - currentIndex), Math.abs(g.endIdx - currentIndex)) })).sort((a, b) => a.dist - b.dist)[0] ?? null

    let aboveBand = 0
    let belowBand = 0
    for (const bucket of series) {
      if (Math.abs(bucket.pct) > 2) continue
      if (bucket.price > basePrice) aboveBand += bucket.total
      else if (bucket.price < basePrice) belowBand += bucket.total
    }
    const bandTotal = aboveBand + belowBand
    const balanceAbovePct = bandTotal > 0 ? Math.round((aboveBand / bandTotal) * 100) : 50

    const calloutCandidates = [...significant].sort((a, b) => b.peakTotal - a.peakTotal).slice(0, 10)
    const callouts: { index: number; label: string; up: boolean; group: ZoneGroup }[] = []
    for (const g of calloutCandidates) {
      if (callouts.length >= 6) break
      if (callouts.every((c) => Math.abs(c.index - g.peakIdx) > bucketCount * 0.045)) {
        const isTopWall = g.type === 'wall' && g === largest
        const label = isTopWall
          ? 'Критическая зона'
          : g.type === 'wall'
            ? 'Локальная стена ликвидности'
            : g.longShare > 0.62 ? 'Концентрация Long' : g.longShare < 0.38 ? 'Концентрация Short' : 'Крупный кластер'
        callouts.push({ index: g.peakIdx, label, up: callouts.length % 2 === 0, group: g })
      }
    }
    callouts.sort((a, b) => a.index - b.index)

    const voidLabels = voidsWide
      .sort((a, b) => (b.endIdx - b.startIdx) - (a.endIdx - a.startIdx))
      .slice(0, 3)
      .map((g) => ({ index: Math.round((g.startIdx + g.endIdx) / 2), label: 'Зона низкой ликвидности' }))

    const rankedZones = [...significant, ...voidsWide]
      .sort((a, b) => b.peakTotal - a.peakTotal)
      .slice(0, 8)
      .map((g) => {
        const price = series[g.peakIdx].price
        const distPct = series[g.peakIdx].pct
        const zoneType: string = g.type === 'wall' ? 'Стена ликвидности' : g.type === 'void' ? 'Зона низкой ликвидности' : g.longShare > 0.6 || g.longShare < 0.4 ? 'Локальный кластер' : 'Смешанный кластер'
        const side = g.type === 'void' ? '—' : g.longShare > 0.55 ? 'Long' : g.longShare < 0.45 ? 'Short' : 'Смешанная'
        const density = g.type === 'void' ? 'Низкая плотность' : g.peakTotal >= maxTotal * 0.55 ? 'Критическая плотность' : g.peakTotal >= maxTotal * 0.3 ? 'Высокая плотность' : 'Средняя плотность'
        return { price: formatPrice(asset, price), side, density, volume: formatUsd(g.volumeUnits), distance: formatDistance(distPct), zoneType, sortKey: g.peakTotal }
      })

    return {
      totalLong, totalShort, total: totalLong + totalShort, longSharePct, shortSharePct: 100 - longSharePct,
      largest, nearestAbove, nearestBelow, wallAbove, wallBelow, nearestVoid,
      balanceAbovePct, callouts, voidLabels, rankedZones,
    }

  })()
  return {asset,basePrice,rangePct,series,currentIndex,maxTotal,maxCumulative,bucketCount,groups,derived}
}
export type LiquidityModel = ReturnType<typeof buildLiquidityModel>

export const RISK_WEIGHTS = {oi:0.25,funding:0.20,imbalance:0.15,concentration:0.25,volatility:0.15} as const
export function cascadeRisk(factors: Record<keyof typeof RISK_WEIGHTS, number | null>): number | null {
  if (Object.values(factors).some(v=>v===null || !Number.isFinite(v) || v<0 || v>100)) return null
  return Math.round((Object.keys(RISK_WEIGHTS) as (keyof typeof RISK_WEIGHTS)[]).reduce((sum,k)=>sum+factors[k]!*RISK_WEIGHTS[k],0))
}
