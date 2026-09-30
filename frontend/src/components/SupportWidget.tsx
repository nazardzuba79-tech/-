import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, getToken } from '../lib/api';
import { useLanguage, type Key } from '../lib/i18n';
import { onOpenSupportWidget } from '../lib/supportWidget';
import { SUPPORT_ENDPOINT } from '../lib/supportEndpoint';
import {
  SUPPORT_LIMITS, SUPPORT_SUBJECTS, invalidSupportFields, sendSupportRequest, type SupportSubject,
} from '../lib/supportForm';
import './SupportWidget.css';

const SUBJECT_LABEL_KEY: Record<SupportSubject, Key> = {
  TECHNICAL: 'support.subject.TECHNICAL',
  KYC: 'support.subject.KYC',
  CARD: 'support.subject.CARD',
  OTHER: 'support.subject.OTHER',
};

type Phase = 'idle' | 'sending' | 'sent' | 'failed' | 'check';

/**
 * The floating Support button and its form, mounted once globally (see
 * main.tsx) so it is available on every page, the sign-in screen included.
 *
 * A FORM, NOT A CHAT. Send is one POST to the support Worker, which emails
 * the owner; the owner replies from their mailbox to the address typed here.
 * So this component keeps no conversation, reads nothing on mount, runs no
 * timers and polls nothing — idle, it costs nothing anywhere.
 *
 * The only other request it can make is one profile read, and only when a
 * signed-in user opens the form for the first time, to prefill their name and
 * email (which they still see and can change).
 */
export function SupportWidget() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  // Opened from elsewhere in the app — the homepage footer's Contact entry
  // (see lib/supportWidget). This widget lives outside the router, so an
  // event is the only way in.
  useEffect(() => onOpenSupportWidget(() => setOpen(true)), []);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState<SupportSubject>('TECHNICAL');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  // A double click lands before `phase` re-renders the button disabled; the
  // ref makes the second submit a no-op, so one click is one email.
  const sendingRef = useRef(false);
  const prefilledRef = useRef(false);

  useEffect(() => {
    if (!open || prefilledRef.current || !getToken()) return;
    prefilledRef.current = true;
    let cancelled = false;
    api.getMe()
      .then((me) => {
        if (cancelled) return;
        setEmail((current) => current || me.email || '');
        setName((current) => current || me.displayName || '');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  function edited() {
    if (phase === 'sent' || phase === 'failed' || phase === 'check') setPhase('idle');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (sendingRef.current) return;
    const input = { name, email, subject, message, website };
    // Only what the browser's own checks let through (e.g. a name of spaces).
    if (invalidSupportFields(input).length) {
      setPhase('check');
      return;
    }
    sendingRef.current = true;
    setPhase('sending');
    const outcome = await sendSupportRequest(input, { endpoint: SUPPORT_ENDPOINT });
    sendingRef.current = false;
    if (outcome.status === 'sent') {
      setMessage('');
      setPhase('sent');
    } else {
      // The draft stays, so trying again later is one click.
      setPhase('failed');
    }
  }

  const sending = phase === 'sending';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="support-launcher"
        style={styles.launcher}
        aria-label={open ? t('support.close') : t('support.title')}
        aria-expanded={open}
      >
        {open ? <CloseIcon size={20} /> : <HeadsetIcon size={24} />}
      </button>

      {open && (
        <div className="support-panel" role="dialog" aria-label={t('support.title')}>
          <div className="support-panel-header">
            <span className="support-panel-avatar" aria-hidden="true"><HeadsetIcon size={20} /></span>
            <div className="support-panel-heading">
              <div className="support-panel-title">{t('support.title')}</div>
              <div className="support-panel-sub">{t('support.responseTime')}</div>
            </div>
            <button type="button" className="support-panel-close" onClick={() => setOpen(false)} aria-label={t('support.close')}>
              <CloseIcon size={16} />
            </button>
          </div>

          <form className="support-form" onSubmit={handleSubmit}>
            <div className="support-form-body">
              <fieldset className="support-topics">
                <legend>{t('support.formSubject')}</legend>
                <div className="support-topic-grid">
                  {SUPPORT_SUBJECTS.map((s) => (
                    <label key={s} className="support-topic">
                      <input
                        type="radio"
                        name="support-subject"
                        value={s}
                        checked={subject === s}
                        onChange={() => { setSubject(s); edited(); }}
                      />
                      <span>{t(SUBJECT_LABEL_KEY[s])}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="support-row">
              <label className="support-field">
                <span>{t('support.formName')}</span>
                <input
                  required
                  maxLength={SUPPORT_LIMITS.name}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => { setName(e.target.value); edited(); }}
                />
              </label>
              <label className="support-field">
                <span>{t('support.formEmail')}</span>
                <input
                  required
                  type="email"
                  inputMode="email"
                  maxLength={SUPPORT_LIMITS.email}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); edited(); }}
                  aria-describedby="support-email-hint"
                />
              </label>
              </div>
              <small id="support-email-hint" className="support-hint">{t('support.formEmailHint')}</small>
              <label className="support-field">
                <span>{t('support.formMessage')}</span>
                <textarea
                  required
                  maxLength={SUPPORT_LIMITS.message}
                  rows={5}
                  value={message}
                  onChange={(e) => { setMessage(e.target.value); edited(); }}
                  placeholder={t('support.formMessagePlaceholder')}
                />
                <small className="support-count" aria-hidden="true">{message.length} / {SUPPORT_LIMITS.message}</small>
              </label>
              {/* Honeypot: invisible to people and to screen readers, skipped by Tab. */}
              <div className="support-hp" aria-hidden="true">
                <label>
                  Website
                  <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
                </label>
              </div>
            </div>

            <div className="support-form-footer">
              {phase === 'sent' && (
                <div className="support-result support-result-ok" role="status">
                  <CheckIcon />
                  <div><strong>{t('support.formSent')}</strong><span>{t('support.formSentHint')}</span></div>
                </div>
              )}
              {phase === 'failed' && (
                <div className="support-result support-result-error" role="alert"><AlertIcon /><span>{t('support.formFailed')}</span></div>
              )}
              {phase === 'check' && (
                <div className="support-result support-result-error" role="alert"><AlertIcon /><span>{t('support.formCheck')}</span></div>
              )}
              <button type="submit" className="support-submit" disabled={sending}>
                {sending ? t('support.sending') : t('support.send')}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

/** A thin headset, as on the owner's Bybit reference (2026-09-30). */
function HeadsetIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" />
      <rect x="3.5" y="13" width="3.5" height="5.5" rx="1.6" />
      <rect x="17" y="13" width="3.5" height="5.5" rx="1.6" />
      <path d="M18.75 18.5v.25a2.75 2.75 0 0 1-2.75 2.75H13" />
    </svg>
  );
}

function CloseIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="support-result-mark" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.8" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="support-result-mark" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  launcher: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    width: 50,
    height: 50,
    borderRadius: '50%',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
    cursor: 'pointer',
    zIndex: 998,
  },
};
