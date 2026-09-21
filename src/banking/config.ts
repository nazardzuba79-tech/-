import BigNumber from 'bignumber.js';

export type BankingAsset = 'USDT' | 'USDC' | 'BTC' | 'ETH' | 'SOL';
export type BankingProgramId = 'MONTHLY_17_24M' | 'COMPOUND_21_12M';

export interface BankingProgramConfig {
  id: BankingProgramId;
  name: string;
  monthlyRate: string;
  termMonths: number;
  minUsd: string;
  assets: BankingAsset[];
  compound: boolean;
  payoutFrequency: 'MONTHLY' | 'MATURITY';
  lockRule: 'PRINCIPAL_RETURN_UNDEFINED' | 'PRINCIPAL_AND_REWARDS_LOCKED_TO_MATURITY';
  enabled: boolean;
  availableFrom: string | null;
  availableUntil: string | null;
}

export const BANKING_ASSET_STEPS: Record<BankingAsset, string> = {
  USDT: '0.01', USDC: '0.01', BTC: '0.00000001', ETH: '0.00000001', SOL: '0.00000001',
};

// THE PROGRAM IDS ARE FROZEN AND THEY LIE. 'MONTHLY_17_24M' is a 12-month program
// and 'COMPOUND_21_12M' is a 24-month one; the rates in both names are now stale too.
// They are kept exactly as they are because banking_placements.program_id already
// carries these strings for real rows, and renaming a persisted key to make it read
// nicely would orphan every existing placement. They are internal identifiers and are
// never shown to a customer — customer-facing copy comes from `name` and from the
// rate fields below.
//
// The rates here are authoritative for NEW placements ONLY. An existing placement
// accrues at banking_placements.monthly_rate, the snapshot taken when it was opened;
// see placementTerms() in ./math. Changing a number in this file must never move money
// under a contract that was already signed.
export const BANKING_PROGRAMS: readonly BankingProgramConfig[] = [
  {
    id: 'MONTHLY_17_24M', name: 'Ежемесячные выплаты', monthlyRate: '0.12', termMonths: 12,
    minUsd: '2500', assets: ['USDT','USDC','BTC','ETH','SOL'], compound: false,
    payoutFrequency: 'MONTHLY', lockRule: 'PRINCIPAL_RETURN_UNDEFINED', enabled: true,
    availableFrom: null, availableUntil: null,
  },
  {
    id: 'COMPOUND_21_12M', name: 'Накопление', monthlyRate: '0.17', termMonths: 24,
    minUsd: '2500', assets: ['USDT','USDC','BTC','ETH','SOL'], compound: true,
    payoutFrequency: 'MATURITY', lockRule: 'PRINCIPAL_AND_REWARDS_LOCKED_TO_MATURITY', enabled: true,
    availableFrom: null, availableUntil: null,
  },
] as const;

// ANNUAL, not monthly. It shares the digits 0.12 with Program 1's MONTHLY rate purely
// by coincidence, which is exactly why every surface that renders either one must print
// its period word ("в месяц" / "годовых") rather than a bare percentage.
export const VOLTEX_CARD_YIELD = {
  id: 'VOLTEX_CARD_USDT_YIELD', asset: 'USDT' as const, annualRate: '0.12', locked: false,
  basis: 'ACTUAL_AVAILABLE_CARD_BALANCE' as const, enabled: true,
};

export function bankingProgram(id: string): BankingProgramConfig | null {
  return BANKING_PROGRAMS.find(program => program.id === id) ?? null;
}

export function bankingAsset(value: string): BankingAsset | null {
  const asset = value.toUpperCase() as BankingAsset;
  return Object.prototype.hasOwnProperty.call(BANKING_ASSET_STEPS, asset) ? asset : null;
}

export function minimumAssetQuantity(priceUsd: string, asset: BankingAsset, minUsd = '2500'): string {
  const price = new BigNumber(priceUsd), step = new BigNumber(BANKING_ASSET_STEPS[asset]);
  if (!price.isFinite() || !price.isGreaterThan(0)) throw new Error('asset_price_unavailable');
  const decimals = step.decimalPlaces() ?? 0;
  return new BigNumber(minUsd).div(price).div(step).integerValue(BigNumber.ROUND_CEIL).times(step).toFixed(decimals);
}

export function bankingPublicConfig() {
  return {
    programs: BANKING_PROGRAMS,
    assetSteps: BANKING_ASSET_STEPS,
    cardYield: VOLTEX_CARD_YIELD,
    rewardCurrencyRule: 'SAME_AS_DEPOSIT_ASSET' as const,
    usdValuesAreReferenceOnly: true,
  };
}