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

export const LEGAL_CONTENT: Record<Lang, Record<LegalDoc, LegalContent>> = {
  ru: { terms: RU_TERMS, privacy: RU_PRIVACY, risk: RU_RISK, about: RU_ABOUT, support: RU_SUPPORT },
  en: { terms: EN_TERMS, privacy: EN_PRIVACY, risk: EN_RISK, about: EN_ABOUT, support: EN_SUPPORT },
  zh: { terms: ZH_TERMS, privacy: ZH_PRIVACY, risk: ZH_RISK, about: ZH_ABOUT, support: ZH_SUPPORT },
};
