// Test-only preload (node --import): in worker threads, Date.now() reads one
// hour behind while an account commit fence is pending, as if the system
// clock were stepped back in the middle of the wait. The main thread is
// untouched. Used by account-commit-fence.test.mjs; never loaded at runtime.
import { isMainThread, workerData } from 'node:worker_threads';

const STEP_BACK_MS = 3600000;
if (!isMainThread) {
  globalThis[Symbol.for('stocks.wallClockStepBack')] = true;
  if (workerData?.fence instanceof SharedArrayBuffer) {
    // Slot 0 holds (sequence<<2)|decision; a pending fence has decision 0.
    const state = new Int32Array(workerData.fence), wall = Date.now;
    Date.now = () => { const slot = Atomics.load(state, 0); return wall() - (slot !== 0 && (slot & 3) === 0 ? STEP_BACK_MS : 0); };
  }
}
