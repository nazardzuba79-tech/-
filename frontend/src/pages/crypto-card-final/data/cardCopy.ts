import { cardCopyRu, type CardCopy } from './cardCopy.ru';
import { cardCopyTranslations } from './cardCopyTranslations';

/** Complete page-local dictionaries: unrelated Home/Auth copy is unchanged. */
export const cardCopy: Record<'ru' | 'en' | 'zh' | 'es' | 'hi' | 'ja' | 'ko', CardCopy> = {
  ru: cardCopyRu,
  ...cardCopyTranslations,
};
