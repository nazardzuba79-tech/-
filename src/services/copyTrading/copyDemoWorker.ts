import { CopyDemoService } from './CopyDemoService';

/** One bounded pass at a time; durable pending rows survive process failure.
 * Disabled runtime has no timer/read. No retry can fabricate a new request ID.
 */
export function startCopyDemoWorker(service: CopyDemoService, enabled: () => boolean, report: (error: unknown) => void) {
  let stopped = false, timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    if (stopped || !enabled()) return;
    try { await service.drain(); } catch (error) { report(error); }
    if (!stopped && enabled()) { timer = setTimeout(tick, 2000); timer.unref(); }
  };
  if (enabled()) void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
