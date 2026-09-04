import { Lang, useLanguage } from '../../lib/i18n';

type AuthCopy = {
  hero: [string, string, string]; intro: string;
  benefits: [string, string][];
  overline: string; registerSubtitle: string; loginTitle: string; loginSubtitle: string;
  noAccount: string; forgot: string; legalStart: string; legalAnd: string;
  legalTerms?: string; legalPrivacy?: string;
};

// Auth-only copy: changing these screens does not change marketing or trading pages.
const COPY: Record<Lang, AuthCopy> = {
  ru: {
    hero: ['Биржа', 'институционального', 'уровня'],
    intro: 'Спотовая торговля, фьючерсы, аналитика и VOLTEX Crypto Card в единой экосистеме.',
    benefits: [
      ['0% комиссия', 'Нулевая комиссия платформы на спотовую торговлю.'],
      ['500+ цифровых активов', 'Широкий выбор торговых инструментов для частных и институциональных клиентов.'],
      ['VOLTEX Crypto Card', 'Оплата покупок и онлайн-подписок, а также снятие наличных в банкоматах в России.'],
    ],
    overline: 'НОВЫЙ АККАУНТ', registerSubtitle: 'Зарегистрируйтесь и получите доступ к VOLTEX.',
    loginTitle: 'Войти в VOLTEX', loginSubtitle: 'Введите данные своего аккаунта.',
    noAccount: 'Нет аккаунта?', forgot: 'Забыли пароль?',
    legalStart: 'Создавая аккаунт, вы соглашаетесь с', legalAnd: 'и',
    legalTerms: 'Пользовательским соглашением', legalPrivacy: 'Политикой конфиденциальности',
  },
  en: {
    hero: ['An exchange', 'for institutional', 'standards'],
    intro: 'Spot trading, futures, analytics and VOLTEX Crypto Card in one ecosystem.',
    benefits: [['0% commission', 'Zero platform commission on spot trading.'], ['500+ digital assets', 'A broad choice of trading instruments for individual and institutional clients.'], ['VOLTEX Crypto Card', 'Pay for purchases and online subscriptions, and withdraw cash at ATMs in Russia.']],
    overline: 'NEW ACCOUNT', registerSubtitle: 'Register to access VOLTEX.', loginTitle: 'Log in to VOLTEX', loginSubtitle: 'Enter your account details.', noAccount: 'No account yet?', forgot: 'Forgot password?', legalStart: 'By creating an account, you agree to the', legalAnd: 'and',
  },
  zh: {
    hero: ['机构级', '数字资产', '交易所'], intro: '现货交易、期货、分析与 VOLTEX Crypto Card，汇聚于同一生态系统。',
    benefits: [['0% 手续费', '现货交易平台手续费为零。'], ['500+ 数字资产', '为个人和机构客户提供丰富的交易工具。'], ['VOLTEX Crypto Card', '在俄罗斯购物、支付在线订阅并通过 ATM 提取现金。']],
    overline: '新账户', registerSubtitle: '注册以访问 VOLTEX。', loginTitle: '登录 VOLTEX', loginSubtitle: '输入您的账户信息。', noAccount: '还没有账户？', forgot: '忘记密码？', legalStart: '创建账户即表示您同意', legalAnd: '和',
  },
  es: {
    hero: ['Un exchange', 'de nivel', 'institucional'], intro: 'Trading al contado, futuros, análisis y VOLTEX Crypto Card en un solo ecosistema.',
    benefits: [['0% de comisión', 'Sin comisión de plataforma en operaciones al contado.'], ['Más de 500 activos digitales', 'Una amplia selección de instrumentos para clientes particulares e institucionales.'], ['VOLTEX Crypto Card', 'Paga compras y suscripciones en línea y retira efectivo en cajeros de Rusia.']],
    overline: 'NUEVA CUENTA', registerSubtitle: 'Regístrate para acceder a VOLTEX.', loginTitle: 'Acceder a VOLTEX', loginSubtitle: 'Introduce los datos de tu cuenta.', noAccount: '¿No tienes cuenta?', forgot: '¿Olvidaste la contraseña?', legalStart: 'Al crear una cuenta, aceptas los', legalAnd: 'y la',
  },
  hi: {
    hero: ['संस्थागत', 'स्तर का', 'एक्सचेंज'], intro: 'स्पॉट ट्रेडिंग, फ़्यूचर्स, विश्लेषण और VOLTEX Crypto Card एक ही इकोसिस्टम में।',
    benefits: [['0% कमीशन', 'स्पॉट ट्रेडिंग पर शून्य प्लेटफ़ॉर्म कमीशन।'], ['500+ डिजिटल एसेट', 'व्यक्तिगत और संस्थागत ग्राहकों के लिए ट्रेडिंग उपकरणों का व्यापक चयन।'], ['VOLTEX Crypto Card', 'रूस में खरीदारी और ऑनलाइन सदस्यताओं का भुगतान करें और ATM से नकद निकालें।']],
    overline: 'नया खाता', registerSubtitle: 'VOLTEX का उपयोग करने के लिए पंजीकरण करें।', loginTitle: 'VOLTEX में लॉग इन करें', loginSubtitle: 'अपने खाते का विवरण दर्ज करें।', noAccount: 'खाता नहीं है?', forgot: 'पासवर्ड भूल गए?', legalStart: 'खाता बनाकर आप सहमत होते हैं:', legalAnd: 'और',
  },
  ja: {
    hero: ['機関投資家', '水準の', '取引所'], intro: '現物取引、先物、分析、VOLTEX Crypto Card をひとつのエコシステムで。',
    benefits: [['手数料 0%', '現物取引のプラットフォーム手数料は無料です。'], ['500 以上のデジタル資産', '個人・機関投資家向けに幅広い取引商品を提供。'], ['VOLTEX Crypto Card', 'ロシアでの買い物、オンライン定期購入の支払い、ATM での現金引き出しに。']],
    overline: '新規アカウント', registerSubtitle: '登録して VOLTEX をご利用ください。', loginTitle: 'VOLTEX にログイン', loginSubtitle: 'アカウント情報を入力してください。', noAccount: 'アカウントをお持ちでない方', forgot: 'パスワードをお忘れですか？', legalStart: 'アカウントの作成により、以下に同意します：', legalAnd: 'および',
  },
  ko: {
    hero: ['기관 수준의', '디지털 자산', '거래소'], intro: '현물 거래, 선물, 분석 및 VOLTEX Crypto Card를 하나의 생태계에서.',
    benefits: [['수수료 0%', '현물 거래 플랫폼 수수료가 없습니다.'], ['500개 이상의 디지털 자산', '개인 및 기관 고객을 위한 다양한 거래 상품.'], ['VOLTEX Crypto Card', '러시아에서 쇼핑 및 온라인 구독 결제와 ATM 현금 인출을 이용하세요.']],
    overline: '새 계정', registerSubtitle: '가입하고 VOLTEX를 이용하세요.', loginTitle: 'VOLTEX 로그인', loginSubtitle: '계정 정보를 입력하세요.', noAccount: '계정이 없으신가요?', forgot: '비밀번호를 잊으셨나요?', legalStart: '계정을 만들면 다음에 동의합니다:', legalAnd: '및',
  },
};

export function useAuthCopy() {
  return COPY[useLanguage().lang];
}
