import type { LiquidationEngine } from './futures/LiquidationEngine';
import type { FuturesProtectionService } from './futures/FuturesProtectionService';
import type { CfdLiquidationEngine } from './cfd/CfdLiquidationEngine';
import type { PriceWatcherService } from './services/PriceWatcherService';
import type { PrivateTradingService } from './private-trading/service';
import type { NativeLimitPass } from './private-trading/native/limitPass';
import type { IdleSleepOptions } from './services/IdleBackoffScheduler';
import { BackgroundWorkCoordinator, type BackgroundWorkCoordinatorOptions, type SleepingWatcher } from './services/BackgroundWorkCoordinator';
import { PRICE_WATCHER_CHECK_INTERVAL_MS, WATCHER_SLEEP_GRACE_MS } from './config/limits';

/** The database-touching background loops, as index.ts constructs them. */
export interface ServerBackgroundParts {
  futuresMarketRegistry: { start(): void; stop(): void };
  fundingRateService: { startScheduler(): void; stopScheduler(): void };
  liquidationEngine: LiquidationEngine;
  futuresProtectionService: FuturesProtectionService;
  cfdLiquidationEngine: CfdLiquidationEngine;
  priceWatcherService: PriceWatcherService;
  privateTradingService: PrivateTradingService;
  nativeLimitPass: NativeLimitPass | null;
}

export interface ServerBackgroundOptions {
  /** Sleep options for every sweep; `null` keeps them polling (backoff only). */
  sleep?: IdleSleepOptions | null;
  coordinator?: BackgroundWorkCoordinatorOptions;
}

/**
 * Starts the backend's background loops in their established order, with
 * sleep-when-empty on every sweep that watches a table (see
 * IdleBackoffScheduler) and the BackgroundWorkCoordinator safety net over
 * them. index.ts runs this; the idle database budget test runs the very
 * same function, so what it measures is what production starts.
 *
 * Start-up recovery is each sweep's first pass: one scan of its table a
 * base interval after start. Work that survived a restart is found there
 * (and on every pass of the grace window), with no event needed.
 */
export function createServerBackground(parts: ServerBackgroundParts, options: ServerBackgroundOptions = {}) {
  const sleep = options.sleep === null ? undefined : (options.sleep ?? { graceMs: WATCHER_SLEEP_GRACE_MS });
  const watchers: SleepingWatcher[] = [
    watcher('futures-liquidation', parts.liquidationEngine),
    watcher('futures-protection', parts.futuresProtectionService),
    watcher('cfd-liquidation', parts.cfdLiquidationEngine),
    watcher('spot-conditional', parts.priceWatcherService),
    watcher('private-owner-pass', parts.privateTradingService),
    ...(parts.nativeLimitPass ? [watcher('native-limit-pass', parts.nativeLimitPass)] : []),
  ];
  const coordinator = new BackgroundWorkCoordinator(watchers, options.coordinator);
  return {
    coordinator,
    /** Express middleware that reports successful writes to the coordinator. */
    activityMiddleware: () => coordinator.middleware(),
    start() {
      parts.futuresMarketRegistry.start();
      parts.fundingRateService.startScheduler();
      parts.liquidationEngine.startScheduler(undefined, { sleep });
      parts.futuresProtectionService.startScheduler(undefined, { sleep });
      parts.cfdLiquidationEngine.startScheduler(undefined, { sleep });
      parts.priceWatcherService.startScheduler(PRICE_WATCHER_CHECK_INTERVAL_MS, { sleep });
      parts.privateTradingService.start({ sleep });
      parts.nativeLimitPass?.start({ sleep });
      coordinator.start();
    },
    async stop() {
      coordinator.stop();
      parts.futuresMarketRegistry.stop();
      parts.fundingRateService.stopScheduler();
      parts.liquidationEngine.stopScheduler();
      parts.futuresProtectionService.stopScheduler();
      parts.cfdLiquidationEngine.stopScheduler();
      parts.priceWatcherService.stopScheduler();
      parts.privateTradingService.stop();
      await parts.nativeLimitPass?.stop();
    },
  };
}

function watcher(name: string, loop: { readonly asleep: boolean; nudge(): void }): SleepingWatcher {
  return { name, get asleep() { return loop.asleep; }, nudge: () => loop.nudge() };
}
