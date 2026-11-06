/**
 * Integration-only, default-OFF gates. This test deliberately uses
 * synthetic environment values, never production credentials or balances.
 * Ported unchanged from #605 (review/demo-spot-liquidity-integrated-off-20261023), whose
 * branch-only workflow never runs elsewhere; the switch parsing it pins is unchanged on main.
 */
import { demoSpotEnabled, demoWithdrawalGuardEnabled, demoSpotLedger } from '../demoSpotAccess';
import { demoLiquidityConfig } from '../DemoLiquidity';

describe('combined Demo Spot + Demo Liquidity default-OFF release', () => {
  test('no flags configured: both financial features and new withdrawal guard are disabled', async () => {
    const empty: NodeJS.ProcessEnv = {};
    expect(demoSpotEnabled(empty)).toBe(false);
    expect(demoWithdrawalGuardEnabled(empty)).toBe(false);
    expect(demoLiquidityConfig(empty)).toEqual({ config: null });
    // With flags OFF ledger choice returns the legacy Spot mode without
    // querying balances or changing the financial state.
    const forbidden = new Proxy({}, { get() { throw new Error('DB read on the off path'); } });
    await expect(demoSpotLedger(forbidden as never, 'synthetic-user', false)).resolves.toBe('spot');
  });

  test('only literal true activates; malformed/false/empty flags do not', () => {
    for (const value of ['false','TRUE','1','on','', ' true ']) {
      const env: NodeJS.ProcessEnv = {
        DEMO_SPOT_ENABLED: value,
        DEMO_LIQUIDITY_ENABLED: value,
        DEMO_WITHDRAWAL_GUARD_ENABLED: value,
      };
      expect(demoSpotEnabled(env)).toBe(false);
      expect(demoWithdrawalGuardEnabled(env)).toBe(false);
      expect(demoLiquidityConfig(env).config).toBeNull();
    }
  });

  test('server Demo Spot ON forces the withdrawal guard despite explicit OFF', () => {
    const env: NodeJS.ProcessEnv = {
      DEMO_SPOT_ENABLED: 'true',
      DEMO_WITHDRAWAL_GUARD_ENABLED: 'false',
      DEMO_LIQUIDITY_ENABLED: 'false',
    };
    expect(demoSpotEnabled(env)).toBe(true);
    expect(demoWithdrawalGuardEnabled(env)).toBe(true);
    expect(demoLiquidityConfig(env).config).toBeNull();
  });

  test('demo liquidity ON forces the withdrawal guard even when Demo Spot is OFF', () => {
    const env: NodeJS.ProcessEnv = {
      DEMO_SPOT_ENABLED: 'false',
      DEMO_LIQUIDITY_ENABLED: 'true',
      DEMO_WITHDRAWAL_GUARD_ENABLED: 'false',
    };
    expect(demoSpotEnabled(env)).toBe(false);
    expect(demoWithdrawalGuardEnabled(env)).toBe(true);
    // Invalid liquidity configuration does not silently select any account.
    expect(demoLiquidityConfig(env).config).toBeNull();
    expect(demoLiquidityConfig(env).problem).toBeTruthy();
  });

  test('independent explicit withdrawal guard ON never enables the market maker or Demo Spot', () => {
    const env: NodeJS.ProcessEnv = {
      DEMO_SPOT_ENABLED: 'false',
      DEMO_LIQUIDITY_ENABLED: 'false',
      DEMO_WITHDRAWAL_GUARD_ENABLED: 'true',
    };
    expect(demoSpotEnabled(env)).toBe(false);
    expect(demoLiquidityConfig(env).config).toBeNull();
    expect(demoWithdrawalGuardEnabled(env)).toBe(true);
  });
});
