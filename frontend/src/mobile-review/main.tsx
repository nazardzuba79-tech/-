import { assertReviewOrigin, lockReviewTransport } from './policy';
import { reviewMessages } from './messages';

let originAllowed = false;
try {
  assertReviewOrigin(location);
  originAllowed = true;
  lockReviewTransport();
  // Import AFTER the transport guard; no production App, auth bootstrap or SupportWidget.
  void import('./mount').then(module => module.mount()).catch(() => {
    document.getElementById('root')!.textContent = reviewMessages.loadFailure;
  });
} catch {
  document.getElementById('root')!.textContent = originAllowed ? reviewMessages.guardFailure : reviewMessages.originBlocked;
}
