import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowUpRight, CheckCircle2, ChevronRight, Headset, Send, Sparkles, Trash2, X } from 'lucide-react';
import { api, getToken } from '../lib/api';
import { RU } from '../lib/i18n/locales/ru';
import { ASSISTANT_RU as copy } from '../lib/i18n/locales/assistantRu';
import { onOpenSupportWidget } from '../lib/supportWidget';
import { SUPPORT_ENDPOINT } from '../lib/supportEndpoint';
import { SUPPORT_LIMITS, SUPPORT_SUBJECTS, invalidSupportFields, sendSupportRequest, type SupportSubject } from '../lib/supportForm';
import {
  ASSISTANT_KNOWLEDGE, ASSISTANT_LIMITS, ASSISTANT_ROUTES, INITIAL_INTENTS,
  appendAssistantTurn, assistantAnswer, containsSensitiveData, recognizeAssistantIntent,
  type AssistantAction, type AssistantIntent, type AssistantTurn,
} from '../lib/supportAssistant';
import './SupportWidget.css';

// Loaded only by the explicit deposit action, never by opening FAQ.
const DepositModal = lazy(() => import('./DepositModal').then(m => ({ default: m.DepositModal })));
type Phase = 'idle' | 'sending' | 'sent' | 'failed' | 'check' | 'sensitive' | 'context-too-long';
type Mode = 'assistant' | 'specialist';

/** One global widget. FAQ is local; only a confirmed specialist form posts to
 * the existing email Worker. SessionContent remounts it on every token change. */
export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('assistant');
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [allQuestions, setAllQuestions] = useState(false);
  const [handoffNotice, setHandoffNotice] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState<SupportSubject>('TECHNICAL');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const sendingRef = useRef(false);
  const prefilledRef = useRef(false);
  const sequenceRef = useRef(0);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  function show(nextMode: Mode) {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setMode(nextMode); setOpen(true);
  }
  function close() {
    setOpen(false);
    const target = returnFocusRef.current;
    if (target?.isConnected) target.focus(); else launcherRef.current?.focus();
  }
  // Existing Forgot password / OTC / footer calls always reach a human form.
  useEffect(() => onOpenSupportWidget(() => show('specialist')), []);
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    const resize = () => {
      const height = viewport?.height ?? window.innerHeight;
      const inset = Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0));
      panelRef.current?.style.setProperty('--support-viewport', `${height}px`);
      // A narrow underlying page may overflow its layout viewport; do not let
      // that widen this fixed dialog beyond the actually visible screen.
      panelRef.current?.style.setProperty('--support-width', `${Math.min(document.documentElement.clientWidth, viewport?.width ?? document.documentElement.clientWidth)}px`);
      panelRef.current?.style.setProperty('--support-keyboard', `${inset}px`);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    resize();
    viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize); document.addEventListener('keydown', key);
    return () => {
      viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize); document.removeEventListener('keydown', key);
    };
  }, [open]);
  useEffect(() => {
    if (mode === 'assistant' && transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [turns, mode]);
  // The existing bounded prefill is restricted to the actual specialist form.
  useEffect(() => {
    if (!open || mode !== 'specialist' || prefilledRef.current || !getToken()) return;
    prefilledRef.current = true;
    let cancelled = false;
    api.getMe().then(me => {
      if (cancelled) return;
      setEmail(current => current || me.email || '');
      setName(current => current || me.displayName || '');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, mode]);

  function edited() { if (phase !== 'sending') setPhase('idle'); }
  function handoff(text?: string, intent?: AssistantIntent, sensitive = false) {
    setAllQuestions(false); setMode('specialist'); setHandoffNotice(true);
    if (!sendingRef.current) {
      if (text !== undefined) setMessage(sensitive ? '' : text.slice(0, SUPPORT_LIMITS.message));
      if (intent) setSubject(intent === 'kyc_how' ? 'KYC' : intent.startsWith('deposit_') || intent === 'withdrawal_not_received' || intent === 'otc_how' ? 'OTHER' : 'TECHNICAL');
      setPhase(sensitive ? 'sensitive' : 'idle');
    }
  }
  function ask(text: string, selected?: AssistantIntent) {
    const clean = text.trim();
    if (!clean) return;
    const result = selected ? { type: 'answer' as const, intent: selected } : recognizeAssistantIntent(clean);
    const sensitive = result.type === 'specialist' && result.reason === 'sensitive';
    setQuestion(''); setAllQuestions(false);
    setTurns(current => appendAssistantTurn(current, {
      id: ++sequenceRef.current, question: sensitive ? copy.hiddenMessage : clean.slice(0, ASSISTANT_LIMITS.question),
      intent: result.type === 'answer' ? result.intent : null,
    }));
    if (result.type === 'specialist') handoff(clean, undefined, sensitive);
  }
  function action(id: AssistantAction, intent: AssistantIntent, originalQuestion: string) {
    if (id === 'specialist') handoff(originalQuestion, intent);
    else if (id === 'deposit') { close(); setDepositOpen(true); }
  }
  function addContext() {
    const last = [...turns].reverse().find(turn => turn.intent !== null);
    if (!last?.intent || sendingRef.current) return;
    const next = [message.trim(), `${copy.contextQuestion}: ${last.question}\n${copy.contextAnswer}: ${assistantAnswer(last.intent)}`].filter(Boolean).join('\n\n');
    if (next.length > SUPPORT_LIMITS.message) { setPhase('context-too-long'); return; }
    setMessage(next); edited();
  }
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (sendingRef.current) return;
    const input = { name, email, subject, message, website };
    if ([name, email, message].some(containsSensitiveData)) { setPhase('sensitive'); return; }
    if (invalidSupportFields(input).length) { setPhase('check'); return; }
    sendingRef.current = true; setPhase('sending');
    const outcome = await sendSupportRequest(input, { endpoint: SUPPORT_ENDPOINT });
    sendingRef.current = false;
    if (!mountedRef.current) return;
    if (outcome.status === 'sent') { setMessage(''); setPhase('sent'); }
    else setPhase('failed');
  }
  const sending = phase === 'sending';
  const problem = phase === 'sensitive' ? copy.sensitive : phase === 'context-too-long' ? copy.contextTooLong
    : phase === 'failed' ? RU['support.formFailed'] : phase === 'check' ? RU['support.formCheck'] : null;
  const hasContext = turns.some(turn => turn.intent !== null);
  const renderAction = (id: AssistantAction, intent: AssistantIntent, originalQuestion: string) => id === 'specialist' || id === 'deposit'
    ? <button type="button" key={id} onClick={() => action(id, intent, originalQuestion)}>{copy.actions[id]}<ChevronRight size={13} aria-hidden="true" /></button>
    : <a key={id} href={ASSISTANT_ROUTES[id]} onClick={close}>{copy.actions[id]}<ArrowUpRight size={13} aria-hidden="true" /></a>;

  return <>
    <button type="button" ref={launcherRef} onClick={() => open ? close() : show(mode)} className="support-launcher"
      style={launcherStyle} aria-label={open ? copy.close : RU['support.title']} aria-expanded={open} aria-controls="voltex-assistant-panel">
      {open ? <X size={22} aria-hidden="true" /> : <Headset size={25} strokeWidth={1.7} aria-hidden="true" />}
    </button>
    {open && <div className="support-panel" id="voltex-assistant-panel" ref={panelRef} role="dialog" lang="ru"
      aria-labelledby="voltex-assistant-title" tabIndex={-1}>
      <header className="support-panel-header">
        <span className="support-panel-avatar" aria-hidden="true"><Sparkles size={21} strokeWidth={1.5} /></span>
        <div className="support-panel-heading"><div id="voltex-assistant-title" className="support-panel-title">{copy.title}</div><div className="support-panel-sub">{copy.subtitle}</div></div>
        <button type="button" className="support-panel-close" onClick={close} aria-label={copy.close}><X size={19} aria-hidden="true" /></button>
      </header>
      <div className="support-mode" role="group" aria-label={copy.title}>
        <button type="button" aria-pressed={mode === 'assistant'} onClick={() => setMode('assistant')}><Sparkles size={14} aria-hidden="true" />{copy.assistant}</button>
        <button type="button" aria-pressed={mode === 'specialist'} onClick={() => handoff()}><Headset size={15} aria-hidden="true" />{copy.specialist}</button>
      </div>
      {mode === 'assistant' ? <>
        <div className="support-conversation" ref={transcriptRef}>
          <div className="support-greeting"><span className="support-author">{copy.title}</span><p>{copy.greeting}</p></div>
          {turns.length === 0 && <div className="support-suggestions">{INITIAL_INTENTS.map((id, i) =>
            <button key={id} type="button" data-assistant-intent={id} onClick={() => ask(copy.questions[id], id)}>{copy.suggestions[i]}<ChevronRight size={14} aria-hidden="true" /></button>)}</div>}
          <button type="button" className="support-all" aria-expanded={allQuestions} aria-controls="support-questions" onClick={() => setAllQuestions(value => !value)}>{allQuestions ? copy.hideQuestions : copy.allQuestions}<ChevronRight size={13} aria-hidden="true" /></button>
          {allQuestions && <section id="support-questions" className="support-questions" aria-label={copy.allQuestions}>
            {(Object.keys(copy.groups) as (keyof typeof copy.groups)[]).map(group => <div key={group}><h3>{copy.groups[group]}</h3>
              {ASSISTANT_KNOWLEDGE.filter(item => item.group === group).map(({ id }) => <button type="button" key={id} data-assistant-intent={id} onClick={() => ask(copy.questions[id], id)}>{copy.questions[id]}<ChevronRight size={13} aria-hidden="true" /></button>)}
            </div>)}
          </section>}
          <div role="log" aria-label={copy.history} aria-live="polite" aria-relevant="additions" className="support-transcript">
            {turns.map(turn => <div className="support-turn" key={turn.id}>
              <div className="support-user-message"><span className="support-author">{copy.you}</span><p>{turn.question}</p></div>
              <div className="support-assistant-message"><span className="support-author">{copy.title}</span><p>{turn.intent ? assistantAnswer(turn.intent) : copy.handoff}</p>
                {turn.intent && <div className="support-answer-actions">{ASSISTANT_KNOWLEDGE.find(item => item.id === turn.intent)!.actions.map(id => renderAction(id, turn.intent!, turn.question))}</div>}
              </div>
            </div>)}
          </div>
        </div>
        <form className="support-composer" onSubmit={event => { event.preventDefault(); ask(question); }}>
          <div className="support-composer-field"><textarea ref={composerRef} value={question} onChange={event => setQuestion(event.target.value)} maxLength={ASSISTANT_LIMITS.question}
            rows={2} placeholder={copy.placeholder} aria-label={copy.placeholder} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); ask(question); }
            }} />
            <button type="submit" aria-label={copy.send} disabled={!question.trim()}><Send size={17} aria-hidden="true" /></button></div>
          <div className="support-composer-footer"><span>{copy.assistant}</span><button type="button" disabled={!turns.length && !question} onClick={() => { setTurns([]); setQuestion(''); setAllQuestions(false); composerRef.current?.focus(); }}><Trash2 size={12} aria-hidden="true" />{copy.clear}</button></div>
        </form>
      </> : <form className="support-form" onSubmit={handleSubmit} noValidate>
        <div className="support-form-body">
          <p className="support-contact-hint">{handoffNotice ? copy.handoff : copy.contactHint}</p>
          <fieldset className="support-topics" disabled={sending}><legend>{RU['support.formSubject']}</legend><div className="support-topic-grid">
            {SUPPORT_SUBJECTS.map(value => <label key={value} className="support-topic"><input type="radio" name="support-subject" value={value} checked={subject === value} onChange={() => { setSubject(value); edited(); }} /><span>{RU[`support.subject.${value}`]}</span></label>)}
          </div></fieldset>
          <div className="support-row">
            <label className="support-field"><span>{RU['support.formName']}</span><input autoComplete="name" value={name} onChange={event => { setName(event.target.value); edited(); }} maxLength={SUPPORT_LIMITS.name} required disabled={sending} /></label>
            <label className="support-field"><span>{RU['support.formEmail']}</span><input type="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); edited(); }} maxLength={SUPPORT_LIMITS.email} required disabled={sending} /></label>
          </div>
          <small className="support-hint">{RU['support.formEmailHint']}</small>
          <label className="support-field"><span>{RU['support.formMessage']}</span><textarea value={message} onChange={event => { setMessage(event.target.value); edited(); }} rows={5} maxLength={SUPPORT_LIMITS.message} required disabled={sending} /></label>
          <div className="support-message-meta">{hasContext && <button type="button" disabled={sending} onClick={addContext}>{copy.addContext}</button>}<span className="support-count">{message.length} / {SUPPORT_LIMITS.message}</span></div>
          <div className="support-hp" aria-hidden="true"><label>Сайт<input name="website" value={website} onChange={event => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></label></div>
        </div>
        <div className="support-form-footer">
          {phase === 'sent' && <div className="support-result support-result-ok" role="status"><CheckCircle2 size={18} aria-hidden="true" /><div><strong>{copy.sent}</strong><p>{copy.sentHint}</p></div></div>}
          {problem && <div className="support-result support-result-error" role="alert"><AlertCircle size={17} aria-hidden="true" /><span>{problem}</span></div>}
          <button type="submit" className="support-submit" disabled={sending}>{sending ? RU['support.sending'] : copy.sendToSpecialist}<ArrowUpRight size={16} aria-hidden="true" /></button>
        </div>
      </form>}
    </div>}
    {depositOpen && <Suspense fallback={<div role="status" className="support-opening">{copy.openDeposit}</div>}><DepositModal onClose={() => setDepositOpen(false)} source="support" /></Suspense>}
  </>;
}

// Claude #357's single 50px headset launcher; terminal docking overrides remain intact.
const launcherStyle: React.CSSProperties = {
  position: 'fixed', bottom: 24, right: 24, width: 50, height: 50, borderRadius: '50%',
  background: '#F0B90B', color: 'var(--on-accent, #151719)', border: 'none', display: 'flex', alignItems: 'center',
  justifyContent: 'center', boxShadow: '0 6px 18px rgba(0,0,0,.35)', cursor: 'pointer', zIndex: 998,
};
