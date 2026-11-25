import type { QuantPresentation } from "../shared/quantPresentation";

// Stable identity of the verified exchange owner. Invitations are explicit account IDs.
const exchangeOwner = "f4ad5a72-a371-4be4-a071-ad47d43e88c1";
export function presentationViewers(invited = process.env.QUANT_PRESENTATION_REVIEWER_IDS ?? "") {
  return new Set([exchangeOwner, ...invited.split(",").map(id => id.trim()).filter(id => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))]);
}
export function examplePresentation(): QuantPresentation {
  return {
    source: "presentation",
    monthlyReturns: [...Array<number>(23).fill(306), 310],
    exampleWinRate: 97.1,
  };
}
