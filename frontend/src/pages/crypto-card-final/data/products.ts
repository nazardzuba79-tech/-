/** Approved product terms; never used to determine a user's eligibility. */
export const cardProducts = [
  { id: 'TITANIUM', tone: 'titanium', name: 'VOLTEX Titanium', network: 'Visa', ring: 'gold', cashback: '10–15%', monthlyLimitUsd: 50_000, monthlyLimit: '$50 000', issuance: 0, servicing: 0, subscriptionCompensation: '100%' },
  { id: 'BLACK_SIGNATURE', tone: 'black', name: 'VOLTEX Black Signature', network: 'Mastercard', ring: 'rainbow', cashback: '15–20%', monthlyLimitUsd: 1_000_000, monthlyLimit: '$1 000 000', issuance: 0, servicing: 0, subscriptionCompensation: '100%' },
] as const;
