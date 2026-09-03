import { ClipboardEvent, KeyboardEvent, MutableRefObject, useRef } from 'react';
import { useLanguage } from '../../lib/i18n';

type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Fired when the sixth digit lands, so the form can submit without the
   *  user hunting for the button. */
  onComplete?: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  length?: number;
  /** Lets the panel put focus back on the first cell after a rejected code. */
  firstCellRef?: MutableRefObject<HTMLInputElement | null>;
};

/**
 * Six digit cells that behave as one field.
 *
 * Each cell is a real <input> with its own label, so a screen reader
 * announces position ("Цифра 3 из 6") rather than six anonymous boxes, and
 * the group carries the error via aria-describedby from the panel.
 *
 * Paste is handled on the group: pasting "123456" (or "123 456", or a code
 * copied with surrounding text) fills every cell and moves focus to the end,
 * which is how most people actually transfer a code from their mail client.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  invalid = false,
  disabled = false,
  length = 6,
  firstCellRef,
}: OtpInputProps) {
  const { t } = useLanguage();
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const commit = (next: string) => {
    const trimmed = next.replace(/\D/g, '').slice(0, length);
    onChange(trimmed);
    if (trimmed.length === length) onComplete?.(trimmed);
  };

  /**
   * Reads the code out of the cells themselves rather than out of the
   * `value` prop.
   *
   * Six keystrokes in quick succession — a fast typist, or the OS filling a
   * one-time code — can land inside a single React render, and every handler
   * in that batch closes over the SAME stale `value`. Rebuilding from the
   * prop then loses every digit but the last one, which showed up as a
   * verification failing on a code the user had typed correctly. The DOM
   * always holds what is on screen at that instant, so it is the safe source.
   */
  const readCells = () => refs.current.map((el) => (el?.value ?? '').replace(/\D/g, '').slice(-1) || '');

  const handleChange = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');

    if (digits.length > 1) {
      // Several digits at once (typed fast, dropped, or autofilled) flow
      // forward from this cell.
      const cells = readCells();
      const merged = (cells.slice(0, index).join('') + digits).slice(0, length);
      commit(merged);
      refs.current[Math.min(merged.length, length - 1)]?.focus();
      return;
    }

    const cells = readCells();
    cells[index] = digits.slice(-1);
    commit(cells.join(''));
    if (digits && index < length - 1) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !(refs.current[index]?.value ?? '') && index > 0) {
      e.preventDefault();
      const cells = readCells();
      cells[index - 1] = '';
      commit(cells.join(''));
      refs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!digits) return;
    e.preventDefault();
    commit(digits);
    refs.current[Math.min(digits.length, length - 1)]?.focus();
  };

  return (
    <div className="flex gap-2" role="group" aria-label={t('register.otpGroupLabel')} onPaste={handlePaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
            if (i === 0 && firstCellRef) firstCellRef.current = el;
          }}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          // One-time-code autofill: the browser/OS offers the code straight
          // from the SMS/mail notification on the first cell.
          autoComplete="one-time-code"
          maxLength={length}
          disabled={disabled}
          aria-label={t('register.otpDigitLabel').replace('{n}', String(i + 1)).replace('{total}', String(length))}
          aria-invalid={invalid || undefined}
          className={`h-[46px] w-full min-w-0 rounded-[7px] border bg-ink-850 text-center font-mono text-[16px] text-white outline-none transition-colors duration-150 ease-out focus:border-gold-500 focus:bg-ink-800 disabled:opacity-60 ${
            invalid ? 'border-down/70' : 'border-line'
          }`}
        />
      ))}
    </div>
  );
}
