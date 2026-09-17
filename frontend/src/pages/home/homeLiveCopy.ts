import type { Lang } from '../../lib/i18n';

const EN = {
  pause: 'Pause market tape', resume: 'Resume market tape', feed: 'Market feed',
  observed: 'Real prices captured by the homepage', waiting: 'Waiting for the next market snapshot',
  refresh: 'Refreshes every 6 hours', candles: '15-minute candles',
};
export const homeLiveCopy: Record<Lang, typeof EN> = {
  en: EN,
  ru: { pause: 'Приостановить ленту', resume: 'Продолжить ленту', feed: 'Рыночные данные',
    observed: 'Реальные цены, полученные главной страницей', waiting: 'Ожидаем следующий снимок рынка',
    refresh: 'Обновление раз в 6 часов', candles: 'Свечи за 15 минут' },
  zh: { pause: '暂停行情带', resume: '继续行情带', feed: '市场行情',
    observed: '主页获取的真实价格', waiting: '等待下一次市场快照', refresh: '每6小时更新', candles: '15分钟K线' },
  es: { pause: 'Pausar cotizaciones', resume: 'Reanudar cotizaciones', feed: 'Datos de mercado',
    observed: 'Precios reales recibidos por la portada', waiting: 'Esperando la siguiente instantánea del mercado',
    refresh: 'Actualización cada 6 horas', candles: 'Velas de 15 minutos' },
  hi: { pause: 'बाज़ार पट्टी रोकें', resume: 'बाज़ार पट्टी जारी रखें', feed: 'बाज़ार डेटा',
    observed: 'मुखपृष्ठ द्वारा प्राप्त वास्तविक कीमतें', waiting: 'अगले बाज़ार स्नैपशॉट की प्रतीक्षा',
    refresh: 'हर 6 घंटे में अपडेट', candles: '15-मिनट कैंडल' },
  ja: { pause: 'ティッカーを一時停止', resume: 'ティッカーを再開', feed: '市場データ',
    observed: 'ホームページが取得した実際の価格', waiting: '次の市場スナップショットを待機中',
    refresh: '6時間ごとに更新', candles: '15分足' },
  ko: { pause: '시세 티커 일시 정지', resume: '시세 티커 재개', feed: '시장 데이터',
    observed: '홈페이지가 받은 실제 가격', waiting: '다음 시장 스냅샷 대기 중',
    refresh: '6시간마다 새로고침', candles: '15분 봉' },
};
