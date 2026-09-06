import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLanguage, type Lang } from '../lib/i18n';
import './prelaunchNotice.css';

const PrelaunchNoticeContext = createContext(false);

/** One application-level disclosure, inseparable from the context permitting
 * duplicate product disclosures to be omitted. No account role or route gate. */
export const PRELAUNCH_COPY: Record<Lang, string> = {
  ru: 'Внутреннее тестирование. Истории стратегий смоделированы и не являются подтверждённой доходностью реальных счетов.',
  en: 'Internal testing. Strategy histories are modeled, not verified real-account investment performance.',
  zh: '内部测试。策略历史为建模数据，并非经过验证的真实账户投资业绩。',
  es: 'Pruebas internas. Los historiales de estrategias son modelados, no rentabilidades verificadas de cuentas reales.',
  hi: 'आंतरिक परीक्षण। रणनीति इतिहास मॉडल किए गए हैं, वास्तविक खातों का सत्यापित निवेश प्रदर्शन नहीं।',
  ja: '内部テスト中。戦略履歴はモデル化されたもので、実口座の検証済み投資実績ではありません。',
  ko: '내부 테스트 중입니다. 전략 이력은 모델링된 데이터이며 실제 계좌의 검증된 투자 성과가 아닙니다.',
};

export function PrelaunchApplication({ children }: { children: ReactNode }) {
  const { lang } = useLanguage();
  const noticeRef = useRef<HTMLElement>(null);
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    const element = noticeRef.current;
    if (!element) return;
    const measure = () => setHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <PrelaunchNoticeContext.Provider value={true}>
    <div className="voltex-prelaunch-shell" style={height === undefined ? undefined : { '--prelaunch-notice-height': `${height}px` } as CSSProperties}>
      <aside ref={noticeRef} className="voltex-prelaunch-notice" aria-label="VOLTEX DEMO / PRE-LAUNCH">
        <strong>VOLTEX · DEMO / PRE-LAUNCH</strong>
        <span>{PRELAUNCH_COPY[lang]}</span>
      </aside>
      {children}
    </div>
  </PrelaunchNoticeContext.Provider>;
}

export function useGlobalPrelaunchNotice() {
  return useContext(PrelaunchNoticeContext);
}
