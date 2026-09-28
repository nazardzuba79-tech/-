export interface TelegramWebApp {
  initData: string;
  viewportStableHeight: number;
  colorScheme: string;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  BackButton: { show(): void; hide(): void; onClick(fn: () => void): void; offClick(fn: () => void): void };
  ready(): void; expand(): void; close(): void;
  onEvent(name: string, fn: () => void): void;
  offEvent(name: string, fn: () => void): void;
}

/** Consumes the official window.Telegram.WebApp SDK contract, without loading a remote script. */
export function connectTelegram(app: TelegramWebApp, back: () => void) {
  const update = () => {
    const root = document.documentElement;
    const height = app.viewportStableHeight;
    if (Number.isFinite(height) && height > 0) root.style.setProperty('--tg-height', `${height}px`);
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      const safe = Math.max(0, app.safeAreaInset?.[edge] || 0);
      const content = Math.max(0, app.contentSafeAreaInset?.[edge] || 0);
      root.style.setProperty(`--tg-${edge}`, `${safe + content}px`);
    }
    root.dataset.telegramTheme = app.colorScheme === 'light' ? 'light' : 'dark';
  };
  const events = ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'themeChanged'];
  events.forEach(event => app.onEvent(event, update));
  app.BackButton.onClick(back); app.ready(); app.expand(); update();
  return () => {
    events.forEach(event => app.offEvent(event, update));
    app.BackButton.offClick(back); app.BackButton.hide();
  };
}

export function createMockTelegram(): TelegramWebApp & { emit(name: string): void; back(): void; backVisible: boolean } {
  const handlers = new Map<string, Set<() => void>>();
  const back = new Set<() => void>();
  const app = {
    initData: 'local-fixture-unverified', viewportStableHeight: window.innerHeight, colorScheme: 'dark',
    safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    contentSafeAreaInset: { top: 12, bottom: 12, left: 0, right: 0 },
    backVisible: false,
    ready() {}, expand() {}, close() { window.dispatchEvent(new Event('pagehide')); },
    BackButton: {
      show() { app.backVisible = true; }, hide() { app.backVisible = false; },
      onClick(fn: () => void) { back.add(fn); }, offClick(fn: () => void) { back.delete(fn); },
    },
    onEvent(name: string, fn: () => void) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name)!.add(fn); },
    offEvent(name: string, fn: () => void) { handlers.get(name)?.delete(fn); },
    emit(name: string) { handlers.get(name)?.forEach(fn => fn()); },
    back() { back.forEach(fn => fn()); },
  };
  return app;
}

/** This fixture is an authorization denial. It never represents a verified user. */
export async function mockTelegramLaunch(initData: string) {
  if (initData !== 'local-fixture-unverified') throw new Error('Invalid launch data. Account access is locked.');
  return { status: 'review-only' as const, verifiedIdentity: null, account: null };
}
