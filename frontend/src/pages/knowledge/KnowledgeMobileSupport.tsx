import { Headset } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { openSupportWidget } from '../../lib/supportWidget';
import './knowledgeMobileSupport.css';

/** A normal document-flow action replaces the floating launcher on phones.
 * Reuses the existing global support dialog, not a second widget or transport. */
export function KnowledgeMobileSupport() {
  const { t } = useLanguage();
  return (
    <div className="vx-kb-mobile-support" data-kb-inline-support>
      <button type="button" onClick={openSupportWidget} aria-haspopup="dialog" aria-controls="voltex-assistant-panel">
        <Headset size={18} strokeWidth={1.7} aria-hidden="true" />
        {t('support.title')}
      </button>
    </div>
  );
}
