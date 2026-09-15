import type { Lang } from '../../lib/i18n';

/**
 * INSTRUMENT NAMES ARE NOT TRANSLATED.
 *
 * Gold and Oil name traded instruments, the same way BTC/USDT does — and
 * the pill already prints its symbol untranslated underneath ("XAU/USD").
 * Translating the title while leaving the symbol in English made one card
 * speak two languages about the same thing.
 *
 * Spread into every locale below rather than left as seven copies, so a
 * future translation pass cannot quietly localise one language and not
 * the others. The pill renders them uppercase in CSS; the source keeps
 * ordinary casing so the string stays usable anywhere else.
 */
const instruments = { gold: 'Gold', oil: 'Oil' } as const;
const en = { ...instruments, quote: 'Reference quote', pause: 'Pause hero motion', resume: 'Resume hero motion',
  live: 'Kraken · stream', snapshot: 'Market snapshots', unavailable: 'Data unavailable', globe: 'Global markets', field: 'A more connected financial world' };
export const globalHeroCopy: Record<Lang, typeof en> = {
  en,
  ru: { ...instruments, quote: 'Справочная котировка', pause: 'Приостановить движение', resume: 'Продолжить движение', live: 'Kraken · поток', snapshot: 'Рыночные данные', unavailable: 'Данные недоступны', globe: 'Глобальные рынки', field: 'Мир финансов без границ' },
  es: { ...instruments, quote: 'Cotización de referencia', pause: 'Pausar movimiento', resume: 'Reanudar movimiento', live: 'Kraken · en directo', snapshot: 'Datos de mercado', unavailable: 'Datos no disponibles', globe: 'Mercados globales', field: 'Un mundo financiero más conectado' },
  zh: { ...instruments, quote: '参考报价', pause: '暂停动态效果', resume: '继续动态效果', live: 'Kraken · 实时流', snapshot: '市场快照', unavailable: '数据不可用', globe: '全球市场', field: '更加互联的金融世界' },
  hi: { ...instruments, quote: 'संदर्भ मूल्य', pause: 'एनिमेशन रोकें', resume: 'एनिमेशन जारी रखें', live: 'Kraken · स्ट्रीम', snapshot: 'बाज़ार डेटा', unavailable: 'डेटा अनुपलब्ध', globe: 'वैश्विक बाज़ार', field: 'एक अधिक जुड़ा हुआ वित्तीय संसार' },
  ja: { ...instruments, quote: '参考価格', pause: 'アニメーションを停止', resume: 'アニメーションを再開', live: 'Kraken · ストリーム', snapshot: '市場データ', unavailable: 'データを取得できません', globe: 'グローバル市場', field: '世界の金融をより身近に' },
  ko: { ...instruments, quote: '참고 시세', pause: '모션 일시 정지', resume: '모션 재개', live: 'Kraken · 스트림', snapshot: '시장 데이터', unavailable: '데이터 없음', globe: '글로벌 시장', field: '더 긴밀하게 연결된 금융 세계' },
};
