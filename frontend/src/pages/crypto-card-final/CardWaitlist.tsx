import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { localeOf, useLanguage } from '../../lib/i18n';
import { createCardWaitlistController, type CardWaitlistState } from './cardWaitlistState';

/** Real waitlist controls shared by the approved landing and isolated review. */
export function CardWaitlist({ reviewOnly = false }: { reviewOnly?: boolean }) {
  const { t, lang } = useLanguage();
  const [state, setState] = useState<CardWaitlistState>({ status: reviewOnly ? 'review' : 'loading' });
  const controller = useRef<ReturnType<typeof createCardWaitlistController> | null>(null);

  useEffect(() => {
    const next = createCardWaitlistController(api, reviewOnly, setState);
    controller.current = next;
    setState({ status: reviewOnly ? 'review' : 'loading' });
    void next.load();
    return () => {
      next.dispose();
      if (controller.current === next) controller.current = null;
    };
  }, [reviewOnly]);

  const error = state.status === 'error' || state.status === 'ready' ? state.error : undefined;
  const errorText = error instanceof ApiError ? error.message : t('card.joinError');
  const joinedDate = state.status === 'ready' && state.data.joinedAt
    ? new Date(state.data.joinedAt) : null;
  const joinedDateText = joinedDate && Number.isFinite(joinedDate.getTime())
    ? joinedDate.toLocaleDateString(localeOf(lang)) : '';

  return (
    <div style={styles.panel} aria-label="Лист ожидания Crypto Card">
      <p style={styles.notice}>
        Сейчас доступна запись в лист ожидания до запуска карты. Запись не означает выпуск или активацию карты.
      </p>
      {reviewOnly ? (
        <p role="status" style={styles.secondary}>
          Режим визуального просмотра: отправка заявки и проверка аккаунта недоступны. Данные не отправляются.
        </p>
      ) : state.status === 'loading' ? (
        <p role="status" aria-live="polite" style={styles.secondary}>{t('auth.wait')}</p>
      ) : (
        <>
          {error !== undefined && (
            <p role="alert" style={styles.error}>{errorText}</p>
          )}
          {state.status === 'error' ? (
            <button type="button" style={styles.button} onClick={() => void controller.current?.load()}>
              Повторить загрузку
            </button>
          ) : state.status === 'ready' && state.data.joined ? (
            <div role="status" aria-live="polite" style={styles.status}>
              <strong style={styles.success}>{t('card.joinedPrefix')}</strong>
              {joinedDateText && <span style={styles.secondary}>{t('card.joinedSince', { date: joinedDateText })}</span>}
            </div>
          ) : state.status === 'ready' && state.data.kycStatus === 'APPROVED' ? (
            <button
              type="button"
              style={{ ...styles.button, opacity: state.joining ? 0.65 : 1, cursor: state.joining ? 'wait' : 'pointer' }}
              disabled={state.joining}
              aria-busy={state.joining}
              onClick={() => void controller.current?.join()}
            >
              {state.joining ? t('auth.wait') : 'Записаться в лист ожидания'}
            </button>
          ) : state.status === 'ready' ? (
            <div style={styles.status}>
              <span style={styles.secondary}>{t('card.needVerification')}</span>
              <Link to="/settings" style={styles.link}>{t('card.goVerify')}</Link>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: { width: '100%', maxWidth: 680, margin: '24px auto 0', padding: '20px 24px', border: '1px solid #2b2d38', borderRadius: 16, background: '#111218', color: '#f5f5f7', textAlign: 'center', boxSizing: 'border-box' },
  notice: { margin: '0 0 16px', color: '#c6c7d1', fontSize: 13, lineHeight: 1.65 },
  secondary: { margin: 0, color: '#aeb0bd', fontSize: 13, lineHeight: 1.6 },
  status: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  success: { color: '#5bd6a4', fontSize: 15 },
  error: { margin: '0 0 14px', color: '#ff929b', fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere' },
  button: { maxWidth: '100%', border: '1px solid #fff', borderRadius: 999, background: '#fff', color: '#0a0a0b', padding: '12px 20px', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, lineHeight: 1.4, cursor: 'pointer' },
  link: { color: '#e6c878', fontSize: 14, lineHeight: 1.5, textDecoration: 'underline', textUnderlineOffset: 3 },
};
