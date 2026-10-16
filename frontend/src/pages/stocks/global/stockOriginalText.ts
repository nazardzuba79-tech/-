import type { Lang } from '../../../lib/i18n';
const COPY: Record<Lang, { subtitle: string; indices: string; sector: string; waitingQuote: string }> = {
  ru: { subtitle: 'Мировые рынки в одном месте', indices: 'Обзор индексов', sector: 'Сектор: нет данных', waitingQuote: 'Ожидаем новую котировку для этой торговой сессии. Заявки пока недоступны.' },
  en: { subtitle: 'Global markets in one place', indices: 'Index overview', sector: 'Sector: unavailable', waitingQuote: 'Waiting for a new quote for this trading session. Orders are not available yet.' },
  es: { subtitle: 'Los mercados mundiales en un solo lugar', indices: 'Resumen de índices', sector: 'Sector: no disponible', waitingQuote: 'Esperando una nueva cotización para esta sesión. Las órdenes aún no están disponibles.' },
  zh: { subtitle: '全球市场，尽在一处', indices: '指数概览', sector: '行业：暂无数据', waitingQuote: '正在等待本交易会话的新报价，暂时无法提交订单。' },
  hi: { subtitle: 'दुनिया के बाजार एक जगह', indices: 'सूचकांक अवलोकन', sector: 'क्षेत्र: उपलब्ध नहीं', waitingQuote: 'इस ट्रेडिंग सत्र के लिए नए भाव की प्रतीक्षा है। अभी ऑर्डर उपलब्ध नहीं हैं।' },
  ja: { subtitle: '世界の市場を一か所に', indices: '指数一覧', sector: '業種：データなし', waitingQuote: 'この取引セッションの新しい価格を待っています。まだ注文できません。' },
  ko: { subtitle: '세계 시장을 한곳에서', indices: '지수 개요', sector: '업종: 데이터 없음', waitingQuote: '이번 거래 세션의 새 시세를 기다리고 있습니다. 아직 주문할 수 없습니다.' },
};
export const originalStocksText = (lang: Lang) => COPY[lang];
