import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLanguage } from '../lib/i18n';

export function AccountPanelToggle({ compact, onToggle, controls }: {
  compact: boolean; onToggle: () => void; controls: string;
}) {
  const { t } = useLanguage();
  const label = t(compact ? 'trade.expandAccountPanel' : 'trade.collapseAccountPanel');
  const Icon = compact ? ChevronUp : ChevronDown;
  return <button type="button" className="terminal-account-toggle" onClick={onToggle}
    aria-expanded={!compact} aria-controls={controls} aria-label={label} title={label}>
    <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
  </button>;
}
