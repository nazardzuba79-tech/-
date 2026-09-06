export const REVIEW_UNAVAILABLE = 'Visual review only: account data and API actions are unavailable. Do not enter production credentials.';

/** The only allowed sample is a generated, explicitly synthetic public file. */
export function reviewReadPath(path: string, method = 'GET'): string | null {
  if (method.toUpperCase() === 'GET' && /^\/market\/external\/period-references\?pairs=[A-Z0-9%,]+$/i.test(path)) {
    const pairs = new URLSearchParams(path.split('?')[1]).get('pairs')?.split(',') ?? [];
    if (pairs.length > 0 && pairs.length <= 6 && pairs.every(pair => /^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(pair))) return '/review-api' + path;
  }
  if (method.toUpperCase() === 'GET' && ['/copy-trading/identities', '/copy-trading/ksenia'].includes(path)) return '/review-api' + path;
  return method.toUpperCase() === 'GET' && path === '/copy-trading/synthetic'
    ? '/review-synthetic.json'
    : null;
}
