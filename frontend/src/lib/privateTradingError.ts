/**
 * The simulation engine's failure type, in a module of its own.
 *
 * It lives apart from `privateTradingApi.ts` because that module builds a
 * client at import time from `import.meta.env`, which ties it to the Vite
 * build. Anything that only needs to READ a refusal — the terminal's error
 * localizer, and its tests — imports the class from here instead and stays
 * runnable outside a bundler.
 */
export class PrivateTradingError extends Error {
  /**
   * `code` is the server's machine-readable reason and `detail` the limit
   * it names. They travel so the CLIENT can say why in the interface
   * language — the server's own `message` is Russian only, and is kept as
   * the last-resort text for a reason the client has no wording for.
   */
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly detail?: { limit?: string; allowed?: string; actual?: string },
  ) {
    super(message);
    this.name = 'PrivateTradingError';
  }
}
