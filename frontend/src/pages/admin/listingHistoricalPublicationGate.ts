import type { ListingConfig } from './adminListingsApi';

/** UI confirmation only: server-side admission, private SIMUSDT settlement,
 * publication permissions and default-OFF switches remain authoritative. */
export function listingHistoricalPublicationBlocked(config: Pick<ListingConfig, 'simulationProgram' | 'privateTest'>): boolean {
  const program = config.simulationProgram;
  if (program?.kind !== 'scenario-controls-v2') return false;
  if (program.afterGrowth === 'historical') return true;
  return program.growth === 'historical-window' && config.privateTest?.settlement !== 'SIMUSDT';
}
