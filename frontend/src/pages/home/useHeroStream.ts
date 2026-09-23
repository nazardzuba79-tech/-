import type { HomeMarket } from './useHomeMarket';
import { useSampledMotion } from '../../components/SampledDataNote';

/** Owner-approved decorative preview: retain the real six-hour homepage snapshot.
 * No socket, invented candle, price tick or new trade is generated here.
 */
export function useHeroStream(market: HomeMarket): HomeMarket {
  useSampledMotion();
  return market;
}
