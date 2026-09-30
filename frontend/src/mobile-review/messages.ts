/** Controlled review failures. Raw SDK/import exceptions never become screen text. */
export const reviewMessages = {
  invalidMock: 'Invalid local launch data. Account access is locked.',
  realAuthUnavailable: 'Telegram account access is not enabled in this review. Open the local mock launch to continue.',
  sdkUnavailable: 'Telegram SDK unavailable. Open the local mock launch to review.',
  originBlocked: 'Open this preview from its local review address. Trading is locked.',
  guardFailure: 'Unable to prepare the local review. Trading is locked. Reload to retry.',
  loadFailure: 'Unable to load local review. Trading is locked. Reload to retry.',
} as const;
