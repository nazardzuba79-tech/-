'use strict';

/**
 * Browser-fixture only. A hover's silence window must not count a pre-existing
 * periodic refresh as a pointer request. Defer those callbacks until the window
 * closes, without changing their cadence or disabling fetch, events, timeouts,
 * animation frames, or intervals created during the interaction.
 * Standalone so the fixture can serialize it into its bootstrap.
 */
function installHoverIntervalIsolation(scope) {
  const schedule = scope.setInterval.bind(scope);
  const cancel = scope.clearInterval.bind(scope);
  const intervals = new Map();
  let active = null;
  scope.setInterval = (callback, delay, ...args) => {
    if (typeof callback !== 'function') return schedule(callback, delay, ...args);
    const record = { delay, registeredAt: scope.performance.now() };
    const invoke = () => callback.apply(scope, args);
    const id = schedule(() => {
      if (active?.existing.has(id)) {
        active.held.set(id, invoke);
        active.deferred.push({ id, ...record, dueAt: scope.performance.now() });
        return;
      }
      return invoke();
    }, delay);
    intervals.set(id, record);
    if (active) active.created.push({ id, ...record });
    return id;
  };
  scope.clearInterval = id => {
    intervals.delete(id);
    active?.held.delete(id);
    return cancel(id);
  };
  // Self-rescheduling polls (the listings store's 15 s refresh) use one-shot
  // timers, not intervals. A timeout armed before the window is scheduled
  // work, not pointer work: hold it the same way and resume it in end().
  const scheduleOnce = scope.setTimeout.bind(scope);
  const cancelOnce = typeof scope.clearTimeout === 'function' ? scope.clearTimeout.bind(scope) : () => {};
  const timeouts = new Map();
  scope.setTimeout = (callback, delay, ...args) => {
    if (typeof callback !== 'function') return scheduleOnce(callback, delay, ...args);
    const record = { delay, registeredAt: scope.performance.now(), kind: 'timeout' };
    const invoke = () => { timeouts.delete(id); return callback.apply(scope, args); };
    const id = scheduleOnce(() => {
      if (active?.existingTimeouts.has(id)) {
        active.heldTimeouts.set(id, invoke);
        active.deferred.push({ id, ...record, dueAt: scope.performance.now() });
        return;
      }
      return invoke();
    }, delay);
    timeouts.set(id, record);
    return id;
  };
  scope.clearTimeout = id => {
    timeouts.delete(id);
    active?.heldTimeouts.delete(id);
    return cancelOnce(id);
  };
  return {
    begin() {
      if (active) throw new Error('Hover measurement already active');
      active = { existing: new Set(intervals.keys()), held: new Map(), existingTimeouts: new Set(timeouts.keys()), heldTimeouts: new Map(), deferred: [], created: [] };
    },
    end() {
      if (!active) throw new Error('Hover measurement not active');
      const measured = active;
      active = null;
      // Resume outside the assertion window. Coalesce overdue ticks as the
      // browser does after a blocked event loop; never resurrect cleared timers.
      for (const [id, callback] of measured.held) if (intervals.has(id)) callback();
      for (const [id, callback] of measured.heldTimeouts) if (timeouts.has(id)) callback();
      return { deferred: measured.deferred, created: measured.created };
    },
  };
}

module.exports = { installHoverIntervalIsolation };
