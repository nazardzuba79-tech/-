export const REVIEW_UNAVAILABLE = 'Visual review only: account data and API actions are unavailable. Do not enter production credentials.';

/** The only allowed sample is a generated, explicitly synthetic public file. */
export function reviewReadPath(path: string, method = 'GET'): string | null {
  if (method.toUpperCase() === 'GET' && ['/copy-trading/identities', '/copy-trading/ksenia'].includes(path)) return '/review-api' + path;
  return method.toUpperCase() === 'GET' && path === '/copy-trading/synthetic'
    ? '/review-synthetic.json'
    : null;
}
