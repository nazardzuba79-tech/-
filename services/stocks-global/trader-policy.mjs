import { accountId } from './accounts.mjs';
import { check, SimError } from './engine.mjs';

// Operator configuration only; errors never expose configured principal data.
export function twoTraderPolicy(principals) {
  try {
    check(Array.isArray(principals) && principals.length === 2, 'AUTH_CONFIG_INVALID');
    const ids = new Set(principals.map(accountId));
    check(ids.size === 2, 'AUTH_CONFIG_INVALID');
    return principal => ids.has(accountId(principal));
  } catch { throw new SimError('AUTH_CONFIG_INVALID'); }
}

export function configuredTraders(value) {
  try {
    const principals = JSON.parse(value);
    twoTraderPolicy(principals);
    return principals;
  } catch { throw new SimError('AUTH_CONFIG_INVALID'); }
}

// Response only: never funded, persisted, or passed to an order matcher.
export function marketOnlyState(now) {
  return {
    schema: 2, revision: 0, createdAt: now, serverTime: now,
    settings: { feeBps: 0, model: 'observation-cap-1-v1', conversion: 'verified-source-rates' },
    wallets: Object.fromEntries(['USDT', 'USDC'].map(currency => [currency, {
      cash: '0.00000000', reserved: '0.00000000', available: '0.00000000',
    }])),
    orders: [], fills: [], positions: {}, quotes: {},
    realized: { USDT: '0.00000000', USDC: '0.00000000' }, adjustments: [],
  };
}
