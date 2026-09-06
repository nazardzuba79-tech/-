import { createContext, useContext, type ReactNode } from 'react';
import { useLanguage, type Lang } from '../lib/i18n';
import './copyTradingNotice.css';

const CopyTradingNoticeContext = createContext(false);

export const COPY_TRADING_NOTICE_COPY: Record<Lang, string> = {
  ru: 'Результаты Copy Trading смоделированы и не являются доходностью реальных счетов. Каталог включает вымышленные профили и аватары.',
  en: 'Copy Trading results are modeled, not real-account performance. The catalogue includes fictional profiles and avatars.',
  zh: '跟单交易结果为建模数据，并非真实账户业绩。目录包含虚构的资料和头像。',
  es: 'Los resultados de Copy Trading son modelados, no el rendimiento de cuentas reales. El catálogo incluye perfiles y avatares ficticios.',
  hi: 'Copy Trading के परिणाम मॉडल किए गए हैं, वास्तविक खातों का प्रदर्शन नहीं हैं। कैटलॉग में काल्पनिक प्रोफ़ाइल और अवतार शामिल हैं।',
  ja: 'コピートレードの結果はモデル化されたもので、実口座の運用実績ではありません。カタログには架空のプロフィールとアバターが含まれます。',
  ko: '카피 트레이딩 결과는 모델링된 데이터이며 실제 계좌의 운용 성과가 아닙니다. 목록에는 가상의 프로필과 아바타가 포함됩니다.',
};

/** One in-flow results explanation, confined to the Copy Trading workspace.
 * Keeping the notice and its context together prevents silent suppression. */
export function CopyTradingNoticeScope({ children }: { children: ReactNode }) {
  const { lang } = useLanguage();
  return <CopyTradingNoticeContext.Provider value={true}>
    <p className="copy-trading-notice" data-copy-trading-notice="true">{COPY_TRADING_NOTICE_COPY[lang]}</p>
    {children}
  </CopyTradingNoticeContext.Provider>;
}

export function useCopyTradingNotice() {
  return useContext(CopyTradingNoticeContext);
}
