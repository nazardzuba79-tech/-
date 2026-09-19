from pathlib import Path
import re,sys,json
root=Path(sys.argv[1] if len(sys.argv)>1 else '.')
changed=[]
def write(name,content):
 p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content);changed.append(name)
def edit(name,old,new):
 p=root/name;s=p.read_text();assert s.count(old)==1,(name,old[:60],s.count(old));write(name,s.replace(old,new))
# Existing keys only: no deleted financial warning, no changes to refresh cadence.
keys=['connection.lost','deposit.noneConfigured','settings.deposits.incomingLoadError','settings.reservesEmpty','futures.collateralIncomplete']
values={
 'ru':['Связь временно прервана. Восстанавливаем соединение…','Пополнение временно недоступно. Обратитесь в поддержку.','Не удалось загрузить поступления. Попробуйте позже.','Информация о резервах временно недоступна.','В сумму пока не включены активы: {assets}. Их оценка временно недоступна.'],
 'en':['Connection interrupted. Reconnecting…','Deposits are temporarily unavailable. Please contact support.','Unable to load incoming deposits. Please try again later.','Reserve information is temporarily unavailable.','These assets are not included in the total: {assets}. Their valuation is temporarily unavailable.'],
 'es':['Conexión interrumpida. Reconectando…','Los depósitos no están disponibles temporalmente. Contacta con soporte.','No se pudieron cargar los depósitos recibidos. Inténtalo más tarde.','La información de reservas no está disponible temporalmente.','Estos activos no están incluidos en el total: {assets}. Su valoración no está disponible temporalmente.'],
 'zh':['连接暂时中断，正在重新连接…','充值暂不可用，请联系客服。','无法加载到账记录，请稍后重试。','储备信息暂不可用。','总额暂未包含以下资产：{assets}。这些资产的估值暂不可用。'],
 'ja':['接続が一時的に切断されました。再接続しています…','現在、入金をご利用いただけません。サポートにお問い合わせください。','入金履歴を読み込めませんでした。しばらくしてから再度お試しください。','準備資産の情報は現在表示できません。','合計には次の資産が含まれていません：{assets}。現在、評価額を取得できません。'],
 'ko':['연결이 일시적으로 끊겼습니다. 다시 연결하는 중…','현재 입금을 이용할 수 없습니다. 고객지원에 문의해 주세요.','입금 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.','준비금 정보를 일시적으로 확인할 수 없습니다.','합계에 포함되지 않은 자산: {assets}. 현재 해당 자산의 평가액을 확인할 수 없습니다.'],
 'hi':['कनेक्शन अस्थायी रूप से टूट गया है। दोबारा जुड़ रहे हैं…','जमा सेवा अभी उपलब्ध नहीं है। कृपया सहायता से संपर्क करें।','प्राप्त जमा लोड नहीं हो सके। कृपया बाद में प्रयास करें।','रिज़र्व की जानकारी अभी उपलब्ध नहीं है।','इन संपत्तियों को कुल में शामिल नहीं किया गया है: {assets}। उनका मूल्यांकन अभी उपलब्ध नहीं है।']}
for lang,phrases in values.items():
 name=f'frontend/src/lib/i18n/locales/{lang}.ts';s=(root/name).read_text()
 for key,text in zip(keys,phrases):
  pattern=r"(?m)^  '"+re.escape(key)+r"': .*,$"
  s,n=re.subn(pattern,lambda _m:"  '"+key+"': "+json.dumps(text,ensure_ascii=False)+',',s)
  assert n==1,(lang,key,n)
 write(name,s)
helper=r'''/** UI-only wording boundary. Machine-readable bodies/codes stay unchanged.
 * No polling, state transition, success/failure conversion or money calculation. */
type Language = 'ru' | 'en' | 'es' | 'zh' | 'ja' | 'ko' | 'hi';
const WORDS: Record<Language, readonly [string,string,string,string,string,string]> = {
  ru: ['Нет подтверждения от сервиса. Проверьте статус операции перед повтором.', 'Войдите в аккаунт, чтобы продолжить.', 'Это действие недоступно для вашего аккаунта.', 'Слишком много запросов. Подождите немного.', 'Проверьте введённые данные.', 'Недостаточно средств для этой операции.'],
  en: ['No confirmation was received. Check the operation status before trying again.', 'Sign in to continue.', 'This action is unavailable for your account.', 'Too many requests. Please wait a moment.', 'Check the information you entered.', 'Insufficient funds for this operation.'],
  es: ['No se recibió confirmación. Comprueba el estado de la operación antes de reintentarlo.', 'Inicia sesión para continuar.', 'Esta acción no está disponible para tu cuenta.', 'Demasiadas solicitudes. Espera un momento.', 'Revisa los datos introducidos.', 'Fondos insuficientes para esta operación.'],
  zh: ['尚未收到确认。请先查看操作状态，再决定是否重试。','请登录后继续。','此操作对您的账户不可用。','请求过多，请稍候。','请检查输入的信息。','资金不足，无法执行此操作。'],
  ja: ['確認を取得できませんでした。再試行する前に操作状況をご確認ください。','続行するにはログインしてください。','この操作はお客様のアカウントでは利用できません。','リクエストが多すぎます。少しお待ちください。','入力内容をご確認ください。','この操作に必要な残高が不足しています。'],
  ko: ['확인을 받지 못했습니다. 다시 시도하기 전에 처리 상태를 확인해 주세요.','계속하려면 로그인해 주세요.','이 작업은 해당 계정에서 이용할 수 없습니다.','요청이 너무 많습니다. 잠시 기다려 주세요.','입력한 정보를 확인해 주세요.','이 작업을 수행할 잔액이 부족합니다.'],
  hi: ['पुष्टि नहीं मिली। दोबारा प्रयास करने से पहले संचालन की स्थिति जाँचें।','जारी रखने के लिए लॉग इन करें।','यह कार्य आपके खाते के लिए उपलब्ध नहीं है।','बहुत अधिक अनुरोध हैं। कृपया थोड़ा प्रतीक्षा करें।','दर्ज की गई जानकारी जाँचें।','इस कार्य के लिए पर्याप्त धन नहीं है।'],
};
function currentLanguage(): Language {
  try { const v=localStorage.getItem('exchange_lang'); if(v && Object.hasOwn(WORDS,v)) return v as Language; } catch { /* storage can be blocked */ }
  return 'ru';
}
const TECHNICAL = /(?:\b(?:WebSocket|XMLHttpRequest|Prisma\w*|TypeError|ReferenceError|SyntaxError|ECONN\w*|ETIMEDOUT|ENOTFOUND)\b|Request failed\s*\(|Failed to fetch|fetch failed|NetworkError|network request failed|Load failed|Unexpected (?:token|end)|JSON (?:parse|at position)|\[object Object\]|<!doctype|<html|<script|postgres(?:ql)?:\/\/|https?:\/\/|\b(?:DATABASE_URL|DIRECT_URL|VITE_\w+|\w+_TREASURY_ADDRESS)\b|\b(?:backend|deployment|деплоймент|деплой|endpoint)\b|API (?:is )?not configured|Expected .+, received|invalid_type|^\s*[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\s*$|^\s*[a-z]+(?:_[a-z]+)+\s*$|\bat \S+\.(?:js|ts):\d)/i;
/** Keep actionable human explanations; never display raw implementation errors.
 * API settings/docs and administrator diagnostics are not filtered by this function. */
export function publicErrorMessage(error: unknown, status?: number, language?: Language): string {
  const words=WORDS[language ?? currentLanguage()];
  const message=typeof error==='string' ? error : error instanceof Error ? error.message : '';
  if (/^(?:INSUFFICIENT_(?:BALANCE|FUNDS|MARGIN|DEMO_MARGIN|FILL_MARGIN))$/i.test(message)) return words[5];
  if (message.trim() && message.length<=400 && !TECHNICAL.test(message)) return message;
  if(status===401) return words[1];
  if(status===403) return words[2];
  if(status===429) return words[3];
  if(status===400 || status===422) return words[4];
  return words[0];
}
'''
write('frontend/src/lib/publicErrorMessage.ts',helper)
p='frontend/src/lib/api.ts'
edit(p,"import type { SyntheticCopyTradingResponse } from './syntheticCopyTrading';","import type { SyntheticCopyTradingResponse } from './syntheticCopyTrading';\nimport { publicErrorMessage } from './publicErrorMessage';")
edit(p,'    super(message);','    super(publicErrorMessage(message, status));')
p='frontend/src/lib/privateTradingError.ts'
s=(root/p).read_text();write(p,"import { publicErrorMessage } from './publicErrorMessage';\n"+s.replace('    super(message);','    super(publicErrorMessage(message, status));'))
p='frontend/src/lib/toast.tsx'
s=(root/p).read_text();s="import { publicErrorMessage } from './publicErrorMessage';\n"+s
s=s.replace('      const id = nextId++;','      if (type === \'error\') message = publicErrorMessage(message);\n      const id = nextId++;');write(p,s)
# Existing localization for the homepage; age, source and stale semantics remain visible.
p='frontend/src/pages/home/SapphireTerminal.tsx'
s=(root/p).read_text();s="import { useLanguage } from '../../lib/i18n';\nimport { homeLiveCopy } from './homeLiveCopy';\n"+s
s=s.replace('export function SapphireTerminal({market}:{market:HomeMarket}){','export function SapphireTerminal({market}:{market:HomeMarket}){\n  const {lang}=useLanguage(); const copy=homeLiveCopy[lang];')
s=s.replace("stale?'Stale':'6h snapshot'","stale?copy.waiting:copy.refresh")
s=s.replace("stale?'Stale market data':'Public market snapshot'","stale?copy.waiting:copy.feed")
write(p,s)
# Keep metadata/unknown financial warnings; only remove operational jargon from wording.
tests=r'''import { publicErrorMessage } from '../publicErrorMessage';
import { PrivateTradingError } from '../privateTradingError';
import { RU } from '../i18n/locales/ru';
import { EN } from '../i18n/locales/en';
import { ES } from '../i18n/locales/es';
import { ZH } from '../i18n/locales/zh';
import { JA } from '../i18n/locales/ja';
import { KO } from '../i18n/locales/ko';
import { HI } from '../i18n/locales/hi';

test.each(['Request failed (500)','TypeError: Failed to fetch','PrismaClientKnownRequestError: DATABASE_URL missing','<html>502 gateway</html>','ECONNREFUSED','temporarily_unavailable','INVALID_ORDER_SIZE','[object Object]'])('does not put technical error on screen: %s', input => {
  const text=publicErrorMessage(input,500,'ru');
  expect(text).not.toBe(input);
  expect(text).toContain('статус операции');
  expect(text).not.toMatch(/успеш|отклонена|выполнена/);
});
test('does not erase an actionable margin or liquidity explanation',()=>{
  for(const text of ['Недостаточно средств для размещения этого ордера.','Позиция закрыта частично. Проверьте оставшийся объём.','Для изменения плеча отмените открытые ордера.']) expect(publicErrorMessage(text,409,'ru')).toBe(text);
  expect(publicErrorMessage('INSUFFICIENT_BALANCE',409,'ru')).toContain('Недостаточно средств');
});
test('machine-readable private-trading status/code/limits are kept for the existing precise localizer',()=>{
  const detail={limit:'maxMarketOrderQty',allowed:'120',actual:'121'};
  const error=new PrivateTradingError('INVALID_ORDER_SIZE',400,'INVALID_ORDER_SIZE',detail);
  expect(error.status).toBe(400);expect(error.code).toBe('INVALID_ORDER_SIZE');expect(error.detail).toBe(detail);
  expect(error.message).not.toBe('INVALID_ORDER_SIZE');
});
test.each(['ru','en','es','zh','ja','ko','hi'] as const)('generic fallback is localized: %s',language=>{
  expect(publicErrorMessage('ECONNREFUSED',503,language)).not.toMatch(/ECONN|503/);
  expect(publicErrorMessage('Request failed (401)',401,language)).not.toBe(publicErrorMessage('Request failed (503)',503,language));
});
test.each([RU,EN,ES,ZH,JA,KO,HI])('customer captions contain no operator configuration and preserve incomplete valuation',dictionary=>{
  for(const key of ['connection.lost','deposit.noneConfigured','settings.deposits.incomingLoadError','settings.reservesEmpty','futures.collateralIncomplete'] as const){
    expect(dictionary[key]).not.toMatch(/WebSocket|_TREASURY_ADDRESS|деплоймент|deployment|настроен API|нижняя граница/i);
  }
  expect(dictionary['futures.collateralIncomplete']).toContain('{assets}');
  expect(dictionary['settings.tab.api']).toBeTruthy();
});
'''
write('frontend/src/lib/__tests__/clientMessages.test.ts',tests)
report='''# Customer-facing technical wording audit — 19 September 2026

Scope: 323 frontend TypeScript/TSX files, excluding tests. String/JSX/template literals and dynamic error sinks were inspected. A keyword hit is not automatically a user-visible issue.

Confirmed and corrected: WebSocket disconnect copy; treasury environment-variable instructions shown in Deposit; API configuration instructions in incoming deposits; deployment wording in reserves; lower-bound terminology in Wallet valuation; homepage snapshot terminology; raw server error strings in ApiError, PrivateTradingError and error toasts.

The incomplete-valuation notice remains and names omitted assets. Authentication, insufficient funds, partial fills, unavailable data and retry safety remain. No financial figures, schedules, source cadence, checks or account state were modified. API-key documentation, administrator tools and modeled/reported-performance disclosures intentionally remain.

Not an exhaustive production account audit: protected screens and every modal/error branch need an authorized production session. Dynamic messages from separate HTTP clients and direct network failures may require additional call-site review. Copy Trading is reviewed in PR #141, not changed here. Public-production and local-failure browser sweeps are separate evidence, never treated as interchangeable.
'''
write('docs/qa/client-messages/README.md',report)
write('docs/qa/client-messages/changed-files.json',json.dumps(sorted(set(changed)),indent=2))
print('\n'.join(sorted(set(changed))))
