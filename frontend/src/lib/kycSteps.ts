/**
 * The three verification stages shown above the KYC form.
 *
 * They replace an 8/20/60/100 % bar that was read off the status alone and
 * so measured nothing. Every state here is a fact: whether this form's
 * fields are filled in, whether a document is prepared, and the review state
 * the server reports for the latest application.
 */
export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type KycStepState = 'done' | 'current' | 'todo' | 'failed';

export function kycStepStates(
  status: KycStatus,
  form: { personalFilled: boolean; documentAdded: boolean },
): { personal: KycStepState; document: KycStepState; review: KycStepState } {
  // A submitted application (under review or approved) sent both parts.
  if (status === 'PENDING') return { personal: 'done', document: 'done', review: 'current' };
  if (status === 'APPROVED') return { personal: 'done', document: 'done', review: 'done' };
  const personal: KycStepState = form.personalFilled ? 'done' : 'current';
  const document: KycStepState = form.documentAdded ? 'done' : form.personalFilled ? 'current' : 'todo';
  // A rejection stays visible on the review stage while the form is redone.
  const review: KycStepState = status === 'REJECTED' ? 'failed' : form.personalFilled && form.documentAdded ? 'current' : 'todo';
  return { personal, document, review };
}
