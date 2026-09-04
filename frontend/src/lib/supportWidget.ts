/**
 * Opening the support chat from anywhere.
 *
 * SupportWidget is mounted once, globally (see main.tsx), outside the
 * router — so a page cannot reach it through props or context. This is the
 * one hook into it: a DOM event, which the widget listens for while it is
 * mounted. Nothing happens if it isn't, which is the correct outcome for a
 * link that would otherwise have to point at an unrelated page.
 */
const OPEN_EVENT = 'voltex:support-open';

export function openSupportWidget() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function onOpenSupportWidget(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}
