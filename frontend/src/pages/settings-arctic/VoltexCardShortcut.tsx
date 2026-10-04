import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../lib/i18n';

/**
 * VOLTEX Card's own small mark: a card outline with a chip and the gold «L»
 * of the VOLTEX wordmark in its corner. One gold detail on a monochrome
 * body, legible at 16–20 px. Original drawing — not a stock card glyph and
 * nothing taken from another exchange.
 */
export function VoltexCardMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 22 16" fill="none" aria-hidden="true" className={className}>
      <rect x="1" y="1" width="20" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="5" width="4.5" height="3.5" rx="0.9" fill="currentColor" opacity="0.55" />
      <path d="M15 5.5V10.5H18" className="stroke-gold-500" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A second way to the Crypto Card from Settings — calmer than the Wallet's
 * gold tile: neutral surface, hairline border, one compact row. It is a
 * link to /card, not a Settings tab, so it sits apart from the tab list.
 */
export function VoltexCardShortcut({ className = '' }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <Link
      to="/card"
      data-settings-card-link
      title={t('settings.cardShortcutTitle')}
      aria-label={t('settings.cardShortcutTitle')}
      className={`group flex h-11 min-w-0 items-center gap-3 rounded-xl border border-solid border-border bg-card px-3 text-[13.5px] font-medium text-foreground no-underline transition-colors duration-150 hover:border-[oklch(0.86_0.006_258)] hover:bg-secondary focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--accent-dim)] ${className}`}
    >
      <VoltexCardMark className="h-4 w-[22px] shrink-0 text-[var(--text-secondary)] transition-colors group-hover:text-foreground" />
      <span className="min-w-0 flex-1 truncate">VOLTEX Card</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground" aria-hidden="true" />
    </Link>
  );
}
