import { Component, type ErrorInfo, type ReactNode } from 'react';
import {
  attemptChunkRecovery, failedModuleUrl, healThenReload, isDynamicImportFailure, recoveryAvailable,
} from '../lib/chunkRecovery';

/** How long «Обновляем страницу…» may stay up before the reload is presumed
 *  not to be coming (blocked, offline, a webview that ignores it). After this
 *  the viewer gets the ordinary card and a button — never an empty screen. */
export const RECOVERY_STALL_MS = 10_000;

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** A stale-shell failure that this shell is still allowed to reload for.
   *  While the reload is on its way the screen says «Обновляем страницу…»
   *  rather than «Что-то пошло не так» — the viewer of a successful recovery
   *  should never see a failure they did not have. It used to render
   *  NOTHING here, which on the app's dark ground is a black page for as long
   *  as the reload takes, and forever if it never comes. */
  recovering: boolean;
}

/**
 * Last-resort catch for a render-time crash — without this, a thrown error
 * anywhere in the tree unmounts the whole app and leaves a blank white
 * page with no explanation. Deliberately a class component: React only
 * supports error boundaries via getDerivedStateFromError/componentDidCatch,
 * there's no hook equivalent.
 *
 * Text is inlined rather than pulled from useLanguage() — a broken render
 * tree is exactly the situation where depending on more app machinery
 * (context providers included) is the wrong bet.
 *
 * ONE CLASS OF FAILURE IS NOT A CRASH AND IS NOT SHOWN.
 *
 * Every route here is a lazy import and every asset is content-hashed, so a
 * tab holding a shell from the previous deployment asks for chunk names the
 * current deployment no longer has. That is not a bug in the page — the page
 * is fine — and it is why the owner's manual «Перезагрузить страницу» always
 * worked. Such a failure is reloaded ONCE, automatically, and only then.
 * See lib/chunkRecovery.ts, which also explains why the guard cannot loop.
 *
 * Everything else — a genuine render exception — behaves exactly as before:
 * the fallback, and a reload only if the viewer asks for one.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, recovering: false };
  private stall: ReturnType<typeof setTimeout> | undefined;

  /** Pure, as React requires: it only READS the guard to decide whether the
   *  viewer should be shown a failure that is about to be reloaded away. The
   *  reload itself is a side effect and lives in componentDidCatch. */
  static getDerivedStateFromError(error: Error): State {
    return { error, recovering: isDynamicImportFailure(error) && recoveryAvailable() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Spends the one attempt and reloads, or returns false and falls through
    // to the ordinary boundary — including on the SECOND identical failure,
    // which is what stops this becoming a loop.
    if (attemptChunkRecovery(error)) {
      if (!this.state.recovering) this.setState({ recovering: true });
      clearTimeout(this.stall);
      this.stall = setTimeout(() => this.setState({ recovering: false }), RECOVERY_STALL_MS);
      return;
    }
    // No reload is coming (budget spent, or no storage to guard one with):
    // the card, not a screen waiting for something that will not happen.
    if (this.state.recovering) this.setState({ recovering: false });
    console.error('Unhandled render error:', error, info.componentStack);
  }

  componentWillUnmount() {
    clearTimeout(this.stall);
  }

  /** The manual reload also replaces a poisoned cached chunk first — a bare
   *  reload would fetch the same broken copy from the browser cache. */
  private reload = () => {
    const url = failedModuleUrl(this.state.error);
    healThenReload(url ? [url] : []);
  };

  render() {
    // A reload is already on its way: a quiet, visible status on the app's
    // own ground, never an empty screen.
    if (this.state.error && this.state.recovering) {
      return (
        <div style={styles.wrap} data-recovering="true" role="status" aria-live="polite">
          <p style={styles.text}>Обновляем страницу…</p>
        </div>
      );
    }
    if (this.state.error) {
      return (
        <div style={styles.wrap}>
          <div style={styles.card}>
            <div style={styles.icon}>⚠</div>
            <h1 style={styles.title}>Что-то пошло не так</h1>
            <p style={styles.text}>
              Произошла непредвиденная ошибка. Попробуй перезагрузить страницу — если это повторится, дай нам знать
              через раздел поддержки.
            </p>
            <button style={styles.button} onClick={this.reload}>
              Перезагрузить страницу
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0b0e11',
    padding: 24,
  },
  card: {
    maxWidth: 420,
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    fontSize: 40,
    color: '#f7a600',
  },
  title: {
    fontFamily: 'Manrope, Inter, sans-serif',
    fontSize: 22,
    fontWeight: 800,
    color: '#eaecef',
    margin: 0,
  },
  text: {
    fontSize: 14,
    lineHeight: 1.6,
    color: '#a3adba',
    margin: 0,
  },
  button: {
    marginTop: 8,
    background: '#f7a600',
    color: '#0b0e11',
    border: 'none',
    borderRadius: 24,
    padding: '12px 28px',
    fontWeight: 800,
    fontSize: 14,
  },
};
