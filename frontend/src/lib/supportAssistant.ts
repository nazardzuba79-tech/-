import { DEPOSIT_MINIMUM_USD } from './depositMinimum';
import { TIERS } from '../pages/otc/otcConfig';
import { ASSISTANT_RU as copy } from './i18n/locales/assistantRu';

export type AssistantIntent = keyof typeof copy.questions;
export type AssistantAction = keyof typeof copy.actions;
type Group = keyof typeof copy.groups;
export const ASSISTANT_LIMITS = { question: 600, turns: 20 } as const;
export const VERIFIED_AT_COMMIT = '1b045ab34c09e2b95931dd46c5f3a1c5f54ad1c4';

/** Fixed navigation registry. Messages can never supply an executable action or URL. */
export const ASSISTANT_ROUTES = {
  wallet: '/wallet', futures: '/futures', copy: '/copy-trading', otc: '/otc',
  verification: '/settings?tab=verification', login: '/login',
} as const;

type Entry = { id: AssistantIntent; group: Group; actions: readonly AssistantAction[]; sourceRef: readonly string[]; verifiedAtCommit: string };
function entry(id: AssistantIntent, group: Group, actions: AssistantAction[], ...sourceRef: string[]): Entry {
  return { id, group, actions, sourceRef, verifiedAtCommit: VERIFIED_AT_COMMIT };
}
export const ASSISTANT_KNOWLEDGE: readonly Entry[] = [
  entry('deposit_not_received', 'deposits', ['wallet', 'specialist'], 'frontend/src/components/DepositModal.tsx#DepositModal', 'src/services/deposits/DepositBatchService.ts#credit', 'src/services/deposits/depositPolicy.ts#isPackageEligible'),
  entry('deposit_minimum', 'deposits', ['deposit'], 'frontend/src/lib/depositMinimum.ts#DEPOSIT_MINIMUM_USD', 'src/config/limits.ts#MIN_DEPOSIT_USD', 'src/services/deposits/DepositQueueService.ts#DepositQueueService', 'src/services/deposits/depositPolicy.ts#isPackageEligible'),
  entry('deposit_wait_time', 'deposits', ['specialist'], 'src/services/deposits/DepositBatchService.ts#DepositBatchService', 'src/services/deposits/depositPolicy.ts#isPackageEligible'),
  entry('deposit_choose_network', 'deposits', ['deposit', 'specialist'], 'frontend/src/components/DepositModal.tsx#DepositModal', 'frontend/src/lib/useDepositOptions.ts#useDepositSelection'),
  entry('deposit_wrong_network', 'deposits', ['specialist'], 'src/services/deposits/DepositBatchService.ts#DepositBatchService', 'frontend/src/lib/supportForm.ts#sendSupportRequest'),
  entry('deposit_address', 'deposits', ['deposit'], 'frontend/src/components/DepositModal.tsx#DepositModal', 'frontend/src/components/DepositCatalogueDialog.tsx#DepositCatalogueDialog'),
  entry('withdrawal_not_received', 'withdrawal', ['wallet', 'specialist'], 'frontend/src/components/WithdrawModal.tsx#WithdrawModal', 'src/services/WithdrawalService.ts#WithdrawalService'),
  entry('position_partial_close', 'trading', ['futures', 'specialist'], 'frontend/src/components/FuturesPositionsPanel.tsx#FuturesPositionsPanel', 'frontend/src/components/FuturesLimitCloseDialog.tsx#FuturesLimitCloseDialog'),
  entry('pnl_location', 'trading', ['futures'], 'frontend/src/components/FuturesPositionsPanel.tsx#FuturesPositionsPanel'),
  entry('copy_trading_how', 'trading', ['copy', 'specialist'], 'frontend/src/pages/copy-trading-bolt/components.tsx#CopyButton', 'frontend/src/pages/copy-trading-bolt/useCopyLists.ts#useFollowing', 'src/api/routes/copyPerformance.ts#copyPerformanceRouter'),
  entry('otc_how', 'deposits', ['otc', 'specialist'], 'frontend/src/pages/otc/otcConfig.ts#TIERS', 'frontend/src/pages/OtcPage.tsx#OtcPage', 'frontend/src/lib/supportForm.ts#sendSupportRequest'),
  entry('kyc_how', 'account', ['verification'], 'frontend/src/pages/SettingsPage.tsx#TABS', 'frontend/src/pages/settings-arctic/VerificationSection.tsx#VerificationSection'),
  entry('login_problem', 'account', ['login', 'specialist'], 'frontend/src/pages/AuthPage.tsx#AuthPage', 'frontend/src/lib/supportWidget.ts#openSupportWidget'),
  entry('forgot_password', 'account', ['specialist'], 'frontend/src/pages/AuthPage.tsx#AuthPage', 'frontend/src/lib/supportWidget.ts#openSupportWidget'),
];
export const INITIAL_INTENTS: readonly AssistantIntent[] = ['deposit_not_received', 'deposit_minimum', 'withdrawal_not_received', 'kyc_how'];
export function assistantAnswer(id: AssistantIntent): string {
  return copy.answers[id]
    .replace('{minimum}', DEPOSIT_MINIMUM_USD.toLocaleString('ru-RU'))
    .replace('{tiers}', TIERS.map(tier => `${tier.name} — от $${tier.minUsd.toLocaleString('ru-RU')}`).join(', '));
}

/** No retained value, logging or network. A conservative guard, not a universal secret detector.
 * A bare transaction hash is permitted; labelled private keys are not. */
export function containsSensitiveData(value: string): boolean {
  return /(?:парол[ьяь]|password|seed(?:[ -]?phrase)?|сид[ -]?фраз[аыу]|приватн\S*\s+ключ|private[ -]?key|api[ _-]?key|session[ _-]?token|jwt|одноразов\S*\s+код|otp)\s*[:=]\s*\S+/iu.test(value)
    || /(?:мой|мій|my)\s+(?:пароль|password|код|otp)\s+\S+/iu.test(value)
    || /(?:пароль|password)\s+\S*[\d@#$%]\S{3,}/iu.test(value)
    || /(?:\bBearer\s+\S+|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+|\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{20,}|AKIA[\w]{16}))/u.test(value)
    || ([12, 15, 18, 21, 24].includes(value.trim().split(/\s+/).length) && /^[a-z]{2,14}(?:\s+[a-z]{2,14})+$/u.test(value.trim()));
}

export function normalizeQuestion(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/** Input-only aliases. No Ukrainian response dictionary exists. */
export const INTENT_ALIASES: Record<AssistantIntent, readonly string[]> = {
  deposit_not_received: ['Не пришел депозит', 'Не зачислили пополнение', 'USDT не пришли на баланс', 'USDT не зачислились', 'Не прийшов депозит', 'Поповнив, а грошей немає'],
  deposit_minimum: ['Минимальная сумма', 'Минимальный депозит', 'С какой суммы можно пополнить', 'Яка мінімальна сума депозиту?'],
  deposit_wait_time: ['Когда зачислят пополнение', 'Долго идет депозит', 'Скільки чекати депозит?'],
  deposit_choose_network: ['Как выбрать сеть депозита', 'В какой сети отправлять', 'Яку мережу вибрати?'],
  deposit_wrong_network: ['Перепутал сеть', 'Отправил по другой сети', 'Відправив не тією мережею'],
  deposit_address: ['Где адрес депозита', 'Куда отправлять монеты', 'Де знайти адресу депозиту?'],
  withdrawal_not_received: ['Не пришел вывод', 'Вывел деньги, они не пришли', 'Где мой вывод', 'Не прийшов вивід'],
  position_partial_close: ['Частично зафиксировать позицию', 'Закрыть половину сделки', 'Як закрити частину позиції?'],
  pnl_location: ['Где прибыль по позиции', 'Где посмотреть результат сделки', 'Де подивитися P&L?'],
  copy_trading_how: ['Как работает копитрейдинг', 'Как выбрать трейдера', 'Як працює Copy Trading?'],
  otc_how: ['Как обменять через OTC', 'Крупное пополнение', 'Як поповнити через OTC?'],
  kyc_how: ['Пройти верификацию', 'Как пройти верификацию', 'Где подтвердить личность', 'Як пройти KYC?'],
  login_problem: ['Не получается авторизоваться', 'Ошибка входа', 'Не можу увійти'],
  forgot_password: ['Не помню пароль', 'Восстановление доступа', 'Забув пароль'],
};

type Match = { type: 'answer'; intent: AssistantIntent; confidence: number } |
  { type: 'specialist'; reason: 'human' | 'unsupported' | 'ambiguous' | 'unknown' | 'sensitive' };
const words = (text: string, re: RegExp) => text.split(' ').some(w => re.test(w));
const forms = ASSISTANT_KNOWLEDGE.flatMap(({ id }) => [copy.questions[id], ...INTENT_ALIASES[id]].map(q => ({ id, text: normalizeQuestion(q) })));

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** Abstain before matching on human requests, unsupported subjects and competing operations.
 * Exact aliases score 1; unique two-part semantic matches score .95. Typo rescue
 * needs >=.91 similarity, <=2 edits and a .05 lead over a different intent. */
export function recognizeAssistantIntent(input: string): Match {
  if (containsSensitiveData(input)) return { type: 'specialist', reason: 'sensitive' };
  if (input.length > ASSISTANT_LIMITS.question) return { type: 'specialist', reason: 'unknown' };
  const q = normalizeQuestion(input);
  if (!q) return { type: 'specialist', reason: 'unknown' };
  if (/оператор|специалист|спеціаліст|живая поддержка|жива підтримка|живий оператор|не помог|не допом|неверн\S* ответ|ответ неверн|неправильн|скарг|жалоб|обман|украли|заблокир/.test(q)) return { type: 'specialist', reason: 'human' };
  if (/комисси|комісі|реферал|доходност|прибыльност|прибутков|гарант|market|\b(?:tp|sl)\b|тейк профит|стоп лосс|маркет|игнориру|ігноруй|ignore|измени|зміни|инструкци|інструкці|отвечай|відповідай/.test(q)) return { type: 'specialist', reason: 'unsupported' };
  const deposit = /депозит|пополн|поповн|зачисл|зарах/.test(q);
  const withdrawal = /вывод|вывел|вывест|вивід|вивод|вивів|вивести/.test(q);
  const position = /позиц|сделк|угод/.test(q);
  const copyTrading = /копитрейд|копі[ют]рейд|copy trading|трейдер/.test(q);
  const otc = words(q, /^(otc|отс)$/);
  const kyc = /\bkyc\b|верификац|верифікац|личност|особу/.test(q);
  const account = /парол|войти|вход|увійти|авториз|доступ/.test(q);
  const pnl = /\bp l\b|\bpnl\b|прибыл|прибут|результат|убыт|збит/.test(q);
  if ((deposit && withdrawal) || [deposit && !otc, withdrawal, position || pnl, copyTrading, otc, kyc, account && !kyc].filter(Boolean).length > 1
    || /не (?:депозит|пополнение|поповнення|вывод|вивід)/.test(q)) return { type: 'specialist', reason: 'ambiguous' };
  if ((withdrawal && /сколько|скільки|когда|коли|срок|термін|миним|мінім/.test(q))
    || (!position && /лимит|ліміт|рыночн|ринков/.test(q))) return { type: 'specialist', reason: 'unsupported' };
  const exact = forms.find(f => f.text === q);
  if (exact) return { type: 'answer', intent: exact.id, confidence: 1 };
  // Do not answer just the recognized half of a mixed or negated request.
  if (/(?:^| )(?:и|а|та|і|але|но) (?:как|як|что|що|какой|який|где|де|почему|чому)|не (?:нуж|потріб|хочу|интерес|цікав)|не про |не о /u.test(q)
    || /\?\s*\S/.test(input)) return { type: 'specialist', reason: 'ambiguous' };
  const how = /как|як|где|куда|(?:^| )де(?: |$)|пройти|выбрать|вибрати|использ|польз|працю|работает/.test(q);
  const received = /не приш|не прийш|не зачисл|не зарах|нет на баланс|немає|не дош|не дійш/.test(q);
  const network = /сет[ьи]|сеть|мереж/.test(q);
  const candidates: AssistantIntent[] = [];
  const match = (id: AssistantIntent, yes: boolean) => { if (yes) candidates.push(id); };
  match('deposit_not_received', deposit && received);
  match('deposit_minimum', deposit && /миним|мінім|с какой суммы|з якої суми/.test(q));
  match('deposit_wait_time', deposit && /сколько ждать|скільки чекати|когда зачисл|коли зарах|долго идет|довго йде|срок зачисл/.test(q));
  const wrongNetwork = network && /не (?:в )?то[йіе]|другой|інш[ійу]|перепут|переплутав|ошиб|помил/.test(q);
  match('deposit_wrong_network', wrongNetwork && (deposit || /отправ|відправ|перепут|переплутав/.test(q)));
  match('deposit_choose_network', network && !wrongNetwork && /выбра|выбир|вибра|обра|какую|яку/.test(q));
  match('deposit_address', deposit && /адрес|адресу|qr/.test(q) && how);
  match('withdrawal_not_received', withdrawal && (received || /где мой|де мій/.test(q)));
  match('position_partial_close', position && /закры|закр|фиксир|фікс/.test(q) && /част|половин|процент|відсот|50|25|75/.test(q));
  match('pnl_location', pnl && /где|(?:^| )де(?: |$)|посмотр|подив|найти|знайти/.test(q));
  match('copy_trading_how', copyTrading && how);
  match('otc_how', otc && how);
  match('kyc_how', kyc && how);
  const forgotten = account && /забыл|забы|забув|не помню|не пам|восстанов|віднов/.test(q);
  match('forgot_password', forgotten);
  match('login_problem', account && !forgotten && /не могу|не мож|не получ|ошиб|помил|не уда/.test(q));
  if (candidates.length > 1) return { type: 'specialist', reason: 'ambiguous' };
  if (candidates.length === 1) return { type: 'answer', intent: candidates[0], confidence: .95 };
  const scores = forms.filter(f => Math.abs(f.text.length - q.length) <= 2).map(f => ({ ...f, edits: distance(q, f.text) }))
    .map(f => ({ ...f, score: 1 - f.edits / Math.max(q.length, f.text.length) })).sort((a, b) => b.score - a.score);
  const best = scores[0];
  const runner = scores.find(f => f.id !== best?.id);
  if (best && best.edits <= 2 && best.score >= .91 && (!runner || best.score - runner.score >= .05)) return { type: 'answer', intent: best.id, confidence: best.score };
  return { type: 'specialist', reason: 'unknown' };
}

export type AssistantTurn = { id: number; question: string; intent: AssistantIntent | null };
export function appendAssistantTurn(turns: readonly AssistantTurn[], turn: AssistantTurn): AssistantTurn[] {
  return [...turns, turn].slice(-ASSISTANT_LIMITS.turns);
}
