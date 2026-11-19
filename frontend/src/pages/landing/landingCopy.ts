import type { Lang } from '../../lib/i18n';

/**
 * Copy of the landing page candidate (pages/landing/LandingPage.tsx), written
 * to the rules of .claude/skills/landing-page-design: one offer, one audience,
 * one primary action; sentence case; no hyphen inside a sentence; no invented
 * figure, testimonial or logo. Every claim here is something the product does:
 * Spot and Futures terminals, copy trading, position protection (TP/SL, limit
 * close), the Crypto Card by application, seven interface languages.
 *
 * The product dictionaries are frozen by language-digest tests (see
 * HomeHeader), so page-only copy lives beside its page. Calls to action, the
 * FAQ and the footer reuse the approved `home.*` dictionary keys.
 */
export interface LandingCopy {
  skip: string;
  menuOpen: string;
  menuClose: string;
  /** One line per thought: at Heading 1 a 680px line holds about twenty characters, so the breaks are written, not left to the browser. */
  heroTitle: readonly string[];
  heroSub: string;
  /** `{n}` is the number of Spot markets in the public snapshot. */
  proof: string;
  risk: string;
  boardTitle: string;
  colPair: string;
  colPrice: string;
  colChange: string;
  benefitsTitle: string;
  benefitsLead: string;
  benefits: readonly { title: string; text: string }[];
  tagline: string;
  stepsTitle: string;
  steps: readonly { title: string; text: string }[];
  marketsTitle: string;
  marketsLead: string;
  finalTitle: string;
}

export const LANDING_COPY: Record<Lang, LandingCopy> = {
  ru: {
    skip: 'Перейти к содержимому',
    menuOpen: 'Открыть меню',
    menuClose: 'Закрыть меню',
    heroTitle: ['Спот, фьючерсы', 'и копитрейдинг', 'в одном аккаунте'],
    heroSub: 'VOLTEX объединяет торговлю, копирование стратегий и Crypto Card в одном аккаунте. Рынки работают круглосуточно, интерфейс доступен на семи языках.',
    proof: '{n} спотовых рынков в списке',
    risk: 'Регистрация бесплатная. Терминал и рынки открыты сразу после входа, до пополнения счёта.',
    boardTitle: 'Рынок сейчас',
    colPair: 'Пара',
    colPrice: 'Цена',
    colChange: '24ч',
    benefitsTitle: 'Всё для сделки в одном аккаунте',
    benefitsLead: 'Один вход для спота, фьючерсов, копитрейдинга и карты.',
    benefits: [
      { title: 'Спот и фьючерсы в одном терминале', text: 'График, стакан и ордера на одном экране. Между рынками можно переключаться без смены аккаунта.' },
      { title: 'Копитрейдинг', text: 'Следуйте за стратегиями других участников платформы. Условия и ограничения указаны в самом разделе.' },
      { title: 'Контроль риска в каждой позиции', text: 'TP/SL и закрытие по лимиту задаются прямо из открытой позиции.' },
      { title: 'VOLTEX Crypto Card', text: 'Карта для повседневных покупок и подписок. Выпуск по заявке в разделе Crypto Card.' },
    ],
    tagline: 'Один аккаунт. Все рынки. Торгуйте, копируйте стратегии и управляйте риском там, где вам удобно.',
    stepsTitle: 'Как начать',
    steps: [
      { title: 'Создайте аккаунт', text: 'Регистрация бесплатная.' },
      { title: 'Пополните баланс', text: 'Выберите актив и сеть в кошельке и переведите средства на свой адрес.' },
      { title: 'Откройте сделку', text: 'Выберите рынок, спот или фьючерсы, и разместите ордер в терминале.' },
    ],
    marketsTitle: 'Рынки на VOLTEX',
    marketsLead: 'Снимок цен по данным рынка. Полный список и торговля доступны после входа.',
    finalTitle: 'Начните с бесплатного аккаунта',
  },
  en: {
    skip: 'Skip to content',
    menuOpen: 'Open menu',
    menuClose: 'Close menu',
    heroTitle: ['Spot, futures', 'and copy trading', 'in one account'],
    heroSub: 'VOLTEX brings trading, strategy copying and the Crypto Card into one account. Markets run around the clock and the interface is available in seven languages.',
    proof: '{n} spot markets listed',
    risk: 'Registration is free. The terminal and markets open right after sign in, before any deposit.',
    boardTitle: 'Market now',
    colPair: 'Pair',
    colPrice: 'Price',
    colChange: '24h',
    benefitsTitle: 'Everything for a trade in one account',
    benefitsLead: 'One sign in for spot, futures, copy trading and the card.',
    benefits: [
      { title: 'Spot and futures in one terminal', text: 'Chart, order book and orders on one screen. Switch between markets without changing accounts.' },
      { title: 'Copy trading', text: 'Follow the strategies of other traders on the platform. Terms and limits are shown in the section itself.' },
      { title: 'Risk control in every position', text: 'Set TP/SL and a limit close right from an open position.' },
      { title: 'VOLTEX Crypto Card', text: 'A card for everyday purchases and subscriptions. Issued on request in the Crypto Card section.' },
    ],
    tagline: 'One account. Every market. Trade, copy strategies and manage risk wherever you are.',
    stepsTitle: 'How to start',
    steps: [
      { title: 'Create an account', text: 'Registration is free.' },
      { title: 'Fund your balance', text: 'Pick an asset and a network in the wallet and send funds to your own address.' },
      { title: 'Open a trade', text: 'Choose a market, spot or futures, and place an order in the terminal.' },
    ],
    marketsTitle: 'Markets on VOLTEX',
    marketsLead: 'A snapshot of prices from market data. The full list and trading open after sign in.',
    finalTitle: 'Start with a free account',
  },
  es: {
    skip: 'Ir al contenido',
    menuOpen: 'Abrir menú',
    menuClose: 'Cerrar menú',
    heroTitle: ['Spot, futuros', 'y copy trading', 'en una sola cuenta'],
    heroSub: 'VOLTEX reúne el trading, la copia de estrategias y la Crypto Card en una sola cuenta. Los mercados operan las 24 horas y la interfaz está disponible en siete idiomas.',
    proof: '{n} mercados spot en la lista',
    risk: 'El registro es gratuito. El terminal y los mercados se abren al iniciar sesión, antes de cualquier depósito.',
    boardTitle: 'Mercado ahora',
    colPair: 'Par',
    colPrice: 'Precio',
    colChange: '24h',
    benefitsTitle: 'Todo para operar en una sola cuenta',
    benefitsLead: 'Un solo acceso para spot, futuros, copy trading y la tarjeta.',
    benefits: [
      { title: 'Spot y futuros en un terminal', text: 'Gráfico, libro de órdenes y órdenes en una pantalla. Cambia de mercado sin cambiar de cuenta.' },
      { title: 'Copy trading', text: 'Sigue las estrategias de otros participantes de la plataforma. Las condiciones y los límites se indican en la sección.' },
      { title: 'Control del riesgo en cada posición', text: 'Configura TP/SL y el cierre con límite desde la posición abierta.' },
      { title: 'VOLTEX Crypto Card', text: 'Una tarjeta para compras y suscripciones del día a día. Se emite por solicitud en la sección Crypto Card.' },
    ],
    tagline: 'Una cuenta. Todos los mercados. Opera, copia estrategias y gestiona el riesgo donde te resulte cómodo.',
    stepsTitle: 'Cómo empezar',
    steps: [
      { title: 'Crea una cuenta', text: 'El registro es gratuito.' },
      { title: 'Deposita saldo', text: 'Elige un activo y una red en la billetera y envía fondos a tu propia dirección.' },
      { title: 'Abre una operación', text: 'Elige un mercado, spot o futuros, y coloca una orden en el terminal.' },
    ],
    marketsTitle: 'Mercados en VOLTEX',
    marketsLead: 'Una instantánea de precios con datos del mercado. La lista completa y el trading se abren al iniciar sesión.',
    finalTitle: 'Empieza con una cuenta gratuita',
  },
  zh: {
    skip: '跳到正文',
    menuOpen: '打开菜单',
    menuClose: '关闭菜单',
    heroTitle: ['现货、合约', '与跟单交易', '尽在一个账户'],
    heroSub: 'VOLTEX 将交易、策略跟单和 Crypto Card 集中在一个账户中。市场全天候运行，界面支持七种语言。',
    proof: '已上线 {n} 个现货市场',
    risk: '注册免费。登录后即可查看终端和市场，无需先充值。',
    boardTitle: '当前行情',
    colPair: '交易对',
    colPrice: '价格',
    colChange: '24小时',
    benefitsTitle: '一个账户，交易所需尽在其中',
    benefitsLead: '一次登录即可使用现货、合约、跟单交易和卡片。',
    benefits: [
      { title: '现货与合约同在一个终端', text: '图表、订单簿和订单在同一屏幕。切换市场无需更换账户。' },
      { title: '跟单交易', text: '跟随平台其他参与者的策略。条件和限制在该栏目中说明。' },
      { title: '每个仓位都可控制风险', text: '可直接在持仓中设置 TP/SL 和限价平仓。' },
      { title: 'VOLTEX Crypto Card', text: '用于日常消费和订阅的卡片。在 Crypto Card 栏目提交申请后发卡。' },
    ],
    tagline: '一个账户。所有市场。随时随地交易、跟单并管理风险。',
    stepsTitle: '如何开始',
    steps: [
      { title: '创建账户', text: '注册免费。' },
      { title: '充值余额', text: '在钱包中选择资产和网络，将资金转入您自己的地址。' },
      { title: '开始交易', text: '选择现货或合约市场，在终端下单。' },
    ],
    marketsTitle: 'VOLTEX 上的市场',
    marketsLead: '基于市场数据的价格快照。完整列表和交易在登录后开放。',
    finalTitle: '从免费账户开始',
  },
  hi: {
    skip: 'मुख्य सामग्री पर जाएँ',
    menuOpen: 'मेनू खोलें',
    menuClose: 'मेनू बंद करें',
    heroTitle: ['स्पॉट, फ्यूचर्स', 'और कॉपी ट्रेडिंग', 'एक ही खाते में'],
    heroSub: 'VOLTEX ट्रेडिंग, रणनीति कॉपी करने और Crypto Card को एक ही खाते में लाता है। बाज़ार चौबीसों घंटे चलते हैं और इंटरफ़ेस सात भाषाओं में उपलब्ध है।',
    proof: 'सूची में {n} स्पॉट बाज़ार',
    risk: 'पंजीकरण निःशुल्क है। लॉग इन करते ही टर्मिनल और बाज़ार खुल जाते हैं, जमा करने से पहले भी।',
    boardTitle: 'बाज़ार अभी',
    colPair: 'जोड़ी',
    colPrice: 'कीमत',
    colChange: '24घं',
    benefitsTitle: 'एक खाते में ट्रेड के लिए सब कुछ',
    benefitsLead: 'स्पॉट, फ्यूचर्स, कॉपी ट्रेडिंग और कार्ड के लिए एक ही लॉग इन।',
    benefits: [
      { title: 'एक टर्मिनल में स्पॉट और फ्यूचर्स', text: 'चार्ट, ऑर्डर बुक और ऑर्डर एक ही स्क्रीन पर। खाता बदले बिना बाज़ार बदलें।' },
      { title: 'कॉपी ट्रेडिंग', text: 'प्लेटफ़ॉर्म के अन्य प्रतिभागियों की रणनीतियों का अनुसरण करें। शर्तें और सीमाएँ उसी अनुभाग में दी गई हैं।' },
      { title: 'हर पोज़िशन में जोखिम नियंत्रण', text: 'खुली पोज़िशन से ही TP/SL और लिमिट क्लोज़ सेट करें।' },
      { title: 'VOLTEX Crypto Card', text: 'रोज़मर्रा की ख़रीदारी और सब्सक्रिप्शन के लिए कार्ड। Crypto Card अनुभाग में आवेदन पर जारी होता है।' },
    ],
    tagline: 'एक खाता। सभी बाज़ार। जहाँ सुविधा हो वहाँ ट्रेड करें, रणनीतियाँ कॉपी करें और जोखिम संभालें।',
    stepsTitle: 'कैसे शुरू करें',
    steps: [
      { title: 'खाता बनाएँ', text: 'पंजीकरण निःशुल्क है।' },
      { title: 'बैलेंस जोड़ें', text: 'वॉलेट में एसेट और नेटवर्क चुनें और अपने पते पर फ़ंड भेजें।' },
      { title: 'ट्रेड खोलें', text: 'स्पॉट या फ्यूचर्स बाज़ार चुनें और टर्मिनल में ऑर्डर लगाएँ।' },
    ],
    marketsTitle: 'VOLTEX पर बाज़ार',
    marketsLead: 'बाज़ार डेटा से कीमतों का स्नैपशॉट। पूरी सूची और ट्रेडिंग लॉग इन के बाद उपलब्ध हैं।',
    finalTitle: 'निःशुल्क खाते से शुरू करें',
  },
  ja: {
    skip: '本文へ移動',
    menuOpen: 'メニューを開く',
    menuClose: 'メニューを閉じる',
    heroTitle: ['現物、先物、', 'コピートレードを', '1つのアカウントで'],
    heroSub: 'VOLTEX は取引、ストラテジーのコピー、Crypto Card をひとつのアカウントにまとめます。市場は24時間稼働し、インターフェースは7言語に対応しています。',
    proof: '現物市場 {n} 件を掲載',
    risk: '登録は無料です。ログイン後すぐに、入金前でもターミナルと市場を確認できます。',
    boardTitle: '現在の市場',
    colPair: 'ペア',
    colPrice: '価格',
    colChange: '24時間',
    benefitsTitle: '取引に必要なものをひとつのアカウントに',
    benefitsLead: '現物、先物、コピートレード、カードを一度のログインで。',
    benefits: [
      { title: '現物と先物をひとつのターミナルで', text: 'チャート、板、注文を同じ画面に表示。アカウントを切り替えずに市場を移動できます。' },
      { title: 'コピートレード', text: 'プラットフォームの他の参加者のストラテジーをフォローできます。条件と制限は該当セクションに記載しています。' },
      { title: 'すべてのポジションでリスク管理', text: '保有中のポジションから TP/SL と指値決済を直接設定できます。' },
      { title: 'VOLTEX Crypto Card', text: '日常の買い物やサブスクリプションに使えるカード。Crypto Card セクションで申請すると発行されます。' },
    ],
    tagline: 'ひとつのアカウント。すべての市場。好きな場所で取引し、ストラテジーをコピーし、リスクを管理できます。',
    stepsTitle: '始め方',
    steps: [
      { title: 'アカウントを作成', text: '登録は無料です。' },
      { title: '残高に入金', text: 'ウォレットで資産とネットワークを選び、ご自身のアドレスへ送金します。' },
      { title: '取引を開始', text: '現物か先物の市場を選び、ターミナルで注文します。' },
    ],
    marketsTitle: 'VOLTEX の市場',
    marketsLead: '市場データによる価格のスナップショットです。全リストと取引はログイン後に利用できます。',
    finalTitle: '無料アカウントから始める',
  },
  ko: {
    skip: '본문으로 이동',
    menuOpen: '메뉴 열기',
    menuClose: '메뉴 닫기',
    heroTitle: ['현물, 선물,', '카피 트레이딩을', '하나의 계정에서'],
    heroSub: 'VOLTEX는 거래, 전략 복사, Crypto Card를 하나의 계정에 모았습니다. 시장은 24시간 운영되며 인터페이스는 7개 언어를 지원합니다.',
    proof: '현물 시장 {n}개 상장',
    risk: '가입은 무료입니다. 로그인하면 입금 전에도 터미널과 시장을 바로 볼 수 있습니다.',
    boardTitle: '현재 시장',
    colPair: '페어',
    colPrice: '가격',
    colChange: '24시간',
    benefitsTitle: '거래에 필요한 모든 것을 하나의 계정에',
    benefitsLead: '현물, 선물, 카피 트레이딩, 카드를 한 번의 로그인으로.',
    benefits: [
      { title: '하나의 터미널에서 현물과 선물', text: '차트, 호가창, 주문을 한 화면에서. 계정을 바꾸지 않고 시장을 전환합니다.' },
      { title: '카피 트레이딩', text: '플랫폼의 다른 참여자 전략을 따라 할 수 있습니다. 조건과 제한은 해당 섹션에 안내되어 있습니다.' },
      { title: '모든 포지션의 리스크 관리', text: '보유 포지션에서 바로 TP/SL과 지정가 청산을 설정합니다.' },
      { title: 'VOLTEX Crypto Card', text: '일상 결제와 구독을 위한 카드. Crypto Card 섹션에서 신청하면 발급됩니다.' },
    ],
    tagline: '하나의 계정. 모든 시장. 편한 곳에서 거래하고, 전략을 복사하고, 리스크를 관리하세요.',
    stepsTitle: '시작 방법',
    steps: [
      { title: '계정 만들기', text: '가입은 무료입니다.' },
      { title: '잔액 충전', text: '지갑에서 자산과 네트워크를 선택하고 본인 주소로 자금을 보냅니다.' },
      { title: '거래 시작', text: '현물 또는 선물 시장을 선택하고 터미널에서 주문합니다.' },
    ],
    marketsTitle: 'VOLTEX의 시장',
    marketsLead: '시장 데이터 기준 가격 스냅샷입니다. 전체 목록과 거래는 로그인 후 이용할 수 있습니다.',
    finalTitle: '무료 계정으로 시작하세요',
  },
};
