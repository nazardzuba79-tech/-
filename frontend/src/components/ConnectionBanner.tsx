import { isBrowserInactive, addBrowserActivityListener, removeBrowserActivityListener } from '../lib/browserActivity';
import { useEffect, useRef, useState } from 'react';
import { krakenSocket, SocketStatus } from '../lib/krakenSocket';
import { RECONNECT_GRACE_MS } from '../lib/bookFreshness';

/**
 * How long a connection may be down before anyone is told.
 *
 * This used to be two seconds, which turned the most ordinary action a
 * person takes — leaving the tab and coming back — into a red alarm. A
 * background tab has its timers throttled and its socket closed by the
 * browser, so returning ALWAYS begins with a handshake; announcing that
 * handshake as a lost connection is a false alarm every single time.
 *
 * The grace is now longer than one refresh cycle (see bookFreshness), so a
 * reconnect that completes inside normal operation is silent. What is NOT
 * silent is a connection that is still down afterwards: that is real, and
 * it is still reported, because sitting on data that has stopped arriving
 * without saying so is the worse failure of the two.
 */
const SHOW_AFTER_MS = RECONNECT_GRACE_MS;

export function ConnectionBanner({connected}:{connected?:boolean}={}) {
  const [status, setStatus] = useState<SocketStatus>(krakenSocket.getStatus());
  const [show, setShow] = useState(false);

  const statusRef = useRef<SocketStatus>(status);

  useEffect(() => {
    let timer: number | null = null;
    const clear = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const arm = () => {
      if (timer === null && !isBrowserInactive()) timer = window.setTimeout(() => setShow(true), SHOW_AFTER_MS);
    };
    const update = (s:SocketStatus) => {
      setStatus(s);
      statusRef.current = s;
      if (s === 'connected') {
        clear();
        setShow(false);
      } else {
        arm();
      }
    };
    // Futures supplies the state of its own validated depth stream. Spot
    // continues to observe its socket; never observe an unused connection.
    const unsubscribe = connected === undefined ? krakenSocket.subscribeStatus(update) : () => {};
    if(connected !== undefined)update(connected ? 'connected' : 'connecting');

    // Coming back to the tab restarts the clock, and takes any banner that
    // was raised while nobody was looking back down. A banner that appeared
    // during a background period describes a connection the browser itself
    // suspended; presenting that on return as a live fault is the panic this
    // whole grace exists to stop. If the feed really is still down, the
    // re-armed timer says so in its own time.
    const onVisibility = () => {
      setShow(false);
      clear();
      if (isBrowserInactive()) return;
      if (statusRef.current !== 'connected') arm();
    };
    const hasDocument = typeof document !== 'undefined';
    if (hasDocument) addBrowserActivityListener(onVisibility);

    return () => {
      unsubscribe();
      clear();
      if (hasDocument) removeBrowserActivityListener(onVisibility);
    };
  }, [connected]);

  if (!show) return null;

  // Connection recovery is transport plumbing, not customer-facing copy.
  // Keep a hidden diagnostic marker for QA while the UI stays silent.
  return <span hidden aria-hidden="true" data-connection-state={status} />;
}
