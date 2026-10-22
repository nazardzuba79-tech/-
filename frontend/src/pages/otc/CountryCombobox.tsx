import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { localeOf, useLanguage } from '../../lib/i18n';
import { COUNTRY_CODES, countryName } from './otcConfig';

interface CountryItem { code: string; label: string }

/** Case- and accent-blind, so «турц», «Turk» and «españa» all find a match. */
function fold(text: string, locale: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase(locale);
}

/**
 * The «Страна получения» picker: a typeahead over the country directory,
 * named and sorted in the reader's language. The WAI-ARIA combobox pattern
 * with a listbox popup — arrow keys move, Enter picks, Escape closes, and
 * leaving the field without picking restores what was chosen before.
 */
export function CountryCombobox({ id, value, onChange }: {
  id: string;
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = localeOf(lang);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo<CountryItem[]>(() => {
    const collator = new Intl.Collator(locale);
    return COUNTRY_CODES
      .map((code) => ({ code, label: countryName(code, locale) }))
      .sort((a, b) => collator.compare(a.label, b.label));
  }, [locale]);
  const selected = items.find((item) => item.code === value) ?? null;

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);

  // Typing filters; an untouched field (or one that still reads the chosen
  // country) shows the whole directory.
  const query = open && text !== (selected?.label ?? '') ? fold(text.trim(), locale) : '';
  const matches = query ? items.filter((item) => fold(item.label, locale).includes(query)) : items;
  const shown = open ? text : selected?.label ?? '';

  function openList() {
    if (open) return;
    setText(selected?.label ?? '');
    const at = selected ? items.indexOf(selected) : 0;
    setActive(at < 0 ? 0 : at);
    setOpen(true);
    requestAnimationFrame(() => scrollToOption(at < 0 ? 0 : at));
  }
  function close() {
    setOpen(false);
    setText('');
  }
  function pick(item: CountryItem) {
    onChange(item.code);
    close();
  }
  function scrollToOption(index: number) {
    const option = listRef.current?.children[index] as HTMLElement | undefined;
    option?.scrollIntoView({ block: 'nearest' });
  }
  function move(delta: number) {
    if (!open) { openList(); return; }
    if (!matches.length) return;
    const next = (active + delta + matches.length) % matches.length;
    setActive(next);
    scrollToOption(next);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter') {
      if (open && matches[active]) { event.preventDefault(); pick(matches[active]); }
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); close(); }
    }
  }

  const activeId = open && matches[active] ? `${listId}-${matches[active].code}` : undefined;

  return (
    <div
      className="otc-combo"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <div className="otc-field">
        <input
          ref={inputRef}
          className="otc-input"
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('otc.form.countryPlaceholder')}
          value={shown}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            if (!open) setOpen(true);
            listRef.current?.scrollTo({ top: 0 });
          }}
          onClick={openList}
          onKeyDown={onKeyDown}
        />
        {selected && (
          <button
            type="button"
            className="otc-combo-btn otc-combo-clear"
            aria-label={t('otc.form.countryClear')}
            onClick={() => { onChange(null); close(); inputRef.current?.focus(); }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="otc-combo-btn"
          tabIndex={-1}
          aria-hidden="true"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { if (open) close(); else { openList(); inputRef.current?.focus(); } }}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={t('otc.form.country')}
        className="otc-combo-list"
        hidden={!open || !matches.length}
      >
        {matches.map((item, index) => (
          <li
            key={item.code}
            id={`${listId}-${item.code}`}
            role="option"
            aria-selected={item.code === value}
            className={`otc-combo-option${index === active ? ' is-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => { if (index !== active) setActive(index); }}
            onClick={() => pick(item)}
          >
            {item.label}
            {item.code === value && <Check size={16} aria-hidden="true" />}
          </li>
        ))}
      </ul>
      {open && !matches.length && (
        <div className="otc-combo-list" role="status">
          <div className="otc-combo-empty">{t('otc.form.countryEmpty')}</div>
        </div>
      )}
    </div>
  );
}
