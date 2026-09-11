import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';

/**
 * The margin-mode and leverage controls.
 *
 * TWO triggers side by side, each opening its own popover — the
 * arrangement every derivatives terminal uses, and the one the owner
 * asked for. They replaced a single combined summary button, which in
 * turn had replaced two full-width stacked controls; the point of that
 * consolidation is kept, because a popover still costs no permanent
 * height and the panel still has exactly ONE persistent slider, position
 * size.
 *
 * This is a different UI over the SAME values. Every bound it enforces
 * comes from the caller: `min` is `config.minLeverage`, `max` is the live
 * `effectiveMaxLeverage` (already the minimum of `config.maxLeverage` and
 * the resulting tier's ceiling), and `warningThreshold` is
 * `config.highLeverageWarningThreshold`. Nothing here computes a tier, a
 * margin requirement or a liquidation price.
 *
 * `max` is `null` when the account state needed to derive the ceiling is
 * unknown (see PR #14): the control renders disabled rather than offering
 * a leverage it cannot justify.
 */

/** Offered leverages, before the live ceiling is applied. The ceiling
 *  itself is always appended, so a tier max of 20x shows 1/5/10/20 and
 *  never an actionable 50x. */
const LEVERAGE_PRESETS = [1, 5, 10, 20, 50, 100];

export function FuturesMarginLeverage({
  marginType,
  onMarginTypeChange,
  leverage,
  onLeverageChange,
  min,
  max,
  warningThreshold,
}: {
  marginType: 'ISOLATED' | 'CROSS';
  onMarginTypeChange: (v: 'ISOLATED' | 'CROSS') => void;
  leverage: number;
  onLeverageChange: (v: number) => void;
  min: number;
  /** null = the effective ceiling is not known yet. */
  max: number | null;
  warningThreshold: number;
}) {
  const { t } = useLanguage();
  /** Which popover is open — at most one, so the two never overlap. */
  const [open, setOpen] = useState<null | 'margin' | 'leverage'>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const disabled = max === null;
  const isHigh = leverage >= warningThreshold;

  // Outside click and Escape both close it, and Escape returns focus to
  // the trigger so keyboard users are not stranded.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(null);
      triggerRef.current?.focus();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // A ceiling that drops below the current selection (a bigger order moved
  // the trader into a lower tier) must not leave a stale higher number on
  // screen; the form clamps the value, and this closes the popover so the
  // chips are re-read rather than re-clicked from memory.
  useEffect(() => {
    if (disabled) setOpen(null);
  }, [disabled]);

  /** Presets never exceed the live ceiling, and the ceiling is always
   *  offered — so "the highest allowed leverage" is always one click. */
  const chips = max === null
    ? []
    : Array.from(new Set([...LEVERAGE_PRESETS.filter((p) => p >= min && p <= max), max]))
        .filter((p) => p >= min)
        .sort((a, b) => a - b);

  const clamp = (next: number) => {
    if (max === null) return leverage;
    return Math.min(max, Math.max(min, Math.round(next)));
  };

  return (
    <div className="fo-mlWrap" ref={wrapRef}>
      {/* MARGIN MODE and LEVERAGE, as two separate controls. */}
      <div className="fo-mlRow">
        <button
          ref={triggerRef}
          type="button"
          className="fo-mlTrigger"
          aria-haspopup="dialog"
          aria-expanded={open === 'margin'}
          disabled={disabled}
          onClick={() => setOpen((v) => (v === 'margin' ? null : 'margin'))}
        >
          <span className="fo-mlTriggerText">
            {marginType === 'ISOLATED' ? t('futures.isolated') : t('futures.cross')}
          </span>
          <span className="fo-mlChevron" aria-hidden="true">▾</span>
        </button>

        <button
          type="button"
          className="fo-mlTrigger fo-mlTriggerLevBtn"
          aria-haspopup="dialog"
          aria-expanded={open === 'leverage'}
          aria-label={t('futures.leverage')}
          disabled={disabled}
          onClick={() => setOpen((v) => (v === 'leverage' ? null : 'leverage'))}
        >
          <span className={`mono fo-mlTriggerLev ${isHigh ? 'fo-mlHigh' : ''}`}>
            {max === null ? '—' : `${leverage.toFixed(2)}x`}
          </span>
          <span className="fo-mlChevron" aria-hidden="true">▾</span>
        </button>
      </div>

      {open === 'margin' && max !== null && (
        <div className="fo-mlPopover" role="dialog" aria-label={t('futures.marginType')}>
          <div className="fo-mlSection">
            <div className="fo-mlSectionTitle">{t('futures.marginType')}</div>
            <div className="fo-mlModeRow">
              {(['ISOLATED', 'CROSS'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`fo-mlMode ${marginType === mode ? 'fo-mlModeActive' : ''}`}
                  aria-pressed={marginType === mode}
                  onClick={() => onMarginTypeChange(mode)}
                >
                  {mode === 'ISOLATED' ? t('futures.isolated') : t('futures.cross')}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {open === 'leverage' && max !== null && (
        <div className="fo-mlPopover fo-mlPopoverRight" role="dialog" aria-label={t('futures.leverage')}>
          <div className="fo-mlSection">
            <div className="fo-mlSectionTitle">
              {t('futures.leverage')}
              <span className="mono fo-mlRange">{min}x – {max}x</span>
            </div>
            {/* A numeric stepper, deliberately not a second slider. */}
            <div className="fo-mlStepper">
              <button
                type="button"
                className="fo-mlStep"
                aria-label="-1x"
                disabled={leverage <= min}
                onClick={() => onLeverageChange(clamp(leverage - 1))}
              >
                −
              </button>
              <input
                className="mono fo-mlValue"
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step={1}
                value={leverage}
                aria-label={t('futures.leverage')}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next)) onLeverageChange(clamp(next));
                }}
              />
              <button
                type="button"
                className="fo-mlStep"
                aria-label="+1x"
                disabled={leverage >= max}
                onClick={() => onLeverageChange(clamp(leverage + 1))}
              >
                +
              </button>
            </div>
            <div className="fo-mlChips">
              {chips.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`fo-mlChip ${leverage === preset ? 'fo-mlChipActive' : ''}`}
                  aria-pressed={leverage === preset}
                  onClick={() => onLeverageChange(clamp(preset))}
                >
                  {preset}x
                </button>
              ))}
            </div>
            {isHigh && <div className="fo-mlWarn">{t('futures.leverageWarningTitle')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
