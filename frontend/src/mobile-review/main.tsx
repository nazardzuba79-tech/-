import { assertReviewOrigin, lockReviewTransport } from './policy';

try {
  assertReviewOrigin(location);
  lockReviewTransport();
  // Import AFTER the transport guard; no production App, auth bootstrap or SupportWidget.
  void import('./mount').then(module => module.mount()).catch(() => {
    document.getElementById('root')!.textContent = 'Unable to load local review. Trading is locked. Reload to retry.';
  });
} catch (error) {
  document.getElementById('root')!.textContent = (error as Error).message;
}
