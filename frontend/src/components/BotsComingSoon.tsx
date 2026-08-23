import { useLanguage } from '../lib/i18n';
import { Badge } from './Badge';

/** Non-interactive teaser — no AI trading-bots feature exists yet, so this
 * is deliberately not a link to anything. Replaces the nav's pair selector
 * on the trade page (redundant with the pair list sidebar right below it). */
export function BotsComingSoon() {
  const { t } = useLanguage();
  return (
    <div style={styles.wrap}>
      <BotIcon />
      <span style={styles.label}>{t('nav.bots')}</span>
      <Badge text={t('nav.botsSoon')} color="var(--accent)" bg="var(--accent-dim)" />
    </div>
  );
}

function BotIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M12 9V5" />
      <circle cx="12" cy="4" r="1" />
      <circle cx="9" cy="14" r="1" fill="var(--text-secondary)" />
      <circle cx="15" cy="14" r="1" fill="var(--text-secondary)" />
      <path d="M2 13v3M22 13v3" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '7px 12px',
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
};
