import { Lang } from './i18n';

export type LegalDoc = 'terms' | 'privacy' | 'risk' | 'about' | 'support';

export interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalContent {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

const RU_TERMS: LegalContent = {
  title: 'Условия использования',
  updated: 'Последнее обновление: 22 августа 2026 г.',
  intro:
    'Эти условия регулируют использование платформы VOLTEX. Регистрируясь или используя сервис, ты подтверждаешь, что прочитал(а) и согласен(на) с изложенным ниже.',
  sections: [
    {
      heading: '1. О сервисе',
      body: [
        'VOLTEX — платформа для торговли криптовалютами, позволяющая размещать лимитные и рыночные ордера, хранить активы во внутреннем кошельке и совершать депозиты/выводы в поддерживаемых сетях.',
      ],
    },
    {
      heading: '2. Право на использование',
      body: [
        'Сервисом могут пользоваться только дееспособные лица старше 18 лет. Регистрируясь, ты подтверждаешь, что использование криптовалютных сервисов не запрещено в твоей юрисдикции.',
      ],
    },
    {
      heading: '3. Аккаунт и безопасность',
      body: [
        'Ты несёшь ответственность за конфиденциальность пароля и, при включении, ключей двухфакторной аутентификации. Мы настоятельно рекомендуем включить 2FA в разделе «Настройки → Безопасность».',
        'Сообщи нам немедленно при подозрении на несанкционированный доступ к аккаунту.',
      ],
    },
    {
      heading: '4. Ордера и исполнение',
      body: [
        'Ордера исполняются торговым движком по принципу цена-время в порядке поступления. Рыночные ордера исполняются по лучшей доступной цене в стакане на момент размещения и могут быть подвержены проскальзыванию при недостаточной ликвидности.',
      ],
    },
    {
      heading: '5. Комиссии',
      body: [
        'Действующие торговые комиссии отображаются в интерфейсе перед подтверждением сделки. Мы вправе изменять размер комиссий, уведомив об этом в сервисе заранее.',
      ],
    },
    {
      heading: '6. Запрещённое использование',
      body: [
        'Запрещается использовать сервис для отмывания денег, финансирования запрещённой деятельности, манипулирования рынком (спуфинг, вошинг-трейдинг) или попыток обойти технические ограничения платформы.',
      ],
    },
    {
      heading: '7. Приостановка и прекращение',
      body: [
        'Мы вправе приостановить или закрыть аккаунт при нарушении настоящих условий, по требованию закона или при подозрении на мошенничество, уведомив пользователя, где это возможно.',
      ],
    },
    {
      heading: '8. Ограничение ответственности',
      body: [
        'Сервис предоставляется «как есть». Мы не гарантируем бесперебойную работу и не несём ответственности за убытки, возникшие из-за рыночной волатильности, сбоев сети или действий третьих сторон.',
      ],
    },
    {
      heading: '9. Изменения условий',
      body: [
        'Мы можем обновлять эти условия. Существенные изменения будут анонсированы в сервисе не менее чем за 7 дней до вступления в силу.',
      ],
    },
  ],
};

const RU_PRIVACY: LegalContent = {
  title: 'Политика конфиденциальности',
  updated: 'Последнее обновление: 22 августа 2026 г.',
  intro: 'Этот документ описывает, какие данные мы собираем, зачем и как их защищаем.',
  sections: [
    {
      heading: '1. Какие данные мы собираем',
      body: [
        'Регистрационные данные (email, хешированный пароль), данные верификации (KYC): имя, страна, документ, удостоверяющий личность, история торгов и транзакций, техническая информация (IP-адрес, тип устройства) для целей безопасности.',
      ],
    },
    {
      heading: '2. Как мы используем данные',
      body: [
        'Для предоставления сервиса, исполнения ордеров, обработки депозитов/выводов, предотвращения мошенничества и соблюдения требований законодательства о противодействии отмыванию денег (AML/KYC).',
      ],
    },
    {
      heading: '3. Данные верификации (KYC)',
      body: [
        'Документы, загруженные для верификации личности, хранятся в зашифрованном виде и доступны только уполномоченному персоналу для целей проверки и соответствия требованиям регулирования.',
      ],
    },
    {
      heading: '4. Передача данных третьим лицам',
      body: [
        'Мы не продаём персональные данные. Данные могут передаваться поставщикам инфраструктуры (хостинг, обработка платежей) исключительно в объёме, необходимом для работы сервиса, а также по законному требованию государственных органов.',
      ],
    },
    {
      heading: '5. Безопасность данных',
      body: [
        'Пароли хранятся в виде необратимых bcrypt-хешей. Секреты API-ключей шифруются при хранении. Мы поддерживаем двухфакторную аутентификацию для дополнительной защиты аккаунта.',
      ],
    },
    {
      heading: '6. Твои права',
      body: [
        'Ты можешь запросить копию своих данных или их удаление, за исключением информации, которую мы обязаны хранить по закону (например, записи KYC/AML в течение установленного срока).',
      ],
    },
    {
      heading: '7. Хранение данных',
      body: [
        'Данные аккаунта хранятся, пока аккаунт активен. После закрытия аккаунта данные, требуемые законом (транзакции, KYC), хранятся установленный регулированием срок, остальные — удаляются.',
      ],
    },
    {
      heading: '8. Связь с нами',
      body: [
        'Вопросы о данных и конфиденциальности можно направить через раздел поддержки в аккаунте.',
      ],
    },
  ],
};

const RU_ABOUT: LegalContent = {
  title: 'О нас',
  updated: 'Последнее обновление: 22 августа 2026 г.',
  intro:
    'VOLTEX — платформа для торговли криптовалютами: спот и фьючерсы с маржинальной торговлей, лимитные, рыночные, стоп- и тейк-профит ордера, вывод и депозит в поддерживаемых сетях.',
  sections: [
    {
      heading: 'Торговый движок',
      body: [
        'Ордера сопоставляются собственным торговым движком по принципу цена-время. Рыночные данные (цены, свечи, стакан) зеркалируются с реального биржевого API — никаких захардкоженных или сгенерированных котировок.',
      ],
    },
    {
      heading: 'Безопасность аккаунта',
      body: [
        'Пароли хранятся в виде необратимых bcrypt-хешей, секреты API-ключей шифруются при хранении. Двухфакторная аутентификация и журнал входов доступны в разделе «Настройки → Безопасность».',
      ],
    },
    {
      heading: 'Фьючерсы и риск-менеджмент',
      body: [
        'Маржинальная торговля с изолированной и кросс-маржой, многоуровневое плечо, автоматическая ликвидация по реальной mark-price и страховой фонд на случай дефицита при ликвидации.',
      ],
    },
    {
      heading: 'Прозрачность',
      body: [
        'Мы не публикуем непроверяемые обещания о доходности или объёмах торгов. Комиссии, лимиты и условия отображаются в интерфейсе там, где они применяются — до подтверждения действия, а не мелким шрифтом.',
      ],
    },
  ],
};

const RU_SUPPORT: LegalContent = {
  title: 'Поддержка',
  updated: 'Последнее обновление: 22 августа 2026 г.',
  intro: 'Ответы на частые вопросы. Для вопросов по конкретному аккаунту в первую очередь загляни в «Настройки».',
  sections: [
    {
      heading: 'Как пополнить баланс',
      body: [
        'Открой «Пополнить» → выбери сеть → отправь средства на показанный адрес → вставь хеш транзакции для проверки. Минимальная сумма пополнения — 1000 USD в эквиваленте; сумма ниже минимума не будет зачислена.',
      ],
    },
    {
      heading: 'Ордер не исполняется',
      body: [
        'Проверь, что триггерная цена стоп/тейк-профит ордера расположена по правильную сторону от текущей рыночной цены — интерфейс подсказывает нужное направление прямо в форме ордера. Открытые условные ордера ждут срабатывания триггера и отображаются со статусом «Ожидает».',
      ],
    },
    {
      heading: 'Безопасность аккаунта',
      body: [
        'Включи двухфакторную аутентификацию и периодически проверяй журнал входов в «Настройки → Безопасность» — там видно каждый вход в аккаунт.',
      ],
    },
    {
      heading: 'Верификация (KYC)',
      body: ['Статус и требуемые документы для верификации отображаются в разделе аккаунта, отвечающем за верификацию.'],
    },
    {
      heading: 'Остались вопросы',
      body: [
        'Прямого канала живой поддержки в этой версии платформы пока нет — раздел поддержки ограничен этой страницей с ответами на частые вопросы.',
      ],
    },
  ],
};

const RU_RISK: LegalContent = {
  title: 'Раскрытие рисков',
  updated: 'Последнее обновление: 22 августа 2026 г.',
  intro:
    'Торговля криптовалютами сопряжена со значительным риском. Прежде чем торговать, убедись, что понимаешь и принимаешь перечисленные ниже риски.',
  sections: [
    {
      heading: '1. Волатильность',
      body: [
        'Цены на криптовалюты могут резко меняться в течение коротких промежутков времени. Стоимость активов может как вырасти, так и полностью обнулиться.',
      ],
    },
    {
      heading: '2. Отсутствие гарантий',
      body: ['Прошлые результаты не гарантируют будущую доходность. VOLTEX не гарантирует прибыль от торговли.'],
    },
    {
      heading: '3. Это не инвестиционная консультация',
      body: [
        'Информация на платформе (цены, графики, статистика) предоставляется в информационных целях и не является инвестиционной, налоговой или юридической консультацией.',
      ],
    },
    {
      heading: '4. Риск ордеров по рынку',
      body: [
        'Рыночные ордера исполняются по лучшей доступной цене и могут быть подвержены проскальзыванию, особенно при низкой ликвидности или высокой волатильности.',
      ],
    },
    {
      heading: '5. Технологический риск',
      body: [
        'Сбои сети, задержки блокчейна или технические неполадки могут повлиять на исполнение ордеров или доступность сервиса.',
      ],
    },
    {
      heading: '6. Регуляторный риск',
      body: [
        'Правовой статус криптовалют различается в зависимости от юрисдикции и может измениться, что способно повлиять на доступность сервиса.',
      ],
    },
    {
      heading: '7. Необратимость транзакций',
      body: [
        'Переводы в блокчейн-сетях, как правило, необратимы. Внимательно проверяй адрес и сеть перед выводом средств.',
      ],
    },
    {
      heading: '8. Подтверждение',
      body: [
        'Используя VOLTEX для торговли, ты подтверждаешь, что осознаёшь перечисленные риски и торгуешь на собственный страх и риск.',
      ],
    },
  ],
};

const EN_TERMS: LegalContent = {
  title: 'Terms of Service',
  updated: 'Last updated: August 22, 2026',
  intro:
    'These terms govern your use of the VOLTEX platform. By registering or using the service, you confirm that you have read and agree to the following.',
  sections: [
    {
      heading: '1. About the service',
      body: [
        'VOLTEX is a cryptocurrency trading platform that lets you place limit and market orders, hold assets in an internal wallet, and deposit/withdraw on supported networks.',
      ],
    },
    {
      heading: '2. Eligibility',
      body: [
        'The service is available only to persons with legal capacity who are 18 or older. By registering, you confirm that using cryptocurrency services is not prohibited in your jurisdiction.',
      ],
    },
    {
      heading: '3. Account and security',
      body: [
        'You are responsible for keeping your password confidential, and your two-factor authentication credentials once enabled. We strongly recommend enabling 2FA under Settings → Security.',
        'Notify us immediately if you suspect unauthorized access to your account.',
      ],
    },
    {
      heading: '4. Orders and execution',
      body: [
        'Orders are matched by the trading engine on a price-time priority basis. Market orders fill at the best available price on the order book at the time of placement and may be subject to slippage when liquidity is thin.',
      ],
    },
    {
      heading: '5. Fees',
      body: [
        'Current trading fees are shown in the interface before you confirm a trade. We may change fees with advance notice within the service.',
      ],
    },
    {
      heading: '6. Prohibited use',
      body: [
        'You may not use the service for money laundering, financing prohibited activity, market manipulation (spoofing, wash trading), or attempting to circumvent the platform\'s technical safeguards.',
      ],
    },
    {
      heading: '7. Suspension and termination',
      body: [
        'We may suspend or close an account for violating these terms, to comply with law, or on suspicion of fraud, notifying the user where possible.',
      ],
    },
    {
      heading: '8. Limitation of liability',
      body: [
        'The service is provided "as is". We do not guarantee uninterrupted operation and are not liable for losses arising from market volatility, network outages, or third-party actions.',
      ],
    },
    {
      heading: '9. Changes to these terms',
      body: ['We may update these terms. Material changes will be announced in the service at least 7 days before taking effect.'],
    },
  ],
};

const EN_PRIVACY: LegalContent = {
  title: 'Privacy Policy',
  updated: 'Last updated: August 22, 2026',
  intro: 'This document explains what data we collect, why, and how we protect it.',
  sections: [
    {
      heading: '1. Data we collect',
      body: [
        'Registration data (email, hashed password), verification (KYC) data — name, country, identity document — trading and transaction history, and technical data (IP address, device type) for security purposes.',
      ],
    },
    {
      heading: '2. How we use it',
      body: [
        'To provide the service, execute orders, process deposits/withdrawals, prevent fraud, and comply with anti-money-laundering (AML/KYC) requirements.',
      ],
    },
    {
      heading: '3. Verification (KYC) data',
      body: [
        'Documents uploaded for identity verification are stored encrypted and accessible only to authorized staff for review and regulatory compliance purposes.',
      ],
    },
    {
      heading: '4. Sharing with third parties',
      body: [
        'We do not sell personal data. Data may be shared with infrastructure providers (hosting, payment processing) only to the extent needed to operate the service, and with authorities upon lawful request.',
      ],
    },
    {
      heading: '5. Data security',
      body: [
        'Passwords are stored as irreversible bcrypt hashes. API key secrets are encrypted at rest. We support two-factor authentication for additional account protection.',
      ],
    },
    {
      heading: '6. Your rights',
      body: [
        'You may request a copy of your data or its deletion, except for information we are legally required to retain (e.g. KYC/AML records for the mandated period).',
      ],
    },
    {
      heading: '7. Data retention',
      body: [
        'Account data is retained while the account is active. After closure, data required by law (transactions, KYC) is kept for the regulated period; the rest is deleted.',
      ],
    },
    {
      heading: '8. Contact',
      body: ['Questions about data and privacy can be sent through the support section in your account.'],
    },
  ],
};

const EN_ABOUT: LegalContent = {
  title: 'About us',
  updated: 'Last updated: August 22, 2026',
  intro:
    'VOLTEX is a cryptocurrency trading platform: spot and margin futures trading, limit, market, stop, and take-profit orders, deposits and withdrawals on supported networks.',
  sections: [
    {
      heading: 'Matching engine',
      body: [
        'Orders are matched by our own price-time matching engine. Market data (prices, candles, order book) mirrors a real exchange API — no hardcoded or generated quotes.',
      ],
    },
    {
      heading: 'Account security',
      body: [
        'Passwords are stored as irreversible bcrypt hashes, and API key secrets are encrypted at rest. Two-factor authentication and a login history are available under Settings → Security.',
      ],
    },
    {
      heading: 'Futures and risk management',
      body: [
        'Margin trading with isolated and cross margin, tiered leverage, automatic liquidation against a real mark price, and an insurance fund for shortfalls at liquidation.',
      ],
    },
    {
      heading: 'Transparency',
      body: [
        "We don't publish unverifiable claims about returns or trading volume. Fees, limits, and terms are shown in the interface where they apply — before you confirm an action, not in fine print.",
      ],
    },
  ],
};

const EN_SUPPORT: LegalContent = {
  title: 'Support',
  updated: 'Last updated: August 22, 2026',
  intro: 'Answers to common questions. For anything account-specific, check Settings first.',
  sections: [
    {
      heading: 'How to deposit',
      body: [
        'Open "Deposit" → pick a network → send funds to the address shown → paste the transaction hash to verify it. The minimum deposit is the equivalent of $1000 USD; anything below that will not be credited.',
      ],
    },
    {
      heading: 'My order isn’t executing',
      body: [
        'Check that a stop/take-profit trigger price sits on the correct side of the current market price — the order form shows the required direction inline. Pending conditional orders wait for their trigger and show a "Pending" status.',
      ],
    },
    {
      heading: 'Account security',
      body: [
        'Turn on two-factor authentication and periodically review the login history under Settings → Security — every sign-in to your account shows up there.',
      ],
    },
    {
      heading: 'Verification (KYC)',
      body: ['Your verification status and the documents required are shown in the account’s verification section.'],
    },
    {
      heading: 'Still have questions',
      body: ["This version of the platform doesn't have a live support channel yet — the support section is limited to this FAQ page."],
    },
  ],
};

const EN_RISK: LegalContent = {
  title: 'Risk Disclosure',
  updated: 'Last updated: August 22, 2026',
  intro: 'Trading cryptocurrency carries significant risk. Before you trade, make sure you understand and accept the risks below.',
  sections: [
    {
      heading: '1. Volatility',
      body: ['Cryptocurrency prices can move sharply over short periods. Asset value can rise significantly or fall to zero.'],
    },
    {
      heading: '2. No guarantees',
      body: ['Past performance does not guarantee future results. VOLTEX does not guarantee trading profit.'],
    },
    {
      heading: '3. Not investment advice',
      body: [
        'Information on the platform (prices, charts, statistics) is provided for informational purposes only and is not investment, tax, or legal advice.',
      ],
    },
    {
      heading: '4. Market order risk',
      body: ['Market orders fill at the best available price and may be subject to slippage, especially under thin liquidity or high volatility.'],
    },
    {
      heading: '5. Technology risk',
      body: ['Network outages, blockchain delays, or technical faults can affect order execution or service availability.'],
    },
    {
      heading: '6. Regulatory risk',
      body: ['The legal status of cryptocurrency varies by jurisdiction and can change, which may affect service availability.'],
    },
    {
      heading: '7. Irreversibility of transactions',
      body: ['On-chain transfers are generally irreversible. Double-check the address and network before withdrawing funds.'],
    },
    {
      heading: '8. Acknowledgement',
      body: ['By using VOLTEX to trade, you confirm you understand the risks listed above and trade at your own risk.'],
    },
  ],
};

const ZH_TERMS: LegalContent = {
  title: '服务条款',
  updated: '最后更新:2026年8月22日',
  intro: '本条款规范你对 VOLTEX 平台的使用。注册或使用本服务即表示你已阅读并同意以下内容。',
  sections: [
    {
      heading: '1. 关于服务',
      body: ['VOLTEX 是一个加密货币交易平台,支持限价单和市价单、内部钱包资产存储,以及在支持的网络上进行充值/提现。'],
    },
    {
      heading: '2. 使用资格',
      body: ['仅限具有完全民事行为能力且年满18周岁的人士使用本服务。注册即表示你确认在所在司法辖区使用加密货币服务不受禁止。'],
    },
    {
      heading: '3. 账户与安全',
      body: [
        '你有责任保管好密码,以及启用后的双重验证凭据。我们强烈建议在"设置 → 安全"中启用双重验证。',
        '如怀疑账户被未经授权访问,请立即通知我们。',
      ],
    },
    {
      heading: '4. 订单与执行',
      body: ['订单由交易引擎按价格-时间优先原则撮合。市价单按下单时订单簿上的最优可用价格成交,流动性不足时可能出现滑点。'],
    },
    {
      heading: '5. 费用',
      body: ['当前交易费用会在你确认交易前显示在界面中。我们可能调整费用,并会提前在服务内通知。'],
    },
    {
      heading: '6. 禁止行为',
      body: ['禁止将本服务用于洗钱、资助违法活动、操纵市场(幌骗、对敲交易)或试图规避平台的技术保护措施。'],
    },
    {
      heading: '7. 暂停与终止',
      body: ['如违反本条款、依法律要求或涉嫌欺诈,我们可暂停或关闭账户,并在可能的情况下通知用户。'],
    },
    {
      heading: '8. 责任限制',
      body: ['本服务按"现状"提供。我们不保证服务不中断,也不对因市场波动、网络故障或第三方行为造成的损失承担责任。'],
    },
    {
      heading: '9. 条款变更',
      body: ['我们可能更新本条款。重大变更将在生效前至少7天在服务内公布。'],
    },
  ],
};

const ZH_PRIVACY: LegalContent = {
  title: '隐私政策',
  updated: '最后更新:2026年8月22日',
  intro: '本文件说明我们收集哪些数据、原因,以及如何保护这些数据。',
  sections: [
    {
      heading: '1. 我们收集的数据',
      body: ['注册信息(邮箱、加密后的密码)、身份验证(KYC)信息(姓名、国家、身份证件)、交易和转账记录,以及用于安全目的的技术信息(IP地址、设备类型)。'],
    },
    {
      heading: '2. 数据用途',
      body: ['用于提供服务、执行订单、处理充值/提现、预防欺诈,以及遵守反洗钱(AML/KYC)相关法规要求。'],
    },
    {
      heading: '3. 身份验证(KYC)数据',
      body: ['为身份验证上传的证件以加密方式存储,仅授权人员可访问,用于审核及合规目的。'],
    },
    {
      heading: '4. 与第三方共享',
      body: ['我们不会出售个人数据。数据可能仅在运营服务所需范围内与基础设施提供商(托管、支付处理)共享,或依法应政府部门要求提供。'],
    },
    {
      heading: '5. 数据安全',
      body: ['密码以不可逆的 bcrypt 哈希形式存储。API 密钥在存储时会被加密。我们支持双重验证以增强账户保护。'],
    },
    {
      heading: '6. 你的权利',
      body: ['你可以申请获取你的数据副本或要求删除数据,但我们依法必须保留的信息(如法定期限内的KYC/AML记录)除外。'],
    },
    {
      heading: '7. 数据保留',
      body: ['账户处于活跃状态期间,我们会保留账户数据。账户关闭后,法律要求保留的数据(交易记录、KYC)将按监管规定期限保留,其余数据将被删除。'],
    },
    {
      heading: '8. 联系我们',
      body: ['有关数据和隐私的问题,可通过账户内的支持板块与我们联系。'],
    },
  ],
};

const ZH_ABOUT: LegalContent = {
  title: '关于我们',
  updated: '最后更新:2026年8月22日',
  intro: 'VOLTEX 是一个加密货币交易平台:现货与保证金合约交易、限价/市价/止损/止盈订单,以及在支持的网络上充值和提现。',
  sections: [
    {
      heading: '撮合引擎',
      body: ['订单由我们自有的价格-时间优先撮合引擎处理。行情数据(价格、K线、订单簿)镜像自真实交易所接口,不使用硬编码或生成的报价。'],
    },
    {
      heading: '账户安全',
      body: ['密码以不可逆的 bcrypt 哈希存储,API 密钥密文加密保存。双重验证与登录历史可在"设置 → 安全"中查看。'],
    },
    {
      heading: '合约与风险管理',
      body: ['支持逐仓与全仓保证金、分层杠杆、基于真实标记价格的自动强平,以及用于覆盖强平缺口的风险准备金。'],
    },
    {
      heading: '透明度',
      body: ['我们不会发布无法验证的收益或交易量承诺。手续费、限额和条款会在实际适用的界面位置展示——在你确认操作之前,而不是藏在细则里。'],
    },
  ],
};

const ZH_SUPPORT: LegalContent = {
  title: '帮助与支持',
  updated: '最后更新:2026年8月22日',
  intro: '常见问题解答。与账户相关的问题请先查看"设置"。',
  sections: [
    {
      heading: '如何充值',
      body: ['打开"充值" → 选择网络 → 将资金发送到显示的地址 → 粘贴交易哈希进行验证。最低充值金额为等值 1000 美元,低于该金额的充值不会入账。'],
    },
    {
      heading: '订单未成交',
      body: ['请检查止损/止盈触发价格是否位于当前市场价格的正确一侧——下单表单会直接提示所需方向。待触发的条件订单会显示"等待"状态。'],
    },
    {
      heading: '账户安全',
      body: ['在"设置 → 安全"中开启双重验证,并定期查看登录历史——每一次登录都会记录在那里。'],
    },
    {
      heading: '身份验证(KYC)',
      body: ['你的验证状态和所需文件会在账户的验证板块中显示。'],
    },
    {
      heading: '仍有疑问',
      body: ['当前版本的平台暂未提供实时人工支持渠道——支持板块目前仅限于本常见问题页面。'],
    },
  ],
};

const ZH_RISK: LegalContent = {
  title: '风险披露',
  updated: '最后更新:2026年8月22日',
  intro: '加密货币交易存在重大风险。在开始交易前,请确保你理解并接受以下风险。',
  sections: [
    { heading: '1. 波动性', body: ['加密货币价格可能在短时间内剧烈波动,资产价值既可能大幅上涨,也可能归零。'] },
    { heading: '2. 无保证', body: ['过往表现不代表未来收益。VOLTEX 不保证交易盈利。'] },
    {
      heading: '3. 非投资建议',
      body: ['平台上的信息(价格、图表、统计数据)仅供参考,不构成投资、税务或法律建议。'],
    },
    { heading: '4. 市价单风险', body: ['市价单按最优可用价格成交,在流动性不足或波动剧烈时可能出现滑点。'] },
    { heading: '5. 技术风险', body: ['网络故障、区块链延迟或技术问题可能影响订单执行或服务可用性。'] },
    { heading: '6. 监管风险', body: ['加密货币的法律地位因司法辖区而异,且可能发生变化,进而影响服务的可用性。'] },
    { heading: '7. 交易不可逆', body: ['链上转账通常不可逆。提现前请仔细核对地址和网络。'] },
    { heading: '8. 确认', body: ['使用 VOLTEX 进行交易即表示你已了解上述风险,并自行承担交易风险。'] },
  ],
};

const ES_TERMS: LegalContent = {
  title: 'Términos de servicio',
  updated: 'Última actualización: 22 de agosto de 2026',
  intro:
    'Estos términos rigen tu uso de la plataforma VOLTEX. Al registrarte o usar el servicio, confirmas que has leído y aceptas lo siguiente.',
  sections: [
    {
      heading: '1. Sobre el servicio',
      body: [
        'VOLTEX es una plataforma de trading de criptomonedas que te permite colocar órdenes límite y de mercado, mantener activos en una billetera interna, y depositar/retirar en las redes admitidas.',
      ],
    },
    {
      heading: '2. Elegibilidad',
      body: [
        'El servicio está disponible solo para personas con capacidad legal de 18 años o más. Al registrarte, confirmas que el uso de servicios de criptomonedas no está prohibido en tu jurisdicción.',
      ],
    },
    {
      heading: '3. Cuenta y seguridad',
      body: [
        'Eres responsable de mantener tu contraseña confidencial, y tus credenciales de autenticación de dos factores una vez activada. Recomendamos encarecidamente activar 2FA en Configuración → Seguridad.',
        'Notifícanos de inmediato si sospechas de un acceso no autorizado a tu cuenta.',
      ],
    },
    {
      heading: '4. Órdenes y ejecución',
      body: [
        'Las órdenes se emparejan mediante el motor de trading según prioridad de precio-tiempo. Las órdenes de mercado se ejecutan al mejor precio disponible en el libro de órdenes en el momento de colocarse, y pueden sufrir deslizamiento (slippage) cuando la liquidez es baja.',
      ],
    },
    {
      heading: '5. Comisiones',
      body: [
        'Las comisiones de trading actuales se muestran en la interfaz antes de confirmar una operación. Podemos modificar las comisiones con aviso previo dentro del servicio.',
      ],
    },
    {
      heading: '6. Uso prohibido',
      body: [
        'No puedes usar el servicio para lavado de dinero, financiamiento de actividades prohibidas, manipulación del mercado (spoofing, wash trading), ni intentar eludir las salvaguardas técnicas de la plataforma.',
      ],
    },
    {
      heading: '7. Suspensión y cierre',
      body: [
        'Podemos suspender o cerrar una cuenta por incumplir estos términos, para cumplir con la ley, o ante sospecha de fraude, notificando al usuario cuando sea posible.',
      ],
    },
    {
      heading: '8. Limitación de responsabilidad',
      body: [
        'El servicio se ofrece "tal cual". No garantizamos un funcionamiento ininterrumpido y no somos responsables de pérdidas derivadas de la volatilidad del mercado, interrupciones de red, o acciones de terceros.',
      ],
    },
    {
      heading: '9. Cambios en estos términos',
      body: ['Podemos actualizar estos términos. Los cambios importantes se anunciarán en el servicio al menos 7 días antes de entrar en vigor.'],
    },
  ],
};

const ES_PRIVACY: LegalContent = {
  title: 'Política de privacidad',
  updated: 'Última actualización: 22 de agosto de 2026',
  intro: 'Este documento explica qué datos recopilamos, por qué, y cómo los protegemos.',
  sections: [
    {
      heading: '1. Datos que recopilamos',
      body: [
        'Datos de registro (correo, contraseña con hash), datos de verificación (KYC) — nombre, país, documento de identidad — historial de trading y transacciones, y datos técnicos (dirección IP, tipo de dispositivo) por motivos de seguridad.',
      ],
    },
    {
      heading: '2. Cómo los usamos',
      body: [
        'Para prestar el servicio, ejecutar órdenes, procesar depósitos/retiros, prevenir fraude, y cumplir con los requisitos de prevención de lavado de dinero (AML/KYC).',
      ],
    },
    {
      heading: '3. Datos de verificación (KYC)',
      body: [
        'Los documentos subidos para verificación de identidad se almacenan encriptados y son accesibles solo para el personal autorizado, para fines de revisión y cumplimiento regulatorio.',
      ],
    },
    {
      heading: '4. Compartir con terceros',
      body: [
        'No vendemos datos personales. Los datos pueden compartirse con proveedores de infraestructura (hosting, procesamiento de pagos) solo en la medida necesaria para operar el servicio, y con autoridades ante una solicitud legal.',
      ],
    },
    {
      heading: '5. Seguridad de los datos',
      body: [
        'Las contraseñas se almacenan como hashes bcrypt irreversibles. Los secretos de las claves API se encriptan en reposo. Ofrecemos autenticación de dos factores para protección adicional de la cuenta.',
      ],
    },
    {
      heading: '6. Tus derechos',
      body: [
        'Puedes solicitar una copia de tus datos o su eliminación, excepto la información que estamos legalmente obligados a conservar (por ejemplo, registros KYC/AML durante el período exigido).',
      ],
    },
    {
      heading: '7. Retención de datos',
      body: [
        'Los datos de la cuenta se conservan mientras esté activa. Tras el cierre, los datos exigidos por ley (transacciones, KYC) se guardan durante el período regulado; el resto se elimina.',
      ],
    },
    {
      heading: '8. Contacto',
      body: ['Las preguntas sobre datos y privacidad pueden enviarse a través de la sección de soporte de tu cuenta.'],
    },
  ],
};

const ES_ABOUT: LegalContent = {
  title: 'Sobre nosotros',
  updated: 'Última actualización: 22 de agosto de 2026',
  intro:
    'VOLTEX es una plataforma de trading de criptomonedas: trading spot y de futuros con margen, órdenes límite, de mercado, stop y take-profit, depósitos y retiros en las redes admitidas.',
  sections: [
    {
      heading: 'Motor de emparejamiento',
      body: [
        'Las órdenes se emparejan mediante nuestro propio motor de emparejamiento por precio-tiempo. Los datos de mercado (precios, velas, libro de órdenes) reflejan una API de exchange real — sin cotizaciones fijas ni generadas.',
      ],
    },
    {
      heading: 'Seguridad de la cuenta',
      body: [
        'Las contraseñas se almacenan como hashes bcrypt irreversibles, y los secretos de las claves API se encriptan en reposo. La autenticación de dos factores y un historial de inicios de sesión están disponibles en Configuración → Seguridad.',
      ],
    },
    {
      heading: 'Futuros y gestión de riesgo',
      body: [
        'Trading con margen aislado y cruzado, apalancamiento por niveles, liquidación automática contra un precio de referencia real, y un fondo de seguro para déficits en la liquidación.',
      ],
    },
    {
      heading: 'Transparencia',
      body: [
        'No publicamos afirmaciones no verificables sobre rendimientos o volumen de trading. Las comisiones, límites y términos se muestran en la interfaz donde aplican — antes de confirmar una acción, no en letra pequeña.',
      ],
    },
  ],
};

const ES_SUPPORT: LegalContent = {
  title: 'Soporte',
  updated: 'Última actualización: 22 de agosto de 2026',
  intro: 'Respuestas a preguntas comunes. Para algo específico de tu cuenta, revisa primero Configuración.',
  sections: [
    {
      heading: 'Cómo depositar',
      body: [
        'Abre "Depositar" → elige una red → envía los fondos a la dirección mostrada → pega el hash de la transacción para verificarla. El depósito mínimo es el equivalente a $1000 USD; cualquier cantidad menor no será acreditada.',
      ],
    },
    {
      heading: 'Mi orden no se ejecuta',
      body: [
        'Verifica que el precio de activación de una orden stop/take-profit esté en el lado correcto del precio de mercado actual — el formulario de orden muestra la dirección requerida en línea. Las órdenes condicionales pendientes esperan su activación y muestran el estado "Pendiente".',
      ],
    },
    {
      heading: 'Seguridad de la cuenta',
      body: [
        'Activa la autenticación de dos factores y revisa periódicamente el historial de inicios de sesión en Configuración → Seguridad — cada inicio de sesión en tu cuenta aparece ahí.',
      ],
    },
    {
      heading: 'Verificación (KYC)',
      body: ['Tu estado de verificación y los documentos requeridos se muestran en la sección de verificación de tu cuenta.'],
    },
    {
      heading: 'Aún tienes preguntas',
      body: ['Esta versión de la plataforma aún no tiene un canal de soporte en vivo — la sección de soporte se limita a esta página de preguntas frecuentes.'],
    },
  ],
};

const ES_RISK: LegalContent = {
  title: 'Divulgación de riesgos',
  updated: 'Última actualización: 22 de agosto de 2026',
  intro: 'El trading de criptomonedas conlleva un riesgo significativo. Antes de operar, asegúrate de entender y aceptar los siguientes riesgos.',
  sections: [
    {
      heading: '1. Volatilidad',
      body: ['Los precios de las criptomonedas pueden moverse bruscamente en periodos cortos. El valor de un activo puede subir significativamente o caer a cero.'],
    },
    {
      heading: '2. Sin garantías',
      body: ['El rendimiento pasado no garantiza resultados futuros. VOLTEX no garantiza ganancias en el trading.'],
    },
    {
      heading: '3. No es asesoría de inversión',
      body: [
        'La información en la plataforma (precios, gráficos, estadísticas) se proporciona solo con fines informativos y no constituye asesoría de inversión, fiscal o legal.',
      ],
    },
    {
      heading: '4. Riesgo de las órdenes de mercado',
      body: ['Las órdenes de mercado se ejecutan al mejor precio disponible y pueden sufrir deslizamiento, especialmente con baja liquidez o alta volatilidad.'],
    },
    {
      heading: '5. Riesgo tecnológico',
      body: ['Las interrupciones de red, retrasos de la blockchain o fallas técnicas pueden afectar la ejecución de órdenes o la disponibilidad del servicio.'],
    },
    {
      heading: '6. Riesgo regulatorio',
      body: ['El estatus legal de las criptomonedas varía según la jurisdicción y puede cambiar, lo que puede afectar la disponibilidad del servicio.'],
    },
    {
      heading: '7. Irreversibilidad de las transacciones',
      body: ['Las transferencias en cadena generalmente son irreversibles. Verifica cuidadosamente la dirección y la red antes de retirar fondos.'],
    },
    {
      heading: '8. Reconocimiento',
      body: ['Al usar VOLTEX para operar, confirmas que entiendes los riesgos enumerados anteriormente y operas bajo tu propio riesgo.'],
    },
  ],
};

const HI_TERMS: LegalContent = {
  title: 'सेवा की शर्तें',
  updated: 'आखिरी बार अपडेट किया गया: 22 अगस्त, 2026',
  intro:
    'ये शर्तें VOLTEX प्लेटफ़ॉर्म के आपके उपयोग को नियंत्रित करती हैं। रजिस्टर करके या सेवा का उपयोग करके, आप पुष्टि करते हैं कि आपने निम्नलिखित को पढ़ा है और उससे सहमत हैं।',
  sections: [
    {
      heading: '1. सेवा के बारे में',
      body: [
        'VOLTEX एक क्रिप्टोकरेंसी ट्रेडिंग प्लेटफ़ॉर्म है जो आपको लिमिट और मार्केट ऑर्डर देने, इंटरनल वॉलेट में एसेट्स रखने, और समर्थित नेटवर्क पर डिपॉज़िट/निकासी करने देता है।',
      ],
    },
    {
      heading: '2. पात्रता',
      body: [
        'यह सेवा केवल 18 वर्ष या उससे अधिक उम्र के कानूनी क्षमता वाले व्यक्तियों के लिए उपलब्ध है। रजिस्टर करके, आप पुष्टि करते हैं कि आपके क्षेत्राधिकार में क्रिप्टोकरेंसी सेवाओं का उपयोग प्रतिबंधित नहीं है।',
      ],
    },
    {
      heading: '3. अकाउंट और सुरक्षा',
      body: [
        'अपने पासवर्ड को गोपनीय रखना, और सक्षम होने पर अपने दो-चरणीय प्रमाणीकरण क्रेडेंशियल्स को सुरक्षित रखना आपकी ज़िम्मेदारी है। हम दृढ़ता से सलाह देते हैं कि आप सेटिंग्स → सुरक्षा में 2FA सक्षम करें।',
        'यदि आपको अपने अकाउंट में अनधिकृत पहुंच का संदेह हो तो तुरंत हमें सूचित करें।',
      ],
    },
    {
      heading: '4. ऑर्डर और निष्पादन',
      body: [
        'ऑर्डर ट्रेडिंग इंजन द्वारा प्राइस-टाइम प्राथमिकता के आधार पर मैच किए जाते हैं। मार्केट ऑर्डर, दिए जाने के समय ऑर्डर बुक में उपलब्ध सर्वोत्तम कीमत पर पूरे होते हैं और कम लिक्विडिटी होने पर स्लिपेज के अधीन हो सकते हैं।',
      ],
    },
    {
      heading: '5. फीस',
      body: [
        'वर्तमान ट्रेडिंग फीस ट्रेड कन्फर्म करने से पहले इंटरफ़ेस में दिखाई जाती है। हम सेवा के भीतर अग्रिम सूचना के साथ फीस बदल सकते हैं।',
      ],
    },
    {
      heading: '6. निषिद्ध उपयोग',
      body: [
        'आप सेवा का उपयोग मनी लॉन्ड्रिंग, निषिद्ध गतिविधि के वित्तपोषण, मार्केट मैनिपुलेशन (स्पूफिंग, वॉश ट्रेडिंग), या प्लेटफ़ॉर्म की तकनीकी सुरक्षा को दरकिनार करने की कोशिश के लिए नहीं कर सकते।',
      ],
    },
    {
      heading: '7. निलंबन और समाप्ति',
      body: [
        'हम इन शर्तों के उल्लंघन, कानून का पालन करने, या धोखाधड़ी के संदेह पर एक अकाउंट को निलंबित या बंद कर सकते हैं, जहां संभव हो यूज़र को सूचित करते हुए।',
      ],
    },
    {
      heading: '8. दायित्व की सीमा',
      body: [
        'सेवा "जैसी है वैसी" प्रदान की जाती है। हम निर्बाध संचालन की गारंटी नहीं देते और मार्केट अस्थिरता, नेटवर्क आउटेज, या तीसरे पक्ष की कार्रवाइयों से होने वाले नुकसान के लिए उत्तरदायी नहीं हैं।',
      ],
    },
    {
      heading: '9. इन शर्तों में बदलाव',
      body: ['हम इन शर्तों को अपडेट कर सकते हैं। महत्वपूर्ण बदलाव प्रभावी होने से कम से कम 7 दिन पहले सेवा में घोषित किए जाएंगे।'],
    },
  ],
};

const HI_PRIVACY: LegalContent = {
  title: 'गोपनीयता नीति',
  updated: 'आखिरी बार अपडेट किया गया: 22 अगस्त, 2026',
  intro: 'यह दस्तावेज़ बताता है कि हम कौन सा डेटा एकत्र करते हैं, क्यों, और हम इसे कैसे सुरक्षित रखते हैं।',
  sections: [
    {
      heading: '1. हम जो डेटा एकत्र करते हैं',
      body: [
        'रजिस्ट्रेशन डेटा (ईमेल, हैश किया गया पासवर्ड), सत्यापन (KYC) डेटा — नाम, देश, पहचान दस्तावेज़ — ट्रेडिंग और ट्रांज़ैक्शन इतिहास, और सुरक्षा उद्देश्यों के लिए तकनीकी डेटा (IP एड्रेस, डिवाइस प्रकार)।',
      ],
    },
    {
      heading: '2. हम इसका उपयोग कैसे करते हैं',
      body: [
        'सेवा प्रदान करने, ऑर्डर निष्पादित करने, डिपॉज़िट/निकासी प्रोसेस करने, धोखाधड़ी रोकने, और मनी लॉन्ड्रिंग-विरोधी (AML/KYC) आवश्यकताओं का पालन करने के लिए।',
      ],
    },
    {
      heading: '3. सत्यापन (KYC) डेटा',
      body: [
        'पहचान सत्यापन के लिए अपलोड किए गए दस्तावेज़ एन्क्रिप्टेड रूप में संग्रहीत होते हैं और समीक्षा और नियामक अनुपालन उद्देश्यों के लिए केवल अधिकृत स्टाफ के लिए सुलभ होते हैं।',
      ],
    },
    {
      heading: '4. तीसरे पक्ष के साथ साझाकरण',
      body: [
        'हम व्यक्तिगत डेटा नहीं बेचते। डेटा को इंफ्रास्ट्रक्चर प्रदाताओं (होस्टिंग, पेमेंट प्रोसेसिंग) के साथ केवल सेवा संचालित करने के लिए आवश्यक सीमा तक साझा किया जा सकता है, और कानूनी अनुरोध पर अधिकारियों के साथ।',
      ],
    },
    {
      heading: '5. डेटा सुरक्षा',
      body: [
        'पासवर्ड अपरिवर्तनीय bcrypt हैश के रूप में संग्रहीत किए जाते हैं। API कुंजी सीक्रेट्स आराम के समय एन्क्रिप्टेड होते हैं। हम अतिरिक्त अकाउंट सुरक्षा के लिए दो-चरणीय प्रमाणीकरण का समर्थन करते हैं।',
      ],
    },
    {
      heading: '6. आपके अधिकार',
      body: [
        'आप अपने डेटा की एक प्रति या उसे हटाने का अनुरोध कर सकते हैं, उस जानकारी को छोड़कर जिसे हम कानूनी रूप से बनाए रखने के लिए बाध्य हैं (जैसे अनिवार्य अवधि के लिए KYC/AML रिकॉर्ड)।',
      ],
    },
    {
      heading: '7. डेटा प्रतिधारण',
      body: [
        'अकाउंट डेटा तब तक बनाए रखा जाता है जब तक अकाउंट सक्रिय है। बंद होने के बाद, कानून द्वारा आवश्यक डेटा (ट्रांज़ैक्शन, KYC) नियमित अवधि के लिए रखा जाता है; बाकी हटा दिया जाता है।',
      ],
    },
    {
      heading: '8. संपर्क',
      body: ['डेटा और गोपनीयता के बारे में प्रश्न आपके अकाउंट में सपोर्ट सेक्शन के माध्यम से भेजे जा सकते हैं।'],
    },
  ],
};

const HI_ABOUT: LegalContent = {
  title: 'हमारे बारे में',
  updated: 'आखिरी बार अपडेट किया गया: 22 अगस्त, 2026',
  intro:
    'VOLTEX एक क्रिप्टोकरेंसी ट्रेडिंग प्लेटफ़ॉर्म है: स्पॉट और मार्जिन फ्यूचर्स ट्रेडिंग, लिमिट, मार्केट, स्टॉप, और टेक-प्रॉफिट ऑर्डर, समर्थित नेटवर्क पर डिपॉज़िट और निकासी।',
  sections: [
    {
      heading: 'मैचिंग इंजन',
      body: [
        'ऑर्डर हमारे अपने प्राइस-टाइम मैचिंग इंजन द्वारा मैच किए जाते हैं। मार्केट डेटा (कीमतें, कैंडल्स, ऑर्डर बुक) एक वास्तविक एक्सचेंज API को प्रतिबिंबित करता है — कोई हार्डकोडेड या जनरेट की गई कोटेशन नहीं।',
      ],
    },
    {
      heading: 'अकाउंट सुरक्षा',
      body: [
        'पासवर्ड अपरिवर्तनीय bcrypt हैश के रूप में संग्रहीत किए जाते हैं, और API कुंजी सीक्रेट्स आराम के समय एन्क्रिप्टेड होते हैं। दो-चरणीय प्रमाणीकरण और लॉगिन इतिहास सेटिंग्स → सुरक्षा में उपलब्ध हैं।',
      ],
    },
    {
      heading: 'फ्यूचर्स और जोखिम प्रबंधन',
      body: [
        'आइसोलेटेड और क्रॉस मार्जिन के साथ मार्जिन ट्रेडिंग, टियर्ड लीवरेज, वास्तविक मार्क प्राइस के खिलाफ स्वचालित लिक्विडेशन, और लिक्विडेशन पर कमी के लिए एक इंश्योरेंस फंड।',
      ],
    },
    {
      heading: 'पारदर्शिता',
      body: [
        'हम रिटर्न या ट्रेडिंग वॉल्यूम के बारे में असत्यापित दावे प्रकाशित नहीं करते। फीस, सीमाएं, और शर्तें वहीं इंटरफ़ेस में दिखाई जाती हैं जहां वे लागू होती हैं — किसी कार्रवाई की पुष्टि करने से पहले, बारीक प्रिंट में नहीं।',
      ],
    },
  ],
};

const HI_SUPPORT: LegalContent = {
  title: 'सपोर्ट',
  updated: 'आखिरी बार अपडेट किया गया: 22 अगस्त, 2026',
  intro: 'सामान्य प्रश्नों के उत्तर। अकाउंट-विशिष्ट किसी भी चीज़ के लिए, पहले सेटिंग्स जांचें।',
  sections: [
    {
      heading: 'डिपॉज़िट कैसे करें',
      body: [
        '"डिपॉज़िट" खोलें → एक नेटवर्क चुनें → दिखाए गए एड्रेस पर फंड भेजें → इसे वेरिफ़ाई करने के लिए ट्रांज़ैक्शन हैश पेस्ट करें। न्यूनतम डिपॉज़िट $1000 USD के बराबर है; इससे कम कुछ भी जमा नहीं किया जाएगा।',
      ],
    },
    {
      heading: 'मेरा ऑर्डर निष्पादित नहीं हो रहा',
      body: [
        'जांचें कि स्टॉप/टेक-प्रॉफिट ट्रिगर कीमत वर्तमान मार्केट कीमत के सही तरफ है — ऑर्डर फॉर्म आवश्यक दिशा इनलाइन दिखाता है। लंबित कंडीशनल ऑर्डर अपने ट्रिगर की प्रतीक्षा करते हैं और "लंबित" स्थिति दिखाते हैं।',
      ],
    },
    {
      heading: 'अकाउंट सुरक्षा',
      body: [
        'दो-चरणीय प्रमाणीकरण चालू करें और समय-समय पर सेटिंग्स → सुरक्षा में लॉगिन इतिहास की समीक्षा करें — आपके अकाउंट में हर साइन-इन वहां दिखाई देता है।',
      ],
    },
    {
      heading: 'सत्यापन (KYC)',
      body: ['आपकी सत्यापन स्थिति और आवश्यक दस्तावेज़ आपके अकाउंट के सत्यापन सेक्शन में दिखाए जाते हैं।'],
    },
    {
      heading: 'अभी भी सवाल हैं',
      body: ['प्लेटफ़ॉर्म के इस संस्करण में अभी तक कोई लाइव सपोर्ट चैनल नहीं है — सपोर्ट सेक्शन इस FAQ पेज तक सीमित है।'],
    },
  ],
};

const HI_RISK: LegalContent = {
  title: 'जोखिम प्रकटीकरण',
  updated: 'आखिरी बार अपडेट किया गया: 22 अगस्त, 2026',
  intro: 'क्रिप्टोकरेंसी ट्रेडिंग में महत्वपूर्ण जोखिम है। ट्रेड करने से पहले, सुनिश्चित करें कि आप नीचे दिए गए जोखिमों को समझते हैं और स्वीकार करते हैं।',
  sections: [
    {
      heading: '1. अस्थिरता',
      body: ['क्रिप्टोकरेंसी की कीमतें कम समय में तेज़ी से बदल सकती हैं। एसेट का मूल्य काफी बढ़ सकता है या शून्य तक गिर सकता है।'],
    },
    {
      heading: '2. कोई गारंटी नहीं',
      body: ['पिछला प्रदर्शन भविष्य के परिणामों की गारंटी नहीं देता। VOLTEX ट्रेडिंग मुनाफे की गारंटी नहीं देता।'],
    },
    {
      heading: '3. निवेश सलाह नहीं',
      body: [
        'प्लेटफ़ॉर्म पर जानकारी (कीमतें, चार्ट, आंकड़े) केवल सूचनात्मक उद्देश्यों के लिए प्रदान की जाती है और यह निवेश, कर, या कानूनी सलाह नहीं है।',
      ],
    },
    {
      heading: '4. मार्केट ऑर्डर जोखिम',
      body: ['मार्केट ऑर्डर सर्वोत्तम उपलब्ध कीमत पर पूरे होते हैं और विशेष रूप से कम लिक्विडिटी या उच्च अस्थिरता के तहत स्लिपेज के अधीन हो सकते हैं।'],
    },
    {
      heading: '5. तकनीकी जोखिम',
      body: ['नेटवर्क आउटेज, ब्लॉकचेन देरी, या तकनीकी खराबी ऑर्डर निष्पादन या सेवा उपलब्धता को प्रभावित कर सकती है।'],
    },
    {
      heading: '6. नियामक जोखिम',
      body: ['क्रिप्टोकरेंसी की कानूनी स्थिति क्षेत्राधिकार के अनुसार अलग-अलग होती है और बदल सकती है, जो सेवा उपलब्धता को प्रभावित कर सकती है।'],
    },
    {
      heading: '7. ट्रांज़ैक्शन की अपरिवर्तनीयता',
      body: ['ऑन-चेन ट्रांसफर आमतौर पर अपरिवर्तनीय होते हैं। फंड निकालने से पहले एड्रेस और नेटवर्क की दोबारा जांच करें।'],
    },
    {
      heading: '8. स्वीकृति',
      body: ['ट्रेड करने के लिए VOLTEX का उपयोग करके, आप पुष्टि करते हैं कि आप ऊपर सूचीबद्ध जोखिमों को समझते हैं और अपने जोखिम पर ट्रेड करते हैं।'],
    },
  ],
};

const JA_TERMS: LegalContent = {
  title: '利用規約',
  updated: '最終更新日: 2026年8月22日',
  intro:
    '本規約は、VOLTEXプラットフォームのご利用について定めるものです。登録またはサービスの利用により、以下の内容を読み、同意したものとみなされます。',
  sections: [
    {
      heading: '1. サービスについて',
      body: [
        'VOLTEXは、指値注文および成行注文の発注、内部ウォレットでの資産保有、対応ネットワークでの入出金が可能な暗号資産取引プラットフォームです。',
      ],
    },
    {
      heading: '2. 利用資格',
      body: [
        '本サービスは、18歳以上で法的行為能力を有する方のみご利用いただけます。登録することにより、お客様の管轄区域において暗号資産サービスの利用が禁止されていないことを確認したものとみなされます。',
      ],
    },
    {
      heading: '3. アカウントとセキュリティ',
      body: [
        'パスワードを秘密に保つこと、および有効化した場合は二段階認証情報を保護することは、お客様の責任です。設定 → セキュリティで2FAを有効にすることを強くお勧めします。',
        'アカウントへの不正アクセスの疑いがある場合は、直ちに当社にご連絡ください。',
      ],
    },
    {
      heading: '4. 注文と執行',
      body: [
        '注文は価格・時間優先の原則に基づき取引エンジンによってマッチングされます。成行注文は発注時点で板情報にある最良価格で執行され、流動性が薄い場合はスリッページが発生することがあります。',
      ],
    },
    {
      heading: '5. 手数料',
      body: [
        '現在の取引手数料は、取引を確定する前にインターフェース上に表示されます。当社はサービス内での事前通知をもって手数料を変更することがあります。',
      ],
    },
    {
      heading: '6. 禁止事項',
      body: [
        'マネーロンダリング、禁止されている活動への資金供与、市場操作（スプーフィング、仮装売買）、またはプラットフォームの技術的保護措置を回避しようとする行為に本サービスを利用することはできません。',
      ],
    },
    {
      heading: '7. 停止および解約',
      body: [
        '当社は、本規約への違反、法令遵守、または不正の疑いがある場合、可能な限りユーザーに通知した上で、アカウントを停止または閉鎖することがあります。',
      ],
    },
    {
      heading: '8. 責任の制限',
      body: [
        '本サービスは「現状有姿」で提供されます。当社は継続的な稼働を保証せず、市場のボラティリティ、ネットワーク障害、第三者の行為に起因する損失について責任を負いません。',
      ],
    },
    {
      heading: '9. 本規約の変更',
      body: ['当社は本規約を更新することがあります。重要な変更は、発効の少なくとも7日前にサービス内で告知されます。'],
    },
  ],
};

const JA_PRIVACY: LegalContent = {
  title: 'プライバシーポリシー',
  updated: '最終更新日: 2026年8月22日',
  intro: '本ドキュメントでは、当社が収集するデータ、その理由、および保護方法について説明します。',
  sections: [
    {
      heading: '1. 収集するデータ',
      body: [
        '登録データ（メールアドレス、ハッシュ化されたパスワード）、本人確認（KYC）データ（氏名、国、身分証明書）、取引およびトランザクション履歴、セキュリティ目的の技術データ（IPアドレス、デバイスの種類）。',
      ],
    },
    {
      heading: '2. データの利用方法',
      body: [
        'サービスの提供、注文の執行、入出金の処理、不正防止、マネーロンダリング対策（AML/KYC）要件の遵守のために利用します。',
      ],
    },
    {
      heading: '3. 本人確認（KYC）データ',
      body: [
        '本人確認のためにアップロードされた書類は暗号化されて保管され、審査および規制遵守の目的で権限を持つスタッフのみがアクセスできます。',
      ],
    },
    {
      heading: '4. 第三者との共有',
      body: [
        '当社は個人データを販売しません。データは、サービス運営に必要な範囲内でのみインフラプロバイダー（ホスティング、決済処理）と共有され、正当な法的要求があった場合には当局と共有されることがあります。',
      ],
    },
    {
      heading: '5. データセキュリティ',
      body: [
        'パスワードは復元不可能なbcryptハッシュとして保管されます。APIキーのシークレットは保存時に暗号化されます。アカウントのさらなる保護のため二段階認証に対応しています。',
      ],
    },
    {
      heading: '6. お客様の権利',
      body: [
        'お客様のデータのコピーの請求、または削除の請求が可能です。ただし、法令により保持が義務付けられている情報（例：規定期間のKYC/AML記録）は除きます。',
      ],
    },
    {
      heading: '7. データの保持',
      body: [
        'アカウントデータはアカウントが有効である間保持されます。解約後、法令で必要なデータ（トランザクション、KYC）は規定の期間保持され、それ以外は削除されます。',
      ],
    },
    {
      heading: '8. お問い合わせ',
      body: ['データおよびプライバシーに関するご質問は、アカウント内のサポートセクションからお送りいただけます。'],
    },
  ],
};

const JA_ABOUT: LegalContent = {
  title: '会社概要',
  updated: '最終更新日: 2026年8月22日',
  intro:
    'VOLTEXは、現物取引および証拠金付き先物取引、指値・成行・ストップ・テイクプロフィット注文、対応ネットワークでの入出金を提供する暗号資産取引プラットフォームです。',
  sections: [
    {
      heading: 'マッチングエンジン',
      body: [
        '注文は当社独自の価格・時間優先マッチングエンジンによって処理されます。マーケットデータ（価格、ローソク足、板情報）は実際の取引所APIを反映しており、ハードコードや生成された相場は使用していません。',
      ],
    },
    {
      heading: 'アカウントセキュリティ',
      body: [
        'パスワードは復元不可能なbcryptハッシュとして保管され、APIキーのシークレットは保存時に暗号化されます。二段階認証とログイン履歴は設定 → セキュリティでご利用いただけます。',
      ],
    },
    {
      heading: '先物とリスク管理',
      body: [
        '分離証拠金とクロス証拠金による証拠金取引、段階的なレバレッジ制限、実際のマーク価格に基づく自動清算、清算時の不足分に対する保険基金。',
      ],
    },
    {
      heading: '透明性',
      body: [
        '検証不可能な収益や取引量の主張は公開しません。手数料、限度額、規約は該当する箇所でインターフェース上に表示されます — 小さな文字ではなく、操作を確定する前に明示します。',
      ],
    },
  ],
};

const JA_SUPPORT: LegalContent = {
  title: 'サポート',
  updated: '最終更新日: 2026年8月22日',
  intro: 'よくあるご質問への回答です。アカウント固有の問題については、まず設定をご確認ください。',
  sections: [
    {
      heading: '入金方法',
      body: [
        '「入金」を開く → ネットワークを選択 → 表示されたアドレスに資金を送金 → トランザクションハッシュを貼り付けて確認します。最低入金額は1000米ドル相当です。これを下回る金額は反映されません。',
      ],
    },
    {
      heading: '注文が執行されません',
      body: [
        'ストップ/テイクプロフィットのトリガー価格が現在の市場価格に対して正しい側にあるか確認してください — 注文フォームに必要な方向が表示されます。保留中の条件付き注文はトリガーを待機しており、「待機中」ステータスが表示されます。',
      ],
    },
    {
      heading: 'アカウントセキュリティ',
      body: [
        '二段階認証を有効にし、設定 → セキュリティで定期的にログイン履歴を確認してください — アカウントへのすべてのサインインがそこに表示されます。',
      ],
    },
    {
      heading: '本人確認（KYC）',
      body: ['本人確認のステータスと必要な書類は、アカウントの本人確認セクションに表示されます。'],
    },
    {
      heading: 'まだご質問がある場合',
      body: ['本プラットフォームの現バージョンにはまだライブサポートチャネルがなく、サポートセクションはこのFAQページに限られます。'],
    },
  ],
};

const JA_RISK: LegalContent = {
  title: 'リスク開示',
  updated: '最終更新日: 2026年8月22日',
  intro: '暗号資産取引には重大なリスクが伴います。取引を行う前に、以下のリスクを理解し、受け入れてください。',
  sections: [
    {
      heading: '1. ボラティリティ',
      body: ['暗号資産の価格は短期間で急激に変動することがあります。資産の価値は大幅に上昇することも、ゼロまで下落することもあります。'],
    },
    {
      heading: '2. 保証なし',
      body: ['過去の実績は将来の結果を保証するものではありません。VOLTEXは取引利益を保証しません。'],
    },
    {
      heading: '3. 投資助言ではありません',
      body: [
        'プラットフォーム上の情報（価格、チャート、統計）は情報提供のみを目的としており、投資、税務、または法律に関する助言ではありません。',
      ],
    },
    {
      heading: '4. 成行注文のリスク',
      body: ['成行注文は最良価格で執行されますが、特に流動性が薄い場合や高いボラティリティの下ではスリッページが発生することがあります。'],
    },
    {
      heading: '5. 技術的リスク',
      body: ['ネットワーク障害、ブロックチェーンの遅延、または技術的な不具合が注文の執行やサービスの利用可能性に影響を及ぼすことがあります。'],
    },
    {
      heading: '6. 規制リスク',
      body: ['暗号資産の法的地位は管轄区域によって異なり、変化する可能性があり、サービスの利用可能性に影響を与えることがあります。'],
    },
    {
      heading: '7. 取引の不可逆性',
      body: ['オンチェーンの送金は一般的に取り消しできません。資金を出金する前に、アドレスとネットワークを十分に確認してください。'],
    },
    {
      heading: '8. 確認事項',
      body: ['VOLTEXを利用して取引を行うことにより、上記のリスクを理解し、自己責任で取引を行うことを確認したものとみなされます。'],
    },
  ],
};

const KO_TERMS: LegalContent = {
  title: '이용약관',
  updated: '최종 업데이트: 2026년 8월 22일',
  intro:
    '본 약관은 VOLTEX 플랫폼 이용에 적용됩니다. 가입 또는 서비스 이용 시 아래 내용을 읽고 동의한 것으로 간주됩니다.',
  sections: [
    {
      heading: '1. 서비스 소개',
      body: [
        'VOLTEX는 지정가 및 시장가 주문 실행, 내부 지갑을 통한 자산 보관, 지원 네트워크를 통한 입출금이 가능한 암호화폐 거래 플랫폼입니다.',
      ],
    },
    {
      heading: '2. 이용 자격',
      body: [
        '본 서비스는 만 18세 이상의 법적 행위 능력을 갖춘 자에게만 제공됩니다. 가입 시, 귀하의 관할 지역에서 암호화폐 서비스 이용이 금지되어 있지 않음을 확인한 것으로 간주됩니다.',
      ],
    },
    {
      heading: '3. 계정 및 보안',
      body: [
        '비밀번호를 안전하게 보관하고, 활성화된 경우 2단계 인증 정보를 보호할 책임은 귀하에게 있습니다. 설정 → 보안에서 2FA를 활성화할 것을 강력히 권장합니다.',
        '계정에 무단 접근이 의심되는 경우 즉시 당사에 알려주시기 바랍니다.',
      ],
    },
    {
      heading: '4. 주문 및 체결',
      body: [
        '주문은 가격-시간 우선 원칙에 따라 거래 엔진에서 매칭됩니다. 시장가 주문은 발주 시점의 호가창에서 이용 가능한 최적 가격으로 체결되며, 유동성이 낮을 경우 슬리피지가 발생할 수 있습니다.',
      ],
    },
    {
      heading: '5. 수수료',
      body: [
        '현재 거래 수수료는 거래를 확정하기 전에 인터페이스에 표시됩니다. 당사는 서비스 내 사전 공지를 통해 수수료를 변경할 수 있습니다.',
      ],
    },
    {
      heading: '6. 금지된 이용',
      body: [
        '자금 세탁, 금지된 활동에 대한 자금 조달, 시장 조작(스푸핑, 자전거래), 또는 플랫폼의 기술적 보호 장치를 우회하려는 시도에 본 서비스를 이용할 수 없습니다.',
      ],
    },
    {
      heading: '7. 정지 및 해지',
      body: [
        '당사는 본 약관 위반, 법령 준수, 또는 사기 의심 시 가능한 경우 사용자에게 통지한 후 계정을 정지하거나 폐쇄할 수 있습니다.',
      ],
    },
    {
      heading: '8. 책임의 제한',
      body: [
        '본 서비스는 "있는 그대로" 제공됩니다. 당사는 중단 없는 운영을 보장하지 않으며, 시장 변동성, 네트워크 장애 또는 제3자의 행위로 인한 손실에 대해 책임지지 않습니다.',
      ],
    },
    {
      heading: '9. 본 약관의 변경',
      body: ['당사는 본 약관을 업데이트할 수 있습니다. 중대한 변경 사항은 발효 최소 7일 전에 서비스 내에서 공지됩니다.'],
    },
  ],
};

const KO_PRIVACY: LegalContent = {
  title: '개인정보 보호정책',
  updated: '최종 업데이트: 2026년 8월 22일',
  intro: '본 문서는 당사가 수집하는 데이터, 그 이유, 그리고 보호 방법을 설명합니다.',
  sections: [
    {
      heading: '1. 수집하는 데이터',
      body: [
        '가입 데이터(이메일, 해시 처리된 비밀번호), 본인 인증(KYC) 데이터(이름, 국가, 신분증), 거래 및 트랜잭션 내역, 보안 목적의 기술 데이터(IP 주소, 기기 유형).',
      ],
    },
    {
      heading: '2. 데이터 이용 방법',
      body: [
        '서비스 제공, 주문 실행, 입출금 처리, 사기 방지, 자금세탁방지(AML/KYC) 요건 준수를 위해 사용됩니다.',
      ],
    },
    {
      heading: '3. 본인 인증(KYC) 데이터',
      body: [
        '본인 인증을 위해 업로드된 서류는 암호화되어 저장되며, 심사 및 규제 준수 목적으로 승인된 직원만 접근할 수 있습니다.',
      ],
    },
    {
      heading: '4. 제3자와의 공유',
      body: [
        '당사는 개인 데이터를 판매하지 않습니다. 데이터는 서비스 운영에 필요한 범위 내에서만 인프라 제공업체(호스팅, 결제 처리)와 공유될 수 있으며, 정당한 법적 요청이 있는 경우 관계 당국과 공유될 수 있습니다.',
      ],
    },
    {
      heading: '5. 데이터 보안',
      body: [
        '비밀번호는 복호화가 불가능한 bcrypt 해시로 저장됩니다. API 키 시크릿은 저장 시 암호화됩니다. 계정 보호 강화를 위해 2단계 인증을 지원합니다.',
      ],
    },
    {
      heading: '6. 귀하의 권리',
      body: [
        '귀하의 데이터 사본을 요청하거나 삭제를 요청할 수 있습니다. 단, 법적으로 보관이 의무화된 정보(예: 규정된 기간 동안의 KYC/AML 기록)는 제외됩니다.',
      ],
    },
    {
      heading: '7. 데이터 보관',
      body: [
        '계정 데이터는 계정이 활성 상태인 동안 보관됩니다. 계정 해지 후, 법적으로 요구되는 데이터(트랜잭션, KYC)는 규정된 기간 동안 보관되며 나머지는 삭제됩니다.',
      ],
    },
    {
      heading: '8. 문의',
      body: ['데이터 및 개인정보 보호에 관한 질문은 계정 내 고객센터 섹션을 통해 보내실 수 있습니다.'],
    },
  ],
};

const KO_ABOUT: LegalContent = {
  title: '회사 소개',
  updated: '최종 업데이트: 2026년 8월 22일',
  intro:
    'VOLTEX는 현물 및 증거금 선물 거래, 지정가·시장가·스탑·익절 주문, 지원 네트워크를 통한 입출금을 제공하는 암호화폐 거래 플랫폼입니다.',
  sections: [
    {
      heading: '매칭 엔진',
      body: [
        '주문은 당사 자체의 가격-시간 매칭 엔진에 의해 매칭됩니다. 마켓 데이터(가격, 캔들, 호가창)는 실제 거래소 API를 반영하며, 하드코딩되거나 생성된 시세는 사용하지 않습니다.',
      ],
    },
    {
      heading: '계정 보안',
      body: [
        '비밀번호는 복호화가 불가능한 bcrypt 해시로 저장되며, API 키 시크릿은 저장 시 암호화됩니다. 2단계 인증과 로그인 내역은 설정 → 보안에서 이용할 수 있습니다.',
      ],
    },
    {
      heading: '선물 및 위험 관리',
      body: [
        '격리 및 교차 증거금을 통한 마진 거래, 단계별 레버리지 한도, 실제 마크 가격 기준 자동 청산, 청산 시 부족분에 대한 보험 기금.',
      ],
    },
    {
      heading: '투명성',
      body: [
        '검증할 수 없는 수익률이나 거래량 주장을 게시하지 않습니다. 수수료, 한도, 약관은 해당되는 곳에 인터페이스에 표시됩니다 — 작은 글씨가 아니라 작업을 확정하기 전에 명확히 안내됩니다.',
      ],
    },
  ],
};

const KO_SUPPORT: LegalContent = {
  title: '고객센터',
  updated: '최종 업데이트: 2026년 8월 22일',
  intro: '자주 묻는 질문에 대한 답변입니다. 계정과 관련된 특정 문제는 먼저 설정을 확인해 주세요.',
  sections: [
    {
      heading: '입금 방법',
      body: [
        '"입금"을 열기 → 네트워크 선택 → 표시된 주소로 자금 전송 → 트랜잭션 해시를 붙여넣어 확인합니다. 최소 입금액은 1000달러 상당이며, 이보다 적은 금액은 입금 처리되지 않습니다.',
      ],
    },
    {
      heading: '주문이 체결되지 않습니다',
      body: [
        '스탑/익절 트리거 가격이 현재 시장 가격의 올바른 방향에 있는지 확인하세요 — 주문 양식에 필요한 방향이 표시됩니다. 대기 중인 조건부 주문은 트리거를 기다리며 "대기 중" 상태로 표시됩니다.',
      ],
    },
    {
      heading: '계정 보안',
      body: [
        '2단계 인증을 켜고 설정 → 보안에서 로그인 내역을 주기적으로 확인하세요 — 계정에 대한 모든 로그인이 그곳에 표시됩니다.',
      ],
    },
    {
      heading: '본인 인증(KYC)',
      body: ['귀하의 인증 상태와 필요한 서류는 계정의 인증 섹션에 표시됩니다.'],
    },
    {
      heading: '더 궁금한 점이 있으신가요',
      body: ['본 플랫폼의 현재 버전에는 아직 실시간 고객센터 채널이 없으며, 고객센터 섹션은 이 FAQ 페이지로 제한됩니다.'],
    },
  ],
};

const KO_RISK: LegalContent = {
  title: '위험 고지',
  updated: '최종 업데이트: 2026년 8월 22일',
  intro: '암호화폐 거래에는 상당한 위험이 따릅니다. 거래하기 전에 아래 위험을 이해하고 수락했는지 확인하세요.',
  sections: [
    {
      heading: '1. 변동성',
      body: ['암호화폐 가격은 짧은 기간에 급격히 변동할 수 있습니다. 자산 가치는 크게 상승하거나 0까지 하락할 수 있습니다.'],
    },
    {
      heading: '2. 보장 없음',
      body: ['과거 실적이 미래 결과를 보장하지 않습니다. VOLTEX는 거래 수익을 보장하지 않습니다.'],
    },
    {
      heading: '3. 투자 자문이 아님',
      body: [
        '플랫폼에 제공되는 정보(가격, 차트, 통계)는 정보 제공 목적으로만 제공되며 투자, 세무 또는 법률 자문이 아닙니다.',
      ],
    },
    {
      heading: '4. 시장가 주문 위험',
      body: ['시장가 주문은 이용 가능한 최적 가격으로 체결되며, 특히 유동성이 낮거나 변동성이 높을 때 슬리피지가 발생할 수 있습니다.'],
    },
    {
      heading: '5. 기술적 위험',
      body: ['네트워크 장애, 블록체인 지연 또는 기술적 결함이 주문 체결이나 서비스 이용 가능성에 영향을 줄 수 있습니다.'],
    },
    {
      heading: '6. 규제 위험',
      body: ['암호화폐의 법적 지위는 관할 지역에 따라 다르며 변경될 수 있고, 이는 서비스 이용 가능성에 영향을 줄 수 있습니다.'],
    },
    {
      heading: '7. 거래의 비가역성',
      body: ['온체인 송금은 일반적으로 취소할 수 없습니다. 자금을 출금하기 전에 주소와 네트워크를 반드시 다시 확인하세요.'],
    },
    {
      heading: '8. 확인',
      body: ['거래를 위해 VOLTEX를 이용함으로써, 귀하는 위에 나열된 위험을 이해하며 본인의 책임하에 거래함을 확인한 것으로 간주됩니다.'],
    },
  ],
};

export const LEGAL_CONTENT: Record<Lang, Record<LegalDoc, LegalContent>> = {
  ru: { terms: RU_TERMS, privacy: RU_PRIVACY, risk: RU_RISK, about: RU_ABOUT, support: RU_SUPPORT },
  en: { terms: EN_TERMS, privacy: EN_PRIVACY, risk: EN_RISK, about: EN_ABOUT, support: EN_SUPPORT },
  zh: { terms: ZH_TERMS, privacy: ZH_PRIVACY, risk: ZH_RISK, about: ZH_ABOUT, support: ZH_SUPPORT },
  es: { terms: ES_TERMS, privacy: ES_PRIVACY, risk: ES_RISK, about: ES_ABOUT, support: ES_SUPPORT },
  hi: { terms: HI_TERMS, privacy: HI_PRIVACY, risk: HI_RISK, about: HI_ABOUT, support: HI_SUPPORT },
  ja: { terms: JA_TERMS, privacy: JA_PRIVACY, risk: JA_RISK, about: JA_ABOUT, support: JA_SUPPORT },
  ko: { terms: KO_TERMS, privacy: KO_PRIVACY, risk: KO_RISK, about: KO_ABOUT, support: KO_SUPPORT },
};
