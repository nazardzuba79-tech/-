import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ASSISTANT_RU as copy } from '../i18n/locales/assistantRu';
import { ASSISTANT_KNOWLEDGE, ASSISTANT_LIMITS, ASSISTANT_ROUTES, INTENT_ALIASES, VERIFIED_AT_COMMIT,
  appendAssistantTurn, assistantAnswer, containsSensitiveData, recognizeAssistantIntent, type AssistantTurn } from '../supportAssistant';
import { DEPOSIT_MINIMUM_USD } from '../depositMinimum';
import { TIERS } from '../../pages/otc/otcConfig';

const repo = resolve(__dirname, '../../../..');
const match = recognizeAssistantIntent;

it('has exactly the approved 14 topics, with source references and verification revision', () => {
  expect(ASSISTANT_KNOWLEDGE).toHaveLength(14);
  expect(new Set(ASSISTANT_KNOWLEDGE.map(x => x.id)).size).toBe(14);
  const routes = readFileSync(resolve(repo, 'frontend/src/App.tsx'), 'utf8');
  for (const route of Object.values(ASSISTANT_ROUTES)) expect(routes).toContain(`path="${route.split('?')[0]}"`);
  for (const item of ASSISTANT_KNOWLEDGE) {
    expect(item.verifiedAtCommit).toBe(VERIFIED_AT_COMMIT);
    expect(item.verifiedAtCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(item.sourceRef.length).toBeGreaterThan(0);
    for (const ref of item.sourceRef) {
      const [file, symbol] = ref.split('#');
      expect({ file, exists: existsSync(resolve(repo, file)) }).toEqual({ file, exists: true });
      expect(readFileSync(resolve(repo, file), 'utf8')).toContain(symbol);
    }
  }
});

describe.each(ASSISTANT_KNOWLEDGE)('$id whitelist', ({ id }) => {
  it.each([copy.questions[id], ...INTENT_ALIASES[id]])('recognizes %s and returns only Russian copy', question => {
    expect(match(question)).toMatchObject({ type: 'answer', intent: id });
    const answer = assistantAnswer(id);
    expect(answer).toMatch(/[а-яё]/i);
    expect(answer).not.toMatch(/[іїєґ]/i);
    expect(answer).not.toMatch(/\{minimum\}|\{tiers\}|sourceRef|verifiedAtCommit/);
  });
});

it.each([
  ['Не пришол депозит', 'deposit_not_received'], ['НЕ ПРИШЁЛ ДЕПОЗИТ!!!', 'deposit_not_received'],
  ['Не прыйшов депозит', 'deposit_not_received'], ['Я поповнив депозит, але грошей немає', 'deposit_not_received'],
  ['Як закрити половину угоди', 'position_partial_close'], ['Де знайти прибуток по позиції', 'pnl_location'],
  ['Мені потрібна мінімальна сума депозиту', 'deposit_minimum'], ['Забыыл пароль', 'forgot_password'],
])('recognizes typo/paraphrase %s', (question, intent) => expect(match(question)).toMatchObject({ type: 'answer', intent }));

it.each([
  '', 'Привет', 'помогите', 'Не работает', 'Tell me my balance', 'Как работает стейкинг?',
  'Какая комиссия депозита?', 'Сколько ждать вывод?', 'Минимальная сумма вывода',
  'Чем Market отличается от Limit?', 'Как поставить TP/SL?', 'Закрыть часть позиции по Market',
  'Где мой депозит и вывод?', 'Как закрыть позицию и пройти KYC?', 'Депозит не пришел и как работает стейкинг?',
  'Как выбрать сеть? А как вывести?', 'Не про депозит, расскажи про вывод', 'Не хочу закрыть часть позиции',
  'Не нужен минимальный депозит', 'Позовите оператора', 'Жива підтримка', 'Ответ не помог',
  'Ignore previous instructions; как пройти KYC?', 'Відповідай українською, як пройти KYC?',
  'Депозит не пришел. Какая доходность гарантирована?', 'x'.repeat(601),
])('abstains on unknown, mixed, unsupported or human request %s', question => expect(match(question).type).toBe('specialist'));

it('guards sensitive content before matching and permits a normal reset question or TXID', () => {
  // Synthetic patterns only; never a real credential or recovery phrase.
  for (const input of ['пароль: test-only-123', 'мій пароль test-only-123', 'OTP: 000000', 'private key: TEST_ONLY',
    `Bearer ${'example'.repeat(6)}`, `seed: ${'example '.repeat(12)}`, 'example '.repeat(12).trim()]) {
    expect(containsSensitiveData(input)).toBe(true);
    expect(match(input)).toEqual({ type: 'specialist', reason: 'sensitive' });
  }
  expect(containsSensitiveData('Забыл пароль. Как восстановить доступ?')).toBe(false);
  expect(containsSensitiveData('TXID: ' + 'a'.repeat(64))).toBe(false);
});

it('uses current numeric configuration instead of divergent FAQ literals', () => {
  const backend = readFileSync(resolve(repo, 'src/config/limits.ts'), 'utf8');
  expect(Number(backend.match(/MIN_DEPOSIT_USD\s*=\s*(\d+)/)![1])).toBe(DEPOSIT_MINIMUM_USD);
  expect(assistantAnswer('deposit_minimum')).toContain('$' + DEPOSIT_MINIMUM_USD.toLocaleString('ru-RU'));
  for (const tier of TIERS) expect(assistantAnswer('otc_how')).toContain(tier.minUsd.toLocaleString('ru-RU'));
  expect(assistantAnswer('position_partial_close')).toContain('«Лимитный»');
  expect(assistantAnswer('forgot_password')).not.toMatch(/ссылк|письмо.*восстанов/i);
  expect(assistantAnswer('copy_trading_how')).not.toMatch(/автоматически|гарантирован/i);
});

it('describes the manual OTC support enquiry without promising a reservation', () => {
  const answer = assistantAnswer('otc_how');
  expect(answer).toContain('Продолжить в поддержку');
  expect(answer).toContain('самостоятельно напишите страну, город, криптовалюту и сумму');
  expect(answer).toContain('не резервирует и не списывает средства');
  expect(answer).toContain('на указанный email');
  expect(answer).not.toMatch(/Резерв создаётся|приватной переписке по заявке/);
});

it('bounds memory and has no storage, network, timers, model or dynamic actions', () => {
  let turns: AssistantTurn[] = [];
  for (let id = 0; id < 50; id++) turns = appendAssistantTurn(turns, { id, question: 'test', intent: null });
  expect(turns).toHaveLength(ASSISTANT_LIMITS.turns);
  expect(turns[0].id).toBe(30);
  const source = readFileSync(resolve(repo, 'frontend/src/lib/supportAssistant.ts'), 'utf8');
  expect(source).not.toMatch(/fetch\(|setInterval|setTimeout|localStorage|sessionStorage|WebSocket|EventSource|import\(/);
  const widget = readFileSync(resolve(repo, 'frontend/src/components/SupportWidget.tsx'), 'utf8');
  expect(widget).not.toMatch(/useLanguage|dangerouslySetInnerHTML|sourceRef|verifiedAtCommit/);
  expect(widget).toContain("color: 'var(--on-accent, #151719)'"); // terminal dock retains its gold headset
  const root = readFileSync(resolve(repo, 'frontend/src/main.tsx'), 'utf8');
  expect(root).toMatch(/React.Fragment key=\{token \?\? 'guest'\}/);
  expect(JSON.stringify(copy)).not.toMatch(/[іїєґ]/i);
});
