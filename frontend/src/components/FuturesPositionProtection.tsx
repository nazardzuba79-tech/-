import { useState, useEffect, useRef, FormEvent } from 'react';
import { api, ApiError, type FuturesProtectionTrigger } from '../lib/api';
import { useLanguage } from '../lib/i18n';

/** The editor's own box, in CSS pixels. Used to decide whether it fits
 *  below the trigger before it is rendered, so it never opens off screen. */
const EDITOR_WIDTH = 232;
const EDITOR_HEIGHT = 240;

export interface PositionProtection {
  takeProfit: FuturesProtectionTrigger | null;
  stopLoss: FuturesProtectionTrigger | null;
}

/**
 * TP/SL for one open futures position.
 *
 * The rule this component exists to keep: WHAT IS DISPLAYED IS SERVER STATE.
 * The two inputs are a draft of an instruction, and a draft protects
 * nothing. Until a PUT succeeds, the trigger chips keep showing whatever the
 * server last said was armed — typing `95000` into Stop Loss and walking
 * away must never make the row look protected. The editor closes only after
 * the server has answered, and the chips then repaint from the refreshed
 * positions payload, not from the local draft.
 *
 * `onSaved` asks the page to refresh the shared futures account state. There
 * is no timer and no fetch loop here: protection travels with
 * `/futures/positions`, which the positions panel already polls through
 * `futuresAccountStore`, so this adds no polling anywhere.
 */
export function FuturesPositionProtectionCell({
  positionId,
  protection,
  onSaved,
}: {
  positionId: string;
  /** Server state. `null` means the payload has not said yet — unknown, not
   *  "none" — so the trigger is rendered as a dash rather than "Not set". */
  protection: PositionProtection | null;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Viewport coordinates for the open editor. See `placeEditor`. */
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const tp = protection?.takeProfit ?? null;
  const sl = protection?.stopLoss ?? null;

  /**
   * Where the editor goes.
   *
   * The positions table scrolls inside `overflow: auto`, so an absolutely
   * positioned child is CLIPPED by that box — on a 390px screen the editor
   * ran past the fold and part of it could not be reached at all. Fixed
   * positioning escapes the scroll container, and the panel is flipped above
   * the trigger when there is not room below it, then clamped to a 12px
   * gutter so it is fully on screen at any width.
   */
  function placeEditor() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect || typeof window === 'undefined') return null;
    const gutter = 12;
    const width = Math.min(EDITOR_WIDTH, window.innerWidth - gutter * 2);
    const left = Math.max(gutter, Math.min(rect.right - width, window.innerWidth - width - gutter));
    const below = rect.bottom + 6;
    const fitsBelow = below + EDITOR_HEIGHT <= window.innerHeight - gutter;
    const top = fitsBelow
      ? below
      : Math.max(gutter, rect.top - EDITOR_HEIGHT - 6);
    return { left, top };
  }

  // Seed the draft from server state each time the editor opens, so a
  // half-typed value from a previous visit can never be mistaken for
  // something that is actually armed.
  function openEditor() {
    setTakeProfit(tp ? tp.triggerPrice : '');
    setStopLoss(sl ? sl.triggerPrice : '');
    setError(null);
    setPlace(placeEditor());
    setOpen(true);
  }

  function closeEditor() {
    setOpen(false);
    setError(null);
    setPlace(null);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEditor();
    };
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node;
      if (popoverRef.current?.contains(node) || triggerRef.current?.contains(node)) return;
      closeEditor();
    };
    // A fixed-position panel would drift away from its trigger if the table
    // scrolled under it, so it is RE-ANCHORED on scroll and resize. It is
    // deliberately not closed: momentum scrolling on a phone keeps firing
    // for a moment after the tap that opened it, and an editor that snaps
    // shut in your hand is worse than one that follows its row. It closes
    // only once the row it belongs to has left the screen entirely.
    const onReflow = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gone = rect.bottom < 0 || rect.top > window.innerHeight;
      if (gone) closeEditor();
      else setPlace(placeEditor());
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onReflow);
    document.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onReflow);
      document.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      // An empty field is an explicit "no trigger on this side". PUT
      // replaces the whole protection, so this is how one leg is removed.
      await api.setFuturesPositionProtection(positionId, {
        takeProfit: takeProfit.trim() === '' ? null : takeProfit.trim(),
        stopLoss: stopLoss.trim() === '' ? null : stopLoss.trim(),
      });
      setOpen(false);
      onSaved();
    } catch (err) {
      // The editor STAYS OPEN and the chips stay on the old server state.
      // A failed save must not look like a successful one.
      reportFailure(err);
    } finally {
      setSaving(false);
    }
  }

  async function removeAll() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.clearFuturesPositionProtection(positionId);
      setOpen(false);
      onSaved();
    } catch (err) {
      reportFailure(err);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Two server states get their own words, because they are not bugs and the
   * trader can act on them:
   *
   *   409 PROTECTION_TRIGGERING  a trigger on this position is executing.
   *       Nothing was changed, and nothing CAN be — there is no honest way to
   *       recall a market order already in the book. The row is refreshed so
   *       it shows what is really happening rather than the stale chips.
   *   503 MARK_PRICE_UNAVAILABLE  no futures mark price to arm against.
   *       Removing protection still works, which is the important half.
   *
   * Anything else keeps the server's own message. In every case the editor
   * stays open and the chips stay on server state.
   */
  function reportFailure(err: unknown) {
    const code = err instanceof ApiError ? err.body?.code : undefined;
    if (code === 'PROTECTION_TRIGGERING') {
      setError(t('futures.protectionTriggering'));
      // Show the truth: the trigger is firing, so repaint from the server.
      onSaved();
      return;
    }
    if (code === 'MARK_PRICE_UNAVAILABLE') {
      setError(t('futures.protectionNoMarkPrice'));
      return;
    }
    setError(err instanceof ApiError ? err.message : t('futures.protectionError'));
  }

  const hasAny = Boolean(tp || sl);

  return (
    <div className="fut-tpsl" style={styles.cell}>
      <button
        ref={triggerRef}
        type="button"
        className="fut-tpslTrigger"
        onClick={() => (open ? closeEditor() : openEditor())}
        aria-expanded={open}
        style={styles.trigger}
      >
        {protection === null ? (
          <span style={styles.dash}>—</span>
        ) : hasAny ? (
          <span style={styles.chips}>
            {tp && (
              <span className="fut-tpslChip" style={{ ...styles.chip, ...styles.chipTp }}>
                {t('futures.takeProfitShort')} {tp.triggerPrice}
                {tp.status === 'FAILED' && <em style={styles.retry}> {t('futures.protectionRetrying')}</em>}
              </span>
            )}
            {sl && (
              <span className="fut-tpslChip" style={{ ...styles.chip, ...styles.chipSl }}>
                {t('futures.stopLossShort')} {sl.triggerPrice}
                {sl.status === 'FAILED' && <em style={styles.retry}> {t('futures.protectionRetrying')}</em>}
              </span>
            )}
          </span>
        ) : (
          <span style={styles.setLabel}>{t('futures.tpsl')}</span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="fut-tpslPopover"
          role="dialog"
          aria-label={t('futures.protectionTitle')}
          style={place ? { ...styles.popover, left: place.left, top: place.top } : styles.popoverFallback}
        >
          <form onSubmit={submit} style={styles.form}>
            <div style={styles.title}>{t('futures.protectionTitle')}</div>

            <label style={styles.field}>
              <span style={styles.label}>{t('futures.takeProfitLabel')}</span>
              <input
                className="fut-tpslInput"
                inputMode="decimal"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                placeholder={tp ? tp.triggerPrice : t('futures.protectionNotSet')}
                style={styles.input}
              />
            </label>

            <label style={styles.field}>
              <span style={styles.label}>{t('futures.stopLossLabel')}</span>
              <input
                className="fut-tpslInput"
                inputMode="decimal"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder={sl ? sl.triggerPrice : t('futures.protectionNotSet')}
                style={styles.input}
              />
            </label>

            <p style={styles.hint}>{t('futures.protectionMarkHint')}</p>

            {error && <div className="fut-tpslError" style={styles.error}>{error}</div>}

            <div style={styles.actions}>
              <button type="submit" className="fut-tpslSave" disabled={saving} style={styles.save}>
                {saving ? t('futures.protectionSaving') : t('futures.protectionSave')}
              </button>
              {hasAny && (
                <button type="button" className="fut-tpslRemove" onClick={removeAll} disabled={saving} style={styles.secondary}>
                  {t('futures.protectionRemove')}
                </button>
              )}
              <button type="button" onClick={closeEditor} disabled={saving} style={styles.secondary}>
                {t('futures.protectionCancel')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  cell: { position: 'relative', display: 'inline-block' },
  trigger: {
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    maxWidth: 190,
  },
  setLabel: { color: 'var(--text-secondary)' },
  dash: { color: 'var(--text-tertiary)' },
  chips: { display: 'inline-flex', gap: 4, flexWrap: 'wrap' },
  chip: { borderRadius: 4, padding: '1px 5px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' },
  chipTp: { background: 'var(--buy-dim)', color: 'var(--buy)' },
  chipSl: { background: 'var(--sell-dim)', color: 'var(--sell)' },
  retry: { fontStyle: 'normal', opacity: 0.75 },
  popover: {
    // Fixed, not absolute: the positions table is a scroll container and an
    // absolutely positioned editor is clipped by it.
    position: 'fixed',
    zIndex: 40,
    width: EDITOR_WIDTH,
    maxWidth: 'calc(100vw - 24px)',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: '0 12px 32px -12px rgba(0,0,0,0.45)',
    padding: 12,
  },
  /** Only reachable with no layout to measure (a non-browser render). */
  popoverFallback: {
    position: 'absolute',
    right: 0,
    top: 'calc(100% + 6px)',
    zIndex: 40,
    width: EDITOR_WIDTH,
    maxWidth: 'calc(100vw - 24px)',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: '0 12px 32px -12px rgba(0,0,0,0.45)',
    padding: 12,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 8 },
  title: { fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' },
  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  label: { fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em' },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 12,
    color: 'var(--text-primary)',
    width: '100%',
  },
  hint: { margin: 0, fontSize: 10, lineHeight: 1.4, color: 'var(--text-tertiary)' },
  error: { background: 'var(--sell-dim)', color: 'var(--sell)', padding: '5px 8px', borderRadius: 6, fontSize: 10 },
  actions: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  save: {
    flex: 1,
    minWidth: 72,
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 700,
  },
  secondary: {
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
};
