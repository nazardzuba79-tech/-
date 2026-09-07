import { useLanguage } from '../../lib/i18n';
import { cardCopy } from './data/cardCopy';
import { cardHeroCopyRu } from './data/cardCopy.ru';

export function useCardCopy(scope?: 'hero') {
  const { lang } = useLanguage();
  const c = scope === 'hero' && lang === 'ru' ? { ...cardCopy[lang], ...cardHeroCopyRu } : cardCopy[lang];
  return { c, lang };
}
