import { Link } from 'react-router-dom';
import { useLanguage } from '../../lib/i18n';

export type AcademyHubTab = 'home' | 'learn' | 'knowledge' | 'faq' | 'glossary';

const TABS: { id: AcademyHubTab; to: string; label: 'academy.hub.home' | 'academy.hub.learn' | 'academy.hub.knowledge' | 'help.tab.faq' | 'academy.glossary' }[] = [
  { id: 'home', to: '/academy', label: 'academy.hub.home' },
  { id: 'learn', to: '/academy/learn', label: 'academy.hub.learn' },
  { id: 'knowledge', to: '/academy/knowledge', label: 'academy.hub.knowledge' },
  { id: 'faq', to: '/academy/faq', label: 'help.tab.faq' },
  { id: 'glossary', to: '/academy/glossary', label: 'academy.glossary' },
];

export function AcademyHubNav({ active }: { active: AcademyHubTab }) {
  const { t } = useLanguage();
  return (
    <nav className="vx-kb-tabs" aria-label={t('nav.academy')} data-academy-hub>
      {TABS.map((tab) => (
        <Link key={tab.id} to={tab.to} aria-current={active === tab.id ? 'page' : undefined} data-academy-hub-tab={tab.id}>
          {t(tab.label)}
        </Link>
      ))}
    </nav>
  );
}
