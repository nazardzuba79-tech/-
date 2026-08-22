import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
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
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
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
            <button style={styles.button} onClick={() => window.location.reload()}>
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
