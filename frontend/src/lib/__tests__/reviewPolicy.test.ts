import { reviewReadPath } from '../reviewPolicy';

test('review permits only the explicitly synthetic read-only sample', () => {
  expect(reviewReadPath('/copy-trading/synthetic')).toBe('/review-synthetic.json');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    expect(reviewReadPath('/copy-trading/synthetic', method)).toBeNull();
  }
});

test('private reads, authentication, writes and path escapes are denied', () => {
  for (const path of ['/me', '/wallet/overview', '/auth/login', '/auth/register', '/orders', '/withdrawals', '/copy-trading/synthetic/advance', '/copy-trading/synthetic?reset=true', 'https://api.voltextech.net/api/v1/me', '/../me']) {
    expect(reviewReadPath(path)).toBeNull();
    expect(reviewReadPath(path, 'POST')).toBeNull();
  }
});
