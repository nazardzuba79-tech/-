import { useLanguage, type Lang } from '../lib/i18n';
import './modeledDataLabel.css';

export const MODELED_DATA_LABEL: Record<Lang, string> = {
  ru: 'Модельные данные',
  en: 'Modeled data',
  zh: '模拟数据',
  es: 'Datos modelados',
  hi: 'मॉडल किए गए डेटा',
  ja: 'モデルデータ',
  ko: '모델 데이터',
};

/** Source provenance only; no environment, account or financial side effects. */
export function ModeledDataLabel({ modeled }: { modeled: boolean }) {
  const { lang } = useLanguage();
  return null;
}
