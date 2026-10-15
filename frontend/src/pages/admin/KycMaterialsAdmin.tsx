import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api, ApiError, type AdminKycMaterialRequest, type KycDocumentReason, type KycMaterialKind, type KycReviewStage } from '../../lib/api';
import { RU } from '../../lib/i18n/locales/ru';
import { styles } from './adminStyles';
import './kycMaterials.css';

/**
 * Дополнительные материалы KYC в админке: запрос нового фото документа и/или
 * селфи без отклонения заявки, история запросов и экран сравнения.
 *
 * Файлы пользователя приходят на почту администратора (как и сам документ);
 * сервер биржи хранит только факт получения, тип, размер, Message-ID и
 * согласие на селфи. Экран сравнения открывает файлы только в этом браузере
 * (объектные URL), никуда их не отправляет и ничего не распознаёт: лица
 * сравнивает администратор, решение принимает администратор.
 */

export const KYC_STAGE_LABEL: Record<KycReviewStage, string> = {
  NOT_STARTED: 'Не начата',
  UNDER_REVIEW: 'На проверке',
  DOCUMENT_REQUIRED: 'Требуется новое фото документа',
  SELFIE_REQUIRED: 'Требуется селфи',
  DOCUMENT_AND_SELFIE_REQUIRED: 'Требуются документ и селфи',
  MATERIALS_RECEIVED: 'Дополнительные материалы получены',
  RE_REVIEW: 'Повторная проверка',
  APPROVED: 'Подтверждено',
  REJECTED: 'Отклонено',
};

export const MATERIAL_KIND_LABEL: Record<KycMaterialKind, string> = {
  DOCUMENT: 'Новое фото документа',
  SELFIE: 'Селфи для подтверждения личности',
  DOCUMENT_AND_SELFIE: 'Документ и селфи',
};

export const DOCUMENT_REASON_LABEL: Record<KycDocumentReason, string> = {
  BLURRY: 'Фото размыто',
  UNREADABLE: 'Данные плохо читаются',
  CROPPED: 'Документ обрезан',
  LOW_LIGHT: 'Недостаточное освещение',
  OTHER: 'Другая причина',
};

const needsDocument = (kind: KycMaterialKind) => kind === 'DOCUMENT' || kind === 'DOCUMENT_AND_SELFIE';
const needsSelfie = (kind: KycMaterialKind) => kind === 'SELFIE' || kind === 'DOCUMENT_AND_SELFIE';

const kyiv = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' }) : '—';
const mimeLabel = (mime: string | null) => mime === 'application/pdf' ? 'PDF' : mime === 'image/png' ? 'PNG' : mime ? 'JPEG' : '';
const sizeLabel = (bytes: number | null) => !bytes ? '' : bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Exactly what the user reads in Russian (the same dictionary the user page uses). */
function UserPreview({ kind, reason, reasonText, comment }: { kind: KycMaterialKind; reason: KycDocumentReason | ''; reasonText: string; comment: string }) {
  const reasonLine = reason === 'OTHER' ? reasonText.trim() : reason ? RU[`kycMaterials.reason.${reason}`] : '';
  return (
    <div data-kyc-request-preview className="kyc-mat-preview" aria-live="polite">
      <p className="kyc-mat-preview-title">Пользователь увидит (русская версия; на других языках — перевод того же текста):</p>
      {needsDocument(kind) && (
        <div className="kyc-mat-preview-card">
          <b>{RU['kycMaterials.documentTitle']}</b>
          <p>{RU['kycMaterials.documentText']}</p>
          {reasonLine ? <p><b>{RU['kycMaterials.reasonLabel'].replace('{reason}', reasonLine)}</b></p> : <p className="kyc-mat-muted">Причина ещё не выбрана.</p>}
          <span className="kyc-mat-preview-chip">Кнопка у пользователя: «{RU['kycMaterials.uploadDocument']}»</span>
        </div>
      )}
      {needsSelfie(kind) && (
        <div className="kyc-mat-preview-card">
          <b>{RU['kycMaterials.selfieTitle']}</b>
          <p>{RU['kycMaterials.selfieText']}</p>
          {comment.trim() && <p><b>{RU['kycMaterials.adminComment'].replace('{comment}', comment.trim())}</b></p>}
          <p className="kyc-mat-muted">{RU['kycMaterials.selfieInstructions']}</p>
          <span className="kyc-mat-preview-chip">Кнопка у пользователя: «{RU['kycMaterials.takeSelfie']}» · перед отправкой — согласие на использование селфи</span>
        </div>
      )}
    </div>
  );
}

/**
 * «Запросить дополнительные материалы». Заявка не отклоняется. Один ключ
 * запроса на одно намерение: повторное нажатие или повтор после сбоя сети
 * возвращает тот же запрос, а не второй.
 */
export function KycMaterialRequestForm({ submissionId, preset, activeRequest, onSent, onCancel }: {
  submissionId: string;
  preset?: KycMaterialKind;
  /** The still-open request this one replaces, if any. */
  activeRequest: AdminKycMaterialRequest | null;
  onSent: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<KycMaterialKind>(preset ?? 'DOCUMENT');
  const [reason, setReason] = useState<KycDocumentReason | ''>('');
  const [reasonText, setReasonText] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const clientRequestId = useRef<string | null>(null);
  const ids = { kind: useId(), reason: useId(), other: useId(), comment: useId() };

  // A changed request is a new intent with a new key; the same one retried keeps it.
  useEffect(() => { clientRequestId.current = null; }, [submissionId, kind, reason, reasonText, comment]);
  useEffect(() => { if (preset) setKind(preset); }, [preset]);

  const doc = needsDocument(kind);
  const selfie = needsSelfie(kind);
  const invalid = doc && (!reason || (reason === 'OTHER' && reasonText.trim().length < 3));

  async function send() {
    if (busyRef.current || invalid) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    clientRequestId.current ??= randomId();
    try {
      await api.requestKycMaterials(submissionId, {
        clientRequestId: clientRequestId.current,
        kind,
        ...(doc ? { documentReason: reason as KycDocumentReason } : {}),
        ...(doc && reason === 'OTHER' ? { documentReasonText: reasonText.trim() } : {}),
        ...(selfie && comment.trim() ? { selfieComment: comment.trim() } : {}),
      });
      clientRequestId.current = null;
      onSent();
    } catch (err) {
      const known = err instanceof ApiError && err.status < 500 && err.status !== 0;
      setError(known ? (err as ApiError).message : 'Не удалось отправить запрос. Повторите — повторное нажатие не создаст второй запрос.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section data-kyc-request-form className="kyc-mat-form" aria-labelledby={ids.kind}>
      <h3 id={ids.kind} className="kyc-mat-heading">Запросить дополнительные материалы</h3>
      <p style={styles.hint}>Заявка не отклоняется: пользователь остаётся «на проверке» и получает понятное объяснение, что нужно прислать.</p>
      <fieldset className="kyc-mat-kinds">
        <legend className="kyc-mat-sr">Что запросить</legend>
        {(Object.keys(MATERIAL_KIND_LABEL) as KycMaterialKind[]).map((value) => (
          <label key={value} className="kyc-mat-kind" data-checked={kind === value || undefined}>
            <input type="radio" name={`kyc-kind-${submissionId}`} value={value} checked={kind === value} disabled={busy} onChange={() => setKind(value)} />
            <span>{MATERIAL_KIND_LABEL[value]}</span>
          </label>
        ))}
      </fieldset>

      {doc && (
        <label style={styles.label} htmlFor={ids.reason}>
          Причина запроса нового фото документа
          <select id={ids.reason} data-kyc-request-reason value={reason} disabled={busy} onChange={(e) => setReason(e.target.value as KycDocumentReason | '')} style={styles.input}>
            <option value="">— выберите причину —</option>
            {(Object.keys(DOCUMENT_REASON_LABEL) as KycDocumentReason[]).map((value) => <option key={value} value={value}>{DOCUMENT_REASON_LABEL[value]}</option>)}
          </select>
        </label>
      )}
      {doc && reason === 'OTHER' && (
        <label style={styles.label} htmlFor={ids.other}>
          Опишите причину (пользователь увидит этот текст)
          <input id={ids.other} data-kyc-request-other type="text" value={reasonText} maxLength={300} disabled={busy} onChange={(e) => setReasonText(e.target.value)} style={styles.input} placeholder="Например: на фото блик закрывает номер документа" />
        </label>
      )}
      {selfie && (
        <label style={styles.label} htmlFor={ids.comment}>
          Комментарий к запросу селфи (необязательно)
          <textarea id={ids.comment} data-kyc-request-comment value={comment} maxLength={300} rows={2} disabled={busy} onChange={(e) => setComment(e.target.value)} style={{ ...styles.input, resize: 'vertical', minHeight: 60 }} placeholder="Основной текст для пользователя формируется автоматически" />
        </label>
      )}

      <UserPreview kind={kind} reason={reason} reasonText={reasonText} comment={comment} />

      {activeRequest && !activeRequest.closedAt && (
        <p role="note" className="kyc-mat-warning">
          Текущий запрос «{MATERIAL_KIND_LABEL[activeRequest.kind]}» от {kyiv(activeRequest.createdAt)} будет закрыт и заменён новым. Уже полученные по нему файлы и история сохраняются.
        </p>
      )}
      {error && <div role="alert" style={styles.errorBox}>{error}</div>}
      <div className="kyc-mat-actions">
        <button type="button" style={styles.neutralBtn} disabled={busy} onClick={onCancel}>Отмена</button>
        <button type="button" data-kyc-request-send style={styles.approveBtn} disabled={busy || invalid} aria-busy={busy || undefined} onClick={() => void send()}>
          {busy ? 'Отправляем…' : 'Отправить запрос'}
        </button>
      </div>
    </section>
  );
}

function PartLine({ label, part, kindTitle, fullName, email }: {
  label: string;
  part: AdminKycMaterialRequest['document'] | AdminKycMaterialRequest['selfie'];
  kindTitle: string;
  fullName: string;
  email?: string;
}) {
  if (!part) return null;
  if (!part.receivedAt) return <li><b>{label}:</b> ожидается от пользователя</li>;
  const consent = part && 'consentAt' in part ? part : null;
  return (
    <li>
      <b>{label}:</b> получен(о) {kyiv(part.receivedAt)}
      {part.mimeType && <> · {mimeLabel(part.mimeType)}</>}
      {part.sizeBytes ? <> · {sizeLabel(part.sizeBytes)}</> : null}
      <div className="kyc-mat-muted">Письмо «[KYC] {kindTitle} — {fullName}{email ? ` — ${email}` : ''}»</div>
      {part.messageId && <div className="kyc-mat-muted kyc-mat-mono">Message-ID: {part.messageId}</div>}
      {consent?.consentAt && <div className="kyc-mat-muted">Согласие на использование селфи: {kyiv(consent.consentAt)} (версия {consent.consentVersion})</div>}
    </li>
  );
}

const OUTCOME_LABEL: Record<string, string> = {
  SUPERSEDED: 'заменён новым запросом',
  APPROVED: 'закрыт решением «Подтверждено»',
  REJECTED: 'закрыт решением «Отклонено»',
};

/** История запросов по заявке, новые сверху. Ничего не удаляется. */
export function KycMaterialHistory({ requests, activeId, fullName, email, busyAck, onAcknowledge }: {
  requests: AdminKycMaterialRequest[];
  activeId: string | null;
  fullName: string;
  email?: string;
  busyAck: boolean;
  onAcknowledge: (id: string) => void;
}) {
  if (!requests.length) return null;
  return (
    <section data-kyc-material-history className="kyc-mat-history" aria-label="Дополнительные материалы">
      <h3 className="kyc-mat-heading">Дополнительные материалы</h3>
      <ol>
        {requests.map((r) => {
          const active = r.id === activeId;
          const state = r.closedAt ? `Закрыт ${kyiv(r.closedAt)}${r.closedOutcome ? ` — ${OUTCOME_LABEL[r.closedOutcome] ?? r.closedOutcome}` : ''}`
            : r.status === 'RECEIVED' ? (r.acknowledgedAt ? `Повторная проверка с ${kyiv(r.acknowledgedAt)}` : 'Материалы получены') : 'Ожидает материалы от пользователя';
          return (
            <li key={r.id} data-kyc-material-request={r.id} data-active={active || undefined} className="kyc-mat-history-item">
              <div className="kyc-mat-history-head">
                <b>{MATERIAL_KIND_LABEL[r.kind]}</b>
                <span className="kyc-mat-muted">запрошен {kyiv(r.createdAt)}</span>
              </div>
              <div className="kyc-mat-state" data-state={r.closedAt ? 'closed' : r.status.toLowerCase()}>{state}</div>
              {r.documentReason && <div>Причина: {r.documentReason === 'OTHER' ? r.documentReasonText : DOCUMENT_REASON_LABEL[r.documentReason]}</div>}
              {r.selfieComment && <div>Комментарий к селфи: {r.selfieComment}</div>}
              <ul>
                <PartLine label="Новое фото документа" part={r.document} kindTitle="Новое фото документа" fullName={fullName} email={email} />
                <PartLine label="Селфи" part={r.selfie} kindTitle="Селфи для подтверждения личности" fullName={fullName} email={email} />
              </ul>
              {active && r.status === 'RECEIVED' && !r.acknowledgedAt && (
                <button type="button" data-kyc-material-ack style={styles.neutralBtn} disabled={busyAck} onClick={() => onAcknowledge(r.id)}>
                  Начать повторную проверку
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type View = { scale: number; rotate: number; x: number; y: number };
const INITIAL_VIEW: View = { scale: 1, rotate: 0, x: 0, y: 0 };

/** One side of the comparison: a local file (or the legacy server copy), zoom, rotate, pan, fullscreen. */
function ComparePane({ title, hint, initial, accept, testId }: {
  title: string;
  hint: string;
  initial: { url: string; pdf: boolean } | null;
  accept: string;
  testId: string;
}) {
  const [local, setLocal] = useState<{ url: string; pdf: boolean; name: string } | null>(null);
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const [max, setMax] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const source = local ?? (initial ? { ...initial, name: '' } : null);

  useEffect(() => () => { if (local) URL.revokeObjectURL(local.url); }, [local]);
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setMax(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  // In-page maximised view (no Fullscreen API): Escape restores the pane, not close the whole screen.
  useEffect(() => {
    if (!max) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.fullscreenElement) return;
      e.preventDefault();
      e.stopPropagation();
      setMax(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [max]);

  function open(file: File | null) {
    if (!file) return;
    // Opened only in this tab; never uploaded anywhere.
    setLocal({ url: URL.createObjectURL(file), pdf: file.type === 'application/pdf', name: file.name });
    setView(INITIAL_VIEW);
  }
  async function toggleMax() {
    const pane = paneRef.current;
    if (!max && pane?.requestFullscreen) {
      try { await pane.requestFullscreen(); setMax(true); return; } catch { /* fall back to the in-page view */ }
    }
    if (max && document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); }
    setMax(!max);
  }
  const zoom = (factor: number) => setView((v) => ({ ...v, scale: Math.min(6, Math.max(0.25, +(v.scale * factor).toFixed(3))) }));
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!source || source.pdf) return;
    drag.current = { id: e.pointerId, x: e.clientX - view.x, y: e.clientY - view.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setView((v) => ({ ...v, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y }));
  }
  const endDrag = () => { drag.current = null; };

  return (
    <div ref={paneRef} data-kyc-compare-pane={testId} className="kyc-compare-pane" data-max={max || undefined}>
      <div className="kyc-compare-pane-head">
        <b>{title}</b>
        <input ref={inputRef} type="file" accept={accept} className="kyc-mat-sr" tabIndex={-1} aria-label={`${title}: открыть файл`} data-kyc-compare-input={testId}
          onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; open(f); }} />
        <button type="button" style={styles.neutralBtn} onClick={() => inputRef.current?.click()}>{source ? 'Открыть другой файл' : 'Открыть файл'}</button>
      </div>
      <div className="kyc-compare-tools" role="toolbar" aria-label={`${title}: просмотр`}>
        <button type="button" onClick={() => zoom(1 / 1.25)} disabled={!source || source.pdf} aria-label="Уменьшить">−</button>
        <span className="kyc-mat-mono" aria-live="polite">{Math.round(view.scale * 100)}%</span>
        <button type="button" onClick={() => zoom(1.25)} disabled={!source || source.pdf} aria-label="Увеличить">+</button>
        <button type="button" onClick={() => setView((v) => ({ ...v, rotate: (v.rotate + 90) % 360 }))} disabled={!source || source.pdf} aria-label="Повернуть на 90°">↻ 90°</button>
        <button type="button" onClick={() => setView(INITIAL_VIEW)} disabled={!source || source.pdf}>Сбросить</button>
        <button type="button" onClick={() => void toggleMax()} disabled={!source} data-kyc-compare-max>{max ? 'Свернуть' : 'Во весь экран'}</button>
      </div>
      <div
        className="kyc-compare-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => zoom(view.scale >= 2 ? 1 / view.scale : 2)}
      >
        {!source ? (
          <p className="kyc-mat-muted kyc-compare-empty">{hint}</p>
        ) : source.pdf ? (
          <iframe title={title} src={source.url} className="kyc-compare-pdf" />
        ) : (
          <img
            src={source.url}
            alt={title}
            draggable={false}
            style={{ transform: `translate(${view.x}px, ${view.y}px) rotate(${view.rotate}deg) scale(${view.scale})` }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Экран сравнения: слева документ, справа селфи. Только просмотр — без
 * автоматического сравнения лиц, процентов «похожести» и автоматических решений.
 */
export function KycCompareView({ legacyDocument, onClose, onApprove, onRequestSelfie, onRequestDocument, onReject }: {
  legacyDocument: { url: string; pdf: boolean } | null;
  onClose: () => void;
  onApprove: () => void;
  onRequestSelfie: () => void;
  onRequestDocument: () => void;
  onReject: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    return () => { if (typeof dialog.close === 'function') dialog.close(); previous?.focus(); };
  }, []);
  return (
    <dialog ref={ref} data-kyc-compare className="kyc-compare" aria-label="Сравнение документа и селфи" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="kyc-compare-header">
        <h2>Сравнение документа и селфи</h2>
        <button type="button" style={styles.neutralBtn} aria-label="Закрыть" onClick={onClose}>×</button>
      </header>
      <p className="kyc-compare-note">
        Файлы открываются только в этом браузере и никуда не отправляются. Автоматическое распознавание лиц не используется — сравнение и решение за вами.
        Перетаскивайте изображение для перемещения, двойной клик — увеличить.
      </p>
      <div className="kyc-compare-grid">
        <ComparePane
          testId="document"
          title="Документ"
          initial={legacyDocument}
          accept="image/jpeg,image/png,application/pdf"
          hint="Откройте файл документа из письма «[KYC] Новая заявка…» или «[KYC] Новое фото документа…» (вложение сохраните на устройство)."
        />
        <ComparePane
          testId="selfie"
          title="Селфи"
          initial={null}
          accept="image/jpeg,image/png"
          hint="Откройте селфи из письма «[KYC] Селфи для подтверждения личности…» (вложение сохраните на устройство)."
        />
      </div>
      <footer className="kyc-compare-footer">
        <button type="button" data-kyc-compare-approve style={styles.approveBtn} onClick={onApprove}>Подтвердить</button>
        <button type="button" data-kyc-compare-request-selfie style={styles.neutralBtn} onClick={onRequestSelfie}>Запросить новое селфи</button>
        <button type="button" data-kyc-compare-request-document style={styles.neutralBtn} onClick={onRequestDocument}>Запросить новый документ</button>
        <button type="button" data-kyc-compare-reject style={styles.rejectBtn} onClick={onReject}>Отклонить</button>
      </footer>
    </dialog>
  );
}
