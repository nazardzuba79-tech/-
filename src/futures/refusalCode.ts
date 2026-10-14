/**
 * A machine-readable code for the engine's known refusals.
 *
 * The Futures services refuse with plain `Error` sentences (`Insufficient
 * market liquidity for requested quantity`, `Futures self-match is not
 * allowed`), and the order and quick-close routes answered `400 { error }`
 * with that sentence alone. The client shows only sentences it composed
 * itself (lib/futuresOrderErrors reads `body.code`, never `body.error`), so
 * every such refusal reached the trader as the generic «Не удалось закрыть
 * позицию» (2026-10-13 audit: a market close against a thin book).
 *
 * The sentence is unchanged — services and their tests pin it — and only
 * gains a code the client can translate. Unknown refusals get no code and
 * keep falling to the generic line, which is the safe default.
 */
const KNOWN: { match: RegExp; code: string }[] = [
  { match: /^Insufficient market liquidity for requested quantity$/, code: 'INSUFFICIENT_LIQUIDITY' },
  { match: /^Futures self-match is not allowed$/, code: 'SELF_MATCH' },
];

export function futuresRefusalCode(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return KNOWN.find((rule) => rule.match.test(message))?.code;
}

/** The 400 body for a refused order or close: the sentence, plus a code when the refusal is a known one. */
export function futuresRefusalBody(error: unknown): { error: string; code?: string } {
  const message = error instanceof Error ? error.message : String(error);
  const code = futuresRefusalCode(error);
  return code ? { error: message, code } : { error: message };
}
