/**
 * What a chart can do in its context (2026-10-14).
 *
 * One definition for a market + instrument + candle source: which loader
 * serves the instrument's candles, which intervals that source carries as
 * they are, which are built from real lower bars and which cannot be shown
 * at all. Every surface that offers an interval — the quick strip, the full
 * menu and its stars, the phone sheet, the digit shortcuts, a template, a
 * synced pane, a second chart pane, a compared instrument — reads the same
 * answer, so nothing is offered that the source cannot serve, and nothing
 * the source serves is hidden.
 *
 * The native lists live in lib/chartTimeframes (what each source was verified
 * to carry); this module only binds them to an instrument. No network, no DOM:
 * the loaders come in through the context (lib/chartCandleLoaders holds the
 * product's three), so the answer is the same for a test and for the terminal.
 */
import { isTestMarketPair } from './testMarkets';
import {
  CHART_TIMEFRAMES, DEFAULT_CHART_TIMEFRAME, NATIVE_TIMEFRAMES, SOURCE_HAS_VOLUME, SOURCE_RAW_LIMIT, timeframePlan, timeframeSpec,
  type CandleSourceKind, type ChartTimeframe, type TimeframePlan,
} from './chartTimeframes';
import type { ChartCandleLoader } from './chartTrading';

/** Which terminal a chart belongs to. CFD (2026-10-15): metals, energy and FX majors over the display OHLC route. */
export type ChartMarket = 'spot' | 'futures' | 'cfd';

/** The loaders of the product, by source (lib/chartCandleLoaders binds the real ones; tests pass their own). */
export interface CandleLoaderTable {
  futures: ChartCandleLoader;
  spot: ChartCandleLoader;
  testMarket: ChartCandleLoader;
  cfd: ChartCandleLoader;
}

export interface ChartContext {
  market: ChartMarket;
  pair: string;
  loaders: CandleLoaderTable;
  /** The loader the page bound to this chart (a private replay, the test market), when it has one of its own. */
  loader?: ChartCandleLoader | null;
  /** A source the page names explicitly; otherwise it follows from the market and the instrument. */
  source?: CandleSourceKind | null;
}

export interface ChartCapabilities {
  market: ChartMarket;
  pair: string;
  source: CandleSourceKind;
  loader: ChartCandleLoader;
  /** How each catalogue interval is served in this context. */
  plans: Record<ChartTimeframe, TimeframePlan>;
  /** Intervals this context can show (native or derived), in catalogue order. */
  timeframes: ChartTimeframe[];
  /** Intervals the source carries as they are. */
  native: ChartTimeframe[];
  /** The most raw bars one request to the source can return. */
  rawLimit: number;
  /** The bars carry traded volume (false for CFD: no exchange volume exists for an OTC quote). */
  volume: boolean;
}

/** Where an instrument's candles come from: the Futures venue, the CFD display route, the test-market simulation, or the Spot venue. */
export function candleSourceFor(market: ChartMarket, pair: string): CandleSourceKind {
  if (market === 'futures') return 'futures-public';
  if (market === 'cfd') return 'cfd-display';
  return isTestMarketPair(pair) ? 'test-market' : 'spot-public';
}

/**
 * The loader for an instrument. A test pair (VTA, NRX, a managed listing such
 * as AITH) is always the simulation's own loader, whatever the page bound to
 * the main chart; any other Spot pair the public Spot loader; Futures the
 * public Futures loader. `own` is the page's loader for the chart's own
 * instrument (a private replay) and wins for that instrument only.
 */
export function candleLoaderFor(market: ChartMarket, pair: string, loaders: CandleLoaderTable, own?: ChartCandleLoader | null): ChartCandleLoader {
  if (market === 'futures') return own ?? loaders.futures;
  if (market === 'cfd') return own ?? loaders.cfd;
  if (isTestMarketPair(pair)) return loaders.testMarket;
  return own ?? loaders.spot;
}

const planCache = new Map<CandleSourceKind, Record<ChartTimeframe, TimeframePlan>>();
/** The plan of every catalogue interval for a source (pure, so cached per source). */
export function sourcePlans(source: CandleSourceKind): Record<ChartTimeframe, TimeframePlan> {
  let plans = planCache.get(source);
  if (!plans) {
    plans = Object.fromEntries(CHART_TIMEFRAMES.map(tf => [tf, timeframePlan(source, tf)])) as Record<ChartTimeframe, TimeframePlan>;
    planCache.set(source, plans);
  }
  return plans;
}

/** The capabilities of one chart context. */
export function chartCapabilities(context: ChartContext): ChartCapabilities {
  const source = context.source ?? candleSourceFor(context.market, context.pair);
  const plans = sourcePlans(source);
  return {
    market: context.market,
    pair: context.pair,
    source,
    loader: candleLoaderFor(context.market, context.pair, context.loaders, context.loader),
    plans,
    timeframes: CHART_TIMEFRAMES.filter(tf => plans[tf].kind !== 'unavailable'),
    native: [...NATIVE_TIMEFRAMES[source]],
    rawLimit: SOURCE_RAW_LIMIT[source],
    volume: SOURCE_HAS_VOLUME[source],
  };
}

export const timeframeAvailable = (caps: Pick<ChartCapabilities, 'plans'>, tf: ChartTimeframe): boolean => caps.plans[tf].kind !== 'unavailable';

/**
 * The interval to show when `preferred` is asked for in this context: the
 * preference itself when the context serves it, otherwise the nearest
 * available interval (the next longer one first, then the next shorter),
 * then the chart's default, then the first the context has. A context that
 * serves nothing returns the preference unchanged, so the caller can show
 * an honest "unavailable" state instead of guessing.
 */
export function resolveTimeframe(preferred: ChartTimeframe, caps: Pick<ChartCapabilities, 'plans' | 'timeframes'>): ChartTimeframe {
  if (timeframeAvailable(caps, preferred)) return preferred;
  const list = caps.timeframes;
  if (!list.length) return preferred;
  const wanted = timeframeSpec(preferred).seconds;
  const longer = list.filter(tf => timeframeSpec(tf).seconds > wanted).sort((a, b) => timeframeSpec(a).seconds - timeframeSpec(b).seconds)[0];
  if (longer) return longer;
  const shorter = list.filter(tf => timeframeSpec(tf).seconds < wanted).sort((a, b) => timeframeSpec(b).seconds - timeframeSpec(a).seconds)[0];
  if (shorter) return shorter;
  return list.includes(DEFAULT_CHART_TIMEFRAME) ? DEFAULT_CHART_TIMEFRAME : list[0];
}

/** The viewer's quick list as this context can show it — the stored list is never rewritten for a market that lacks an interval. */
export const quickTimeframesFor = (quick: readonly ChartTimeframe[], caps: Pick<ChartCapabilities, 'plans'>): ChartTimeframe[] => quick.filter(tf => timeframeAvailable(caps, tf));
