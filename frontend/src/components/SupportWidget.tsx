import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, getToken, type SupportConversation, type SupportMessage, type SupportSubject } from '../lib/api';
import { useLanguage, type Key } from '../lib/i18n';

// Guest identity is just this id, kept in localStorage — same anonymous-
// visitor-id trust model Intercom/Zendesk widgets themselves use (see the
// SupportConversation schema comment on the backend). A logged-in user
// instead resumes their account-tied conversation via /support/conversations/mine,
// so it follows them across devices.
const GUEST_CONVERSATION_KEY = 'exchange_support_guest_conversation_id';

const STATUS_POLL_MS = 20_000; // badge check while the panel is closed
const THREAD_POLL_MS = 5_000; // live-ish reply check while the panel is open

const SUBJECT_OPTIONS: SupportSubject[] = ['TECHNICAL', 'KYC', 'CARD', 'OTHER'];
const SUBJECT_LABEL_KEY: Record<SupportSubject, Key> = {
  TECHNICAL: 'support.subject.TECHNICAL',
  KYC: 'support.subject.KYC',
  CARD: 'support.subject.CARD',
  OTHER: 'support.subject.OTHER',
};

/** Floating live-chat support widget, mounted once globally (see main.tsx)
 * so it's available on every page including the login screen. The
 * "usually reply within a few hours" status line is deliberately not a
 * fake "agent online now" claim — there's no real presence system behind
 * it, just a set expectation, same as any exchange's actual support page. */
export function SupportWidget() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [unread, setUnread] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState<SupportSubject>('TECHNICAL');
  const [firstMessage, setFirstMessage] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        if (getToken()) {
          const { conversation: conv } = await api.getMySupportConversation();
          if (!cancelled && conv) {
            setConversation(conv);
            setMessages(conv.messages);
            setUnread(conv.unreadByUser);
          }
        } else {
          const id = localStorage.getItem(GUEST_CONVERSATION_KEY);
          if (id) {
            const { conversation: conv, messages: msgs } = await api.getSupportConversation(id);
            if (!cancelled) {
              setConversation(conv);
              setMessages(msgs);
              setUnread(conv.unreadByUser);
            }
          }
        }
      } catch {
        localStorage.removeItem(GUEST_CONVERSATION_KEY);
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // Badge poll — only while the panel is closed, so the unread dot can
  // still appear if an admin replies while the user is elsewhere on site.
  useEffect(() => {
    if (!conversation || open) return;
    const interval = setInterval(() => {
      api
        .getSupportConversationStatus(conversation.id)
        .then(({ unreadByUser }) => setUnread(unreadByUser))
        .catch(() => {});
    }, STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [conversation, open]);

  // Thread poll — only while open, to pick up an admin's reply without the
  // user needing to close/reopen the panel.
  useEffect(() => {
    if (!conversation || !open) return;
    const interval = setInterval(() => {
      api
        .getSupportConversation(conversation.id)
        .then(({ conversation: conv, messages: msgs }) => {
          setMessages(msgs);
          if (conv.unreadByUser) {
            api.markSupportConversationRead(conv.id).catch(() => {});
          }
        })
        .catch(() => {});
    }, THREAD_POLL_MS);
    return () => clearInterval(interval);
  }, [conversation, open]);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, open]);

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && conversation) {
      setLoadError(false);
      api
        .getSupportConversation(conversation.id)
        .then(({ messages: msgs }) => setMessages(msgs))
        .catch(() => setLoadError(true));
      if (unread) {
        setUnread(false);
        api.markSupportConversationRead(conversation.id).catch(() => {});
      }
    }
  }

  async function handleStart(e: FormEvent) {
    e.preventDefault();
    setStartError(null);
    setStarting(true);
    try {
      const created = await api.startSupportConversation(name.trim(), email.trim(), subject, firstMessage.trim());
      setConversation(created);
      setMessages(created.messages);
      if (!getToken()) localStorage.setItem(GUEST_CONVERSATION_KEY, created.id);
      setFirstMessage('');
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : t('support.startError'));
    } finally {
      setStarting(false);
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!conversation || !body) return;
    setSending(true);
    try {
      const message = await api.sendSupportMessage(conversation.id, body);
      setMessages((prev) => [...prev, message]);
      setDraft('');
    } catch {
      // Leave the draft in place so the user can just hit send again.
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleToggle}
        style={styles.launcher}
        aria-label={open ? t('support.close') : t('support.title')}
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        ) : (
          <ChatIcon />
        )}
        {!open && unread && <span style={styles.badge}>1</span>}
      </button>

      {open && (
        <div style={styles.panel}>
          <div style={styles.header}>
            <div>
              <div style={styles.headerTitle}>{t('support.title')}</div>
              <div style={styles.headerStatus}>
                <span style={styles.statusDot} />
                {t('support.responseTime')}
              </div>
            </div>
            <button type="button" onClick={handleToggle} style={styles.closeBtn} aria-label={t('support.close')}>
              ✕
            </button>
          </div>

          {loadingInitial ? (
            <div style={styles.centered}>{t('support.loading')}</div>
          ) : !conversation ? (
            <form onSubmit={handleStart} style={styles.form}>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('support.formName')}
                style={styles.input}
              />
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('support.formEmail')}
                style={styles.input}
              />
              <select value={subject} onChange={(e) => setSubject(e.target.value as SupportSubject)} style={styles.input}>
                {SUBJECT_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(SUBJECT_LABEL_KEY[s])}
                  </option>
                ))}
              </select>
              <textarea
                required
                value={firstMessage}
                onChange={(e) => setFirstMessage(e.target.value)}
                placeholder={t('support.formMessagePlaceholder')}
                rows={3}
                style={{ ...styles.input, resize: 'none' as const }}
              />
              {startError && <div style={styles.error}>{startError}</div>}
              <button type="submit" disabled={starting} style={styles.submit}>
                {starting ? t('support.sending') : t('support.startChat')}
              </button>
            </form>
          ) : (
            <>
              <div style={styles.messages}>
                {loadError && <div style={styles.error}>{t('support.loadError')}</div>}
                {messages.map((m) => (
                  <div key={m.id} style={m.sender === 'USER' ? styles.bubbleRowUser : styles.bubbleRowAdmin}>
                    <div style={m.sender === 'USER' ? styles.bubbleUser : styles.bubbleAdmin}>{m.body}</div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={handleSend} style={styles.inputRow}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('support.inputPlaceholder')}
                  style={styles.messageInput}
                />
                <button type="submit" disabled={sending || !draft.trim()} style={styles.sendBtn} aria-label={t('support.send')}>
                  <SendIcon />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}

function ChatIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 12a8 8 0 1 1 3.2 6.4L4 20l1.1-3.5A7.96 7.96 0 0 1 4 12Z"
        stroke="var(--on-accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 12h15M13 5l7 7-7 7" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  launcher: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: 'var(--accent)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'var(--shadow-lg)',
    cursor: 'pointer',
    zIndex: 998,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    background: 'var(--sell)',
    color: '#fff',
    fontSize: 10,
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 4px',
    border: '2px solid var(--bg)',
  },
  panel: {
    position: 'fixed',
    bottom: 92,
    right: 24,
    width: 340,
    maxWidth: 'calc(100vw - 32px)',
    height: 480,
    maxHeight: 'calc(100vh - 140px)',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    boxShadow: 'var(--shadow-lg)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 999,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '14px 16px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--panel-alt)',
  },
  headerTitle: { fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' },
  headerStatus: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 },
  statusDot: { width: 7, height: 7, borderRadius: '50%', background: 'var(--buy)', flexShrink: 0 },
  closeBtn: { background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer' },
  centered: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 12 },
  form: { display: 'flex', flexDirection: 'column', gap: 10, padding: 16, overflowY: 'auto' },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    fontFamily: 'inherit',
  },
  error: { background: 'var(--sell-dim)', color: 'var(--sell)', padding: '6px 10px', borderRadius: 6, fontSize: 11 },
  submit: {
    border: 'none',
    borderRadius: 24,
    padding: '11px 0',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontWeight: 800,
    fontSize: 13,
    cursor: 'pointer',
  },
  messages: { flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 8 },
  bubbleRowUser: { display: 'flex', justifyContent: 'flex-end' },
  bubbleRowAdmin: { display: 'flex', justifyContent: 'flex-start' },
  bubbleUser: {
    maxWidth: '78%',
    background: 'var(--accent-dim)',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    borderRadius: '12px 12px 2px 12px',
    fontSize: 13,
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },
  bubbleAdmin: {
    maxWidth: '78%',
    background: 'var(--panel-alt)',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    borderRadius: '12px 12px 12px 2px',
    fontSize: 13,
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    padding: 12,
    borderTop: '1px solid var(--border)',
  },
  messageInput: {
    flex: 1,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: '10px 14px',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    border: 'none',
    background: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  },
};
