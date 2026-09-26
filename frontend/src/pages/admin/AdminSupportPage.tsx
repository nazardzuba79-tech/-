import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { styles } from './adminStyles';
import {
  failureText, getSupportDiagnostics, getSupportInbox, getSupportThread, replyToSupportThread, retryFailedSupportNotifications,
  sendSupportTestEmail, type SupportDiagnostics, type SupportInboxFilter, type SupportInboxPage, type SupportNotificationState,
  type SupportThread,
} from './adminSupport';

/**
 * Поддержка: whether support emails actually reach the mailbox, and a
 * small inbox — who wrote, about what, the whole thread, a reply that lands
 * in the user's chat. Not a helpdesk: no assignment, tags or SLA.
 */

const SUBJECT_LABEL: Record<string, string> = {
  TECHNICAL: 'Техническая проблема',
  KYC: 'Вопрос по KYC',
  CARD: 'Вопрос по карте',
  OTHER: 'Другое',
};

const STATE_TEXT: Record<SupportDiagnostics['state'], { icon: string; text: string; tone: 'ok' | 'bad' | 'warn' }> = {
  working: { icon: '✅', text: 'Работают', tone: 'ok' },
  failing: { icon: '❌', text: 'Проблема: последнее письмо не отправилось', tone: 'bad' },
  not_configured: { icon: '❌', text: 'Не настроены — письма никуда не отправляются', tone: 'bad' },
  unverified: { icon: '⚠️', text: 'Настроены, но ещё ни одно письмо не доставлено — отправьте тестовое', tone: 'warn' },
};

const FILTERS: { id: SupportInboxFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'unread', label: 'Новые' },
  { id: 'attention', label: 'Письмо не доставлено' },
];

const POLL_MS = 30_000;
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('ru-RU') : '—');

function DeliveryBadge({ state }: { state: SupportNotificationState | null | undefined }) {
  if (!state) return null;
  const view = state.status === 'SENT'
    ? { text: 'письмо отправлено', color: 'var(--buy)' }
    : state.status === 'FAILED'
      ? { text: `письмо не доставлено${state.failureCategory ? ` · ${failureText(state.failureCategory)}` : ''}`, color: 'var(--sell)' }
      : { text: `письмо в очереди${state.attempts > 0 && state.failureCategory ? ` · ${failureText(state.failureCategory)}` : ''}`, color: 'var(--accent)' };
  return <span data-delivery={state.status} style={{ fontSize: 11, fontWeight: 600, color: view.color }}>{view.text}</span>;
}

export function AdminSupportPage() {
  const [diagnostics, setDiagnostics] = useState<SupportDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState(false);
  const [filter, setFilter] = useState<SupportInboxFilter>('all');
  const [inbox, setInbox] = useState<SupportInboxPage | null>(null);
  const [inboxError, setInboxError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [threadError, setThreadError] = useState(false);
  const [testState, setTestState] = useState<{ status: 'idle' | 'sending' | 'sent' | 'failed'; text?: string }>({ status: 'idle' });
  const [retrying, setRetrying] = useState(false);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const loadDiagnostics = useCallback(() => {
    getSupportDiagnostics().then((d) => { setDiagnostics(d); setDiagnosticsError(false); }).catch(() => setDiagnosticsError(true));
  }, []);
  const loadInbox = useCallback((next: SupportInboxFilter = filterRef.current) => {
    getSupportInbox(next).then((page) => { if (filterRef.current === next) { setInbox(page); setInboxError(false); } }).catch(() => setInboxError(true));
  }, []);
  const loadThread = useCallback((id: string) => {
    getSupportThread(id).then((t) => { setThread(t); setThreadError(false); }).catch(() => setThreadError(true));
  }, []);

  useEffect(() => { loadDiagnostics(); }, [loadDiagnostics]);
  useEffect(() => { setInbox(null); loadInbox(filter); }, [filter, loadInbox]);
  useEffect(() => { if (selectedId) { setThread(null); loadThread(selectedId); } }, [selectedId, loadThread]);

  // The only timer: refresh while the tab is visible, so new messages show up.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      loadDiagnostics();
      loadInbox();
      if (selectedId) loadThread(selectedId);
    };
    const timer = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadDiagnostics, loadInbox, loadThread, selectedId]);

  async function sendTest() {
    setTestState({ status: 'sending' });
    try {
      const result = await sendSupportTestEmail();
      setTestState(result.ok
        ? { status: 'sent', text: `Отправлено на ${result.recipient}. SMTP-сервер принял письмо — проверьте «Входящие» и «Спам».` }
        : { status: 'failed', text: `Не отправлено: ${failureText(result.category, result.code)}.` });
    } catch {
      setTestState({ status: 'failed', text: 'Не удалось выполнить запрос.' });
    }
    loadDiagnostics();
  }

  async function retryFailed() {
    setRetrying(true);
    try { await retryFailedSupportNotifications(); } catch { /* the counts below still refresh */ }
    setRetrying(false);
    loadDiagnostics();
    loadInbox();
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    if (!thread || replying || !reply.trim()) return;
    setReplying(true);
    setReplyError(null);
    try {
      await replyToSupportThread(thread.conversation.id, reply.trim());
      setReply('');
      loadThread(thread.conversation.id);
      loadInbox();
    } catch {
      setReplyError('Ответ не отправлен. Попробуйте ещё раз.');
    } finally {
      setReplying(false);
    }
  }

  const stateView = diagnostics ? STATE_TEXT[diagnostics.state] : null;
  const toneColor = stateView?.tone === 'ok' ? 'var(--buy)' : stateView?.tone === 'bad' ? 'var(--sell)' : 'var(--accent)';

  return (
    <div className="admin-support">
      <h1 style={styles.title}>Поддержка</h1>

      <section style={{ ...styles.card, marginBottom: 16, gap: 10 }} aria-label="Email-уведомления поддержки" data-support-state={diagnostics?.state ?? 'loading'}>
        {diagnosticsError && !diagnostics && <p style={{ margin: 0, color: 'var(--sell)' }}>Не удалось загрузить состояние почты.</p>}
        {!diagnostics && !diagnosticsError && <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>Загрузка…</p>}
        {diagnostics && stateView && (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: toneColor }}>
              Email-уведомления поддержки: {stateView.icon} {stateView.text}
            </div>
            <dl className="admin-support-facts">
              <div><dt>Получатель</dt><dd>{diagnostics.recipient ?? 'не задан (SUPPORT_ADMIN_EMAIL)'}</dd></div>
              <div><dt>SMTP</dt><dd>{diagnostics.smtpConfigured ? 'Настроен' : 'Не настроен'}</dd></div>
              <div><dt>Последнее успешное письмо</dt><dd>{when(diagnostics.lastSentAt ?? (diagnostics.lastTest?.ok ? diagnostics.lastTest.at : null))}</dd></div>
              <div><dt>Последняя ошибка</dt><dd>{diagnostics.lastFailedAt ? `${when(diagnostics.lastFailedAt)} · ${failureText(diagnostics.lastFailureCategory, diagnostics.lastFailureCode)}` : '—'}</dd></div>
              <div><dt>В очереди</dt><dd>{diagnostics.pending}</dd></div>
              <div><dt>Не доставлено</dt><dd style={{ color: diagnostics.failed ? 'var(--sell)' : undefined }}>{diagnostics.failed}</dd></div>
              <div>
                <dt>Ответы из почты</dt>
                <dd>{diagnostics.inboundConfigured ? 'Настроены — ответ на письмо появится в чате' : 'Не настроены — ответ на письмо уйдёт пользователю на email, в чат он не попадёт'}</dd>
              </div>
            </dl>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" style={styles.primaryBtn} disabled={testState.status === 'sending' || !diagnostics.smtpConfigured || !diagnostics.recipient} onClick={sendTest}>
                {testState.status === 'sending' ? 'Отправка…' : 'Отправить тестовое письмо'}
              </button>
              {diagnostics.failed > 0 && (
                <button type="button" style={styles.rejectBtn} disabled={retrying} onClick={retryFailed}>
                  {retrying ? 'Повтор…' : `Повторить недоставленные (${diagnostics.failed})`}
                </button>
              )}
              {testState.text && (
                <span role="status" data-test-email={testState.status} style={{ fontSize: 13, color: testState.status === 'sent' ? 'var(--buy)' : 'var(--sell)' }}>{testState.text}</span>
              )}
            </div>
          </>
        )}
      </section>

      <div className="admin-user-tabs" role="tablist" aria-label="Фильтр обращений" style={{ marginBottom: 10 }}>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`admin-user-tab${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}{f.id === 'unread' && inbox?.unread ? ` (${inbox.unread})` : ''}
          </button>
        ))}
      </div>

      <div className="admin-support-grid">
        <div style={{ ...styles.table, maxHeight: 680, overflowY: 'auto' }} aria-label="Обращения">
          {inboxError && !inbox && <p style={{ padding: 14, color: 'var(--sell)', fontSize: 12 }}>Не удалось загрузить обращения.</p>}
          {!inbox && !inboxError && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Загрузка…</p>}
          {inbox?.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="row-hover admin-support-row"
              data-unread={item.unreadByAdmin || undefined}
              aria-current={selectedId === item.id || undefined}
              onClick={() => setSelectedId(item.id)}
              style={{ background: selectedId === item.id ? 'var(--panel-alt)' : 'transparent' }}
            >
              <span className="admin-support-row-head">
                <strong>{item.unreadByAdmin && <span className="admin-support-dot" aria-label="Новое" />}{item.name}</strong>
                <time>{when(item.updatedAt)}</time>
              </span>
              <span className="admin-support-row-meta">{item.email} · {SUBJECT_LABEL[item.subject] ?? item.subject}</span>
              {item.lastMessage && (
                <span className="admin-support-row-preview">{item.lastMessage.sender === 'ADMIN' ? 'Вы: ' : ''}{item.lastMessage.preview}</span>
              )}
              <DeliveryBadge state={item.notification} />
            </button>
          ))}
          {inbox && inbox.items.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Обращений нет.</p>}
        </div>

        <div style={{ ...styles.card, gap: 12, minWidth: 0 }}>
          {!selectedId && <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>Выберите обращение в списке.</p>}
          {selectedId && threadError && !thread && <p style={{ margin: 0, color: 'var(--sell)' }}>Не удалось открыть обращение.</p>}
          {selectedId && !thread && !threadError && <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>Загрузка…</p>}
          {thread && (
            <>
              <header className="admin-support-thread-head">
                <strong>{thread.conversation.name}</strong>
                <span>{thread.conversation.email} · {SUBJECT_LABEL[thread.conversation.subject] ?? thread.conversation.subject}</span>
                <span>Ticket #{thread.conversation.id} · {thread.conversation.userId ? `аккаунт ${thread.conversation.userId}` : 'гость (без входа)'} · создано {when(thread.conversation.createdAt)}</span>
              </header>
              <ol className="admin-support-thread" aria-label="Переписка">
                {thread.messages.map((m) => (
                  <li key={m.id} data-sender={m.sender}>
                    <div className="admin-support-bubble">{m.body}</div>
                    <div className="admin-support-bubble-meta">
                      {m.sender === 'ADMIN' ? 'Поддержка' : thread.conversation.name} · {when(m.createdAt)}
                      {m.sender === 'USER' && <> · <DeliveryBadge state={m.notification} /></>}
                    </div>
                  </li>
                ))}
              </ol>
              <form onSubmit={submitReply} className="admin-support-reply">
                <textarea
                  aria-label="Ответ пользователю"
                  value={reply}
                  maxLength={5000}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Ответ появится в чате поддержки у пользователя"
                  rows={3}
                  style={{ ...styles.input, resize: 'vertical', minHeight: 72 }}
                />
                {replyError && <span role="alert" style={{ color: 'var(--sell)', fontSize: 12 }}>{replyError}</span>}
                <button type="submit" style={styles.primaryBtn} disabled={replying || !reply.trim()}>{replying ? 'Отправка…' : 'Ответить в чат'}</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
