import type { Lang } from '../../lib/i18n';

const EN = {
  pause: 'Pause market tape', resume: 'Resume market tape', feed: 'Market feed',
  observed: 'Prices observed during this visit', waiting: 'Collecting price observations',
  refresh: 'Snapshot refreshed every 6 hours', candles: '15-minute candles',
};
export const homeLiveCopy: Record<Lang, typeof EN> = {
  en: EN,
  ru: { pause: 'Приостановить ленту', resume: 'Продолжить ленту', feed: 'Рыночные данные',
    observed: 'Цены, полученные за время посещения', waiting: 'Собираем наблюдения цены',
    refresh: 'Снимок обновляется каждые 6 часов', candles: 'Свечи за 15 минут' },
  zh: { pause: '暂停行情带', resume: '继续行情带', feed: '市场行情',
    observed: '本次访问期间收到的价格', waiting: '正在收集价格记录', refresh: '市场快照每6小时更新', candles: '15分钟K线' },
  es: { pause: 'Pausar cotizaciones', resume: 'Reanudar cotizaciones', feed: 'Datos de mercado',
    observed: 'Precios recibidos durante esta visita', waiting: 'Recopilando precios',
    refresh: 'La instantánea se actualiza cada 6 horas', candles: 'Velas de 15 minutos' },
  hi: { pause: 'बाज़ार पट्टी रोकें', resume: 'बाज़ार पट्टी जारी रखें', feed: 'बाज़ार डेटा',
    observed: 'इस विज़िट के दौरान प्राप्त कीमतें', waiting: 'कीमतें एकत्र की जा रही हैं',
    refresh: 'मार्केट स्नैपशॉट हर 6 घंटे में अपडेट होता है', candles: '15-मिनट कैंडल' },
  ja: { pause: 'ティッカーを一時停止', resume: 'ティッカーを再開', feed: '市場データ',
    observed: '今回のアクセス中に取得した価格', waiting: '価格データを収集中',
    refresh: '市場スナップショットは6時間ごとに更新', candles: '15分足' },
  ko: { pause: '시세 티커 일시 정지', resume: '시세 티커 재개', feed: '시장 데이터',
    observed: '이번 방문 중 수신한 가격', waiting: '가격 기록 수집 중',
    refresh: '시장 스냅샷은 6시간마다 갱신', candles: '15분 봉' },
};
