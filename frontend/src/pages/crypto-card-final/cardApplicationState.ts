export type CardProduct = 'TITANIUM' | 'BLACK_SIGNATURE';

export interface CardEligibility {
  verificationApproved: boolean;
  depositEligible: boolean;
  tradingVolumeEligible: boolean;
  eligible: boolean;
  qualifyingDepositUsd: number;
  qualifyingTradingVolumeUsd: number;
  depositValuationComplete: boolean;
  tradingVolumeValuationComplete: boolean;
}

export interface CardApplicationSnapshot {
  eligibility: CardEligibility;
  application: null | {
    id: string;
    product: CardProduct;
    status: 'SUBMITTED';
    submittedAt: string;
  };
}

export interface CardApplicationClient {
  getCardApplication(): Promise<CardApplicationSnapshot>;
  submitCardApplication(product: CardProduct): Promise<CardApplicationSnapshot>;
}

export type CardApplicationState =
  | { status: 'review' | 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; data: CardApplicationSnapshot; submitting: boolean; error?: unknown };

/** UI selects a state from server decisions; it never computes monetary eligibility. */
export function cardApplicationAction(data: CardApplicationSnapshot) {
  if (data.application) return 'submitted';
  if (!data.eligibility.verificationApproved) return 'verify';
  if (data.eligibility.eligible) return 'apply';
  if (!data.eligibility.depositValuationComplete || !data.eligibility.tradingVolumeValuationComplete) return 'unavailable';
  return 'fund';
}

/** Persisted application only. No local success, fabricated account, or issuing operation. */
export function createCardApplicationController(
  client: CardApplicationClient,
  reviewOnly: boolean,
  onChange: (state: CardApplicationState) => void,
) {
  let state: CardApplicationState = { status: reviewOnly ? 'review' : 'loading' };
  let disposed = false;
  let revision = 0;

  function publish(next: CardApplicationState) {
    if (!disposed) {
      state = next;
      onChange(next);
    }
  }

  async function load() {
    if (disposed || reviewOnly || (state.status === 'ready' && state.submitting)) return;
    const requestRevision = ++revision;
    publish({ status: 'loading' });
    try {
      const data = await client.getCardApplication();
      if (requestRevision === revision) publish({ status: 'ready', data, submitting: false });
    } catch (error) {
      if (requestRevision === revision) publish({ status: 'error', error });
    }
  }

  async function submit(product: CardProduct) {
    if (disposed || reviewOnly || state.status !== 'ready' || state.submitting
      || cardApplicationAction(state.data) !== 'apply') return;
    const data = state.data;
    const requestRevision = ++revision;
    publish({ status: 'ready', data, submitting: true });
    try {
      const result = await client.submitCardApplication(product);
      if (requestRevision === revision) publish({ status: 'ready', data: result, submitting: false });
    } catch (error) {
      // Refresh eligibility after a rejected request: KYC/funds can change while
      // the page is open. A refresh failure must not retain an enabled stale CTA.
      try {
        const fresh = await client.getCardApplication();
        if (requestRevision === revision) publish({ status: 'ready', data: fresh, submitting: false, ...(fresh.application ? {} : { error }) });
      } catch {
        if (requestRevision === revision) publish({ status: 'error', error });
      }
    }
  }

  return { load, submit, dispose() { disposed = true; revision += 1; } };
}
