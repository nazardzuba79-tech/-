import { useLanguage, type Lang } from '../lib/i18n';

export const REVIEW_MODELED_LABEL: Record<Lang, string> = {
  ru: 'Смоделированные результаты',
  en: 'Modeled results',
  zh: '模拟结果',
  es: 'Resultados modelados',
  hi: 'मॉडल किए गए परिणाम',
  ja: 'モデル化された結果',
  ko: '모델링된 결과',
};

/** Local provenance only: no banner, account access or financial computation. */
export function ReviewModeledLabel() {
  const { lang } = useLanguage();
  return import.meta.env.MODE === 'review'
    ? <small className="review-modeled-label">{REVIEW_MODELED_LABEL[lang]}</small>
    : null;
}
