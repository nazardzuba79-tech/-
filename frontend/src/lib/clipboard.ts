/**
 * Copy text to the clipboard, or REJECT.
 *
 * `navigator.clipboard` is absent on an insecure origin and on older
 * browsers, and `writeText` rejects when the page is not focused or the
 * permission is refused. 2026-10-13 audit: three Settings «Copy» buttons
 * fired `navigator.clipboard?.writeText(x)` and toasted «Скопировано» without
 * waiting — a refusal surfaced as an unhandled rejection in the console
 * while the user read a success. Callers decide what to say on each
 * outcome; this helper only makes both outcomes reach them.
 */
export function copyToClipboard(text: string): Promise<void> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return Promise.reject(new Error('Clipboard is not available'));
  }
  try {
    return Promise.resolve(clipboard.writeText(text));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error('Clipboard write failed'));
  }
}
