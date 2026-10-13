import { useMemo } from 'react';
import { localeOf, useLanguage } from '../../../lib/i18n';
import { stockTranslator } from './stockText';
export function useStocksText() {
  const { lang } = useLanguage();
  return useMemo(() => ({ lang, locale: localeOf(lang), s: stockTranslator(lang) }), [lang]);
}
