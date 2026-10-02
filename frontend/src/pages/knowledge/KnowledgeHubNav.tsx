import { Link } from 'react-router-dom';
import { useLanguage } from '../../lib/i18n';

export type KnowledgeHubTab = 'home' | 'learn' | 'knowledge' | 'faq' | 'glossary';

const TABS: { id: KnowledgeHubTab; to: string; key: string }[] = [
  { id: 'home', to: '/academy', key: 'academy.hub.home' },
  { id: 'learn', to: '/academy/learn', key: 'academy.hub.learn' },
  { id: 'knowledge', to: '/academy/knowledge', key: 'academy.hub.knowledge' },
  { id: 'faq', to: '/academy/faq', key: 'academy.hub.faq' },
  { id: 'glossary', to: '/academy/glossary', key: 'academy.hub.glossary' },
];

export function KnowledgeHubNav({ active }: { active: KnowledgeHubTab }) {
  const { t } = useLanguage();
  return (
    <nav className="vx-kb-hub-tabs" aria-label={t('nav.academy')}>
      {TABS.map(tab => (
        <Link key={tab.id} to={tab.to} aria-current={active === tab.id ? 'page' : undefined} data-knowledge-tab={tab.id}>
          {t(tab.key as never)}
        </Link>
      ))}
    </nav>
  );
}
