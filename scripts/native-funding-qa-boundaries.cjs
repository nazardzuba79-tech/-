'use strict';

// QA expectation only. Production funding uses the completed boundary candle.
module.exports = function settledBoundaries(openedAt, heldUntil, observedAt) {
  const interval = 8 * 3_600_000;
  const completedUntil = Math.min(heldUntil, observedAt - 60_000);
  const result = [];
  for (let time = Math.floor(openedAt / interval) * interval + interval; time <= completedUntil; time += interval) result.push(time);
  return result;
};
