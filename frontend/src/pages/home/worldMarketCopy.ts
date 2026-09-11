import type { Lang } from '../../lib/i18n';

interface WorldMarketCopy {
  worldEyebrow: string;
  worldTitle: string;
  worldDescription: string;
  localTime: string;
  clockNote: string;
  centres: readonly string[];
  heatEyebrow: string;
  heatTitle: string;
  heatDescription: string;
  volumeSizing: string;
  equalSizing: string;
  markets: string;
  price: string;
  change: string;
  volume: string;
  select: string;
  trade: string;
  gain: string;
  loss: string;
  unchanged: string;
  loading: string;
  unavailable: string;
  detailHint: string;
}

// Small, homepage-only additions; approved product copy and dictionaries stay intact.
export const WORLD_MARKET_COPY: Record<Lang, WorldMarketCopy> = {
  ru: {
    worldEyebrow: 'МИРОВЫЕ ФИНАНСОВЫЕ ЦЕНТРЫ', worldTitle: 'Один мир. Разные часовые пояса.',
    worldDescription: 'От Нью-Йорка до Токио — следите за местным временем финансовых центров.',
    localTime: 'Местное время', clockNote: 'Время в городе, не статус биржевой сессии.',
    centres: ['Нью-Йорк', 'Лондон', 'Цюрих', 'Франкфурт', 'Дубай', 'Сингапур', 'Гонконг', 'Токио'],
    heatEyebrow: 'РЫНОК В ОДНОМ ВЗГЛЯДЕ', heatTitle: 'Карта движения рынка',
    heatDescription: 'Изменение за 24 часа. Размер показывает, где сосредоточен объём торгов.',
    volumeSizing: 'Площадь = объём за 24 ч в USDT', equalSizing: 'Равная площадь: объём недоступен',
    markets: 'пар USDT', price: 'Цена, USDT', change: 'Изменение за 24 ч', volume: 'Объём за 24 ч, USDT',
    select: 'Выбрать рынок', trade: 'Открыть рынок', gain: 'Рост', loss: 'Снижение', unchanged: 'Без изменений',
    loading: 'Загружаем рыночные данные…', unavailable: 'Рыночные данные временно недоступны.',
    detailHint: 'Наведите курсор или выберите актив',
  },
  en: {
    worldEyebrow: 'WORLD FINANCIAL CENTRES', worldTitle: 'One world. Every time zone.',
    worldDescription: 'From New York to Tokyo, follow the local time of global financial centres.',
    localTime: 'Local time', clockNote: 'City clocks, not exchange session status.',
    centres: ['New York', 'London', 'Zurich', 'Frankfurt', 'Dubai', 'Singapore', 'Hong Kong', 'Tokyo'],
    heatEyebrow: 'THE MARKET AT A GLANCE', heatTitle: 'The shape of the market',
    heatDescription: '24-hour change. Tile size reveals where trading volume is concentrated.',
    volumeSizing: 'Area = 24h volume in USDT', equalSizing: 'Equal area: volume unavailable',
    markets: 'USDT pairs', price: 'Price, USDT', change: '24h change', volume: '24h volume, USDT',
    select: 'Select market', trade: 'Open market', gain: 'Gaining', loss: 'Declining', unchanged: 'Unchanged',
    loading: 'Loading market data…', unavailable: 'Market data is temporarily unavailable.',
    detailHint: 'Hover or select an asset',
  },
  zh: {
    worldEyebrow: '全球金融中心', worldTitle: '同一个世界，不同的时区。',
    worldDescription: '从纽约到东京，查看全球金融中心的当地时间。',
    localTime: '当地时间', clockNote: '显示城市时间，并非交易所开市状态。',
    centres: ['纽约', '伦敦', '苏黎世', '法兰克福', '迪拜', '新加坡', '香港', '东京'],
    heatEyebrow: '市场一览', heatTitle: '市场热力图',
    heatDescription: '24 小时涨跌幅。色块面积展示交易量的集中分布。',
    volumeSizing: '面积 = 24 小时 USDT 交易量', equalSizing: '等面积：交易量不可用',
    markets: '个 USDT 交易对', price: '价格（USDT）', change: '24 小时涨跌幅', volume: '24 小时交易量（USDT）',
    select: '选择市场', trade: '打开市场', gain: '上涨', loss: '下跌', unchanged: '持平',
    loading: '正在加载市场数据…', unavailable: '市场数据暂不可用。', detailHint: '悬停或选择资产',
  },
  es: {
    worldEyebrow: 'CENTROS FINANCIEROS DEL MUNDO', worldTitle: 'Un mundo. Todas las zonas horarias.',
    worldDescription: 'De Nueva York a Tokio, consulta la hora local de los centros financieros.',
    localTime: 'Hora local', clockNote: 'Hora de cada ciudad, no estado de la sesión bursátil.',
    centres: ['Nueva York', 'Londres', 'Zúrich', 'Fráncfort', 'Dubái', 'Singapur', 'Hong Kong', 'Tokio'],
    heatEyebrow: 'EL MERCADO DE UN VISTAZO', heatTitle: 'El mapa del mercado',
    heatDescription: 'Variación en 24 horas. El área revela dónde se concentra el volumen negociado.',
    volumeSizing: 'Área = volumen de 24 h en USDT', equalSizing: 'Área igual: volumen no disponible',
    markets: 'pares USDT', price: 'Precio, USDT', change: 'Variación en 24 h', volume: 'Volumen de 24 h, USDT',
    select: 'Seleccionar mercado', trade: 'Abrir mercado', gain: 'Suben', loss: 'Bajan', unchanged: 'Sin cambios',
    loading: 'Cargando datos del mercado…', unavailable: 'Datos del mercado temporalmente no disponibles.',
    detailHint: 'Pasa el cursor o selecciona un activo',
  },
  hi: {
    worldEyebrow: 'विश्व के वित्तीय केंद्र', worldTitle: 'एक दुनिया। हर समय क्षेत्र।',
    worldDescription: 'न्यूयॉर्क से टोक्यो तक, वैश्विक वित्तीय केंद्रों का स्थानीय समय देखें।',
    localTime: 'स्थानीय समय', clockNote: 'शहर का समय; एक्सचेंज सत्र की स्थिति नहीं।',
    centres: ['न्यूयॉर्क', 'लंदन', 'ज़्यूरिख', 'फ़्रैंकफ़र्ट', 'दुबई', 'सिंगापुर', 'हांगकांग', 'टोक्यो'],
    heatEyebrow: 'एक नज़र में बाज़ार', heatTitle: 'बाज़ार का हीटमैप',
    heatDescription: '24 घंटे का बदलाव। टाइल का आकार ट्रेडिंग वॉल्यूम का वितरण दिखाता है।',
    volumeSizing: 'क्षेत्रफल = USDT में 24 घंटे का वॉल्यूम', equalSizing: 'समान क्षेत्रफल: वॉल्यूम उपलब्ध नहीं',
    markets: 'USDT जोड़े', price: 'कीमत, USDT', change: '24 घंटे का बदलाव', volume: '24 घंटे का वॉल्यूम, USDT',
    select: 'बाज़ार चुनें', trade: 'बाज़ार खोलें', gain: 'बढ़त', loss: 'गिरावट', unchanged: 'अपरिवर्तित',
    loading: 'बाज़ार डेटा लोड हो रहा है…', unavailable: 'बाज़ार डेटा अस्थायी रूप से उपलब्ध नहीं है।',
    detailHint: 'होवर करें या एसेट चुनें',
  },
  ja: {
    worldEyebrow: '世界の金融センター', worldTitle: 'ひとつの世界。それぞれの時間。',
    worldDescription: 'ニューヨークから東京まで、世界の金融センターの現地時刻を確認。',
    localTime: '現地時刻', clockNote: '都市の時刻を表示。取引所の開場状況ではありません。',
    centres: ['ニューヨーク', 'ロンドン', 'チューリッヒ', 'フランクフルト', 'ドバイ', 'シンガポール', '香港', '東京'],
    heatEyebrow: '市場をひと目で', heatTitle: '市場のヒートマップ',
    heatDescription: '24時間の騰落率。タイルの面積は取引量の集中度を表します。',
    volumeSizing: '面積 = 24時間取引量（USDT）', equalSizing: '等面積：取引量は取得できません',
    markets: 'USDTペア', price: '価格（USDT）', change: '24時間騰落率', volume: '24時間取引量（USDT）',
    select: '市場を選択', trade: '市場を開く', gain: '上昇', loss: '下落', unchanged: '変わらず',
    loading: '市場データを読み込み中…', unavailable: '市場データは一時的に利用できません。',
    detailHint: 'カーソルを合わせるか、資産を選択',
  },
  ko: {
    worldEyebrow: '세계 금융 중심지', worldTitle: '하나의 세계. 서로 다른 시간.',
    worldDescription: '뉴욕부터 도쿄까지, 세계 금융 중심지의 현지 시간을 확인하세요.',
    localTime: '현지 시간', clockNote: '도시의 시간이며 거래소 개장 상태가 아닙니다.',
    centres: ['뉴욕', '런던', '취리히', '프랑크푸르트', '두바이', '싱가포르', '홍콩', '도쿄'],
    heatEyebrow: '한눈에 보는 시장', heatTitle: '시장 히트맵',
    heatDescription: '24시간 변동률. 타일 면적은 거래량의 집중도를 나타냅니다.',
    volumeSizing: '면적 = 24시간 USDT 거래량', equalSizing: '동일 면적: 거래량 정보 없음',
    markets: 'USDT 거래쌍', price: '가격, USDT', change: '24시간 변동률', volume: '24시간 거래량, USDT',
    select: '시장 선택', trade: '시장 열기', gain: '상승', loss: '하락', unchanged: '보합',
    loading: '시장 데이터를 불러오는 중…', unavailable: '시장 데이터를 일시적으로 사용할 수 없습니다.',
    detailHint: '마우스를 올리거나 자산을 선택하세요',
  },
};
