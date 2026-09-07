import { useLanguage, type Lang } from '../lib/i18n';

export const REVIEW_MODELED_LABEL: Record<Lang, string> = {
  ru: 'Модельные данные',
  en: 'Modeled data',
  zh: '模拟数据',
  es: 'Datos modelados',
  hi: 'मॉडल किए गए डेटा',
  ja: 'モデル化データ',
  ko: '모델링 데이터',
};

/** Local provenance only: no banner, account access or financial computation. */
export function ReviewModeledLabel({ modeled }: { modeled: boolean }) {
  const { lang } = useLanguage();
  return modeled === true
    ? <small className="review-modeled-label">{REVIEW_MODELED_LABEL[lang]}</small>
    : null;
}
