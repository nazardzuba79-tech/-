import { useLanguage } from '../../lib/i18n';
import { cardCopy } from './data/cardCopy';

export function useCardCopy() {
  const { lang } = useLanguage();
  return { c: cardCopy[lang], lang };
}
