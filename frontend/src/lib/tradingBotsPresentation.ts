/** Presentation catalogue only. These are synthetic scenarios, not account
 * performance, backtests, forecasts or an execution engine. Never feed these
 * values into balances, financial calculations or trading endpoints. */
export type BotCategory = 'grid' | 'dca' | 'trend' | 'portfolio';
export type BotCreator = { displayName: string | null; avatarUrl: string | null };
export type BotDefinition = {
  id: string; name: string; mark: string; symbol: string; category: BotCategory;
  creatorName?: string;
  strategy: string; description: string; detail: string; minimum: number;
  risk: 'Умеренный' | 'Высокий'; baseRoi: number;
};

export const BOT_CATALOGUE: readonly BotDefinition[] = [
  { id: 'atlas', name: 'Atlas Grid', mark: 'AG', symbol: 'BTC / USDT', category: 'grid', strategy: 'Спотовая сетка', minimum: 2500, risk: 'Умеренный', baseRoi: 154,
    description: 'Модель работы с ценовыми зонами BTC: распределение лимитных уровней в боковом диапазоне.',
    detail: 'Сценарий из 24 ценовых уровней исследует возвраты к середине диапазона. При сильном направленном движении сеточный подход уязвим: выход из диапазона важнее красивой кривой.' },
  { id: 'ether', name: 'Ether DCA', mark: 'ED', symbol: 'ETH / USDT', category: 'dca', strategy: 'Регулярные покупки', minimum: 5000, risk: 'Умеренный', baseRoi: 120,
    description: 'Поэтапное накопление ETH с дисциплиной бюджета вместо попыток угадать идеальную точку входа.',
    detail: 'DCA-сценарий разделяет бюджет на серии покупок и отслеживает среднюю цену входа. Снижение рынка может продолжаться после каждого шага накопления.' },
  { id: 'sol', name: 'SOL Momentum', mark: 'SM', symbol: 'SOL / USDT', category: 'trend', strategy: 'Следование тренду', minimum: 7500, risk: 'Высокий', baseRoi: 217,
    description: 'Исследует ускорения SOL: направленный импульс, активность рынка и точки ослабления тренда.',
    detail: 'Трендовый сценарий сопоставляет направление, динамику объёма и волатильность. Сигнал выхода описывается трейлинг-ограничением; резкий разворот остаётся ключевым риском.' },
  { id: 'delta', name: 'Delta Balance', mark: 'DB', symbol: 'BTC + ETH', category: 'portfolio', strategy: 'Баланс позиций', minimum: 10000, risk: 'Высокий', baseRoi: 134,
    description: 'Исследует связку BTC и ETH через направленную экспозицию и компенсирующие позиции.',
    detail: 'Парная конфигурация оценивает согласованность движений BTC и ETH. Даже компенсирующая позиция не исключает проскальзывание, издержки и риск расхождения активов.' },
  { id: 'range', name: 'Thomas Quant AI', mark: 'TQ', symbol: 'XRP / USDT', category: 'trend', strategy: 'Количественный импульс', creatorName: 'Thomas', minimum: 12500, risk: 'Умеренный', baseRoi: 180.26,
    description: 'Оценивает силу импульса XRP относительно волатильности рынка и глубины откатов.',
    detail: 'Thomas рассматривает движение XRP в контексте рыночной структуры. Устойчивость импульса оценивается по глубине откатов и восстановлению цены. Сравнить периоды помогают доходность и максимальная просадка.' },
  { id: 'balance', name: 'Smart Rebalance', mark: 'SR', symbol: 'BTC · ETH · SOL · BNB · XRP', category: 'portfolio', strategy: 'Ребалансировка', minimum: 15000, risk: 'Умеренный', baseRoi: 166,
    description: 'Модель портфеля из пяти активов с контролем целевых весов и концентрации риска.',
    detail: 'Портфельный сценарий сравнивает текущие и целевые доли BTC, ETH, SOL, BNB и XRP. Отклонение более пяти процентных пунктов рассматривается как сигнал для ребалансировки.' },
  { id: 'breakout', name: 'Breakout Pro', mark: 'BP', symbol: 'BNB / USDT', category: 'trend', strategy: 'Пробой уровней', minimum: 25000, risk: 'Высокий', baseRoi: 201,
    description: 'Сценарий пробоя BNB: выход из консолидации, подтверждение объёмом и контроль ложных движений.',
    detail: 'Вместо непрерывного входа стратегия исследует редкие импульсы после пробоя. Ложные сигналы и резкое возвращение в диапазон способны привести к серии убытков.' },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONDAY_EPOCH = Date.UTC(2026, 0, 5);
export function presentationWeek(now: number): number {
  if (!Number.isFinite(now)) throw new RangeError('A finite timestamp is required');
  return Math.floor((now - MONDAY_EPOCH) / WEEK_MS);
}
export function nextPresentationWeek(now: number): number {
  return MONDAY_EPOCH + (presentationWeek(now) + 1) * WEEK_MS;
}
function seed(text: string): number {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}
const round = (n: number) => Math.round(n * 100) / 100;
export function maxDrawdown(roi: readonly number[]): number {
  let peak = 100, max = 0;
  for (const value of roi) {
    const equity = 100 + value;
    peak = Math.max(peak, equity);
    max = Math.max(max, (peak - equity) / peak * 100);
  }
  return round(max);
}
export function botPresentation(bot: BotDefinition, week: number) {
  const hash = seed(`${bot.id}:${week}`);
  const variation = ((hash % 601) - 300) / 100;
  const roi = bot.id === 'range' ? bot.baseRoi : round(Math.max(120, Math.min(217, bot.baseRoi + variation)));
  const trades = 110 + hash % 310;
  const wins = Math.round(trades * (0.57 + (hash % 160) / 1000));
  // Each illustrative strategy has its own recognisable path: pullbacks, plateaus
  // and surges are distinct by design. These are NOT historical market candles.
  const paths: Record<string, readonly number[]> = {
    atlas: [0, .13, .10, .28, .25, .47, .44, .62, .60, .81, 1],
    ether: [0, .06, .15, .22, .28, .39, .49, .60, .73, .87, 1],
    sol: [0, .17, .30, .18, .42, .36, .68, .54, .83, .74, 1],
    delta: [0, .08, .12, .19, .18, .35, .39, .61, .60, .76, 1],
    range: [0, .12, .04, .30, .21, .46, .33, .61, .47, .85, 1],
    balance: [0, .09, .18, .28, .33, .44, .52, .62, .71, .84, 1],
    breakout: [0, .03, .15, .13, .36, .32, .59, .53, .78, .73, 1],
  };
  const anchors = paths[bot.id] ?? paths.atlas;
  const series = Array.from({ length: 31 }, (_, i) => {
    if (i === 0) return 0;
    if (i === 30) return roi;
    const segment = i / 3, index = Math.floor(segment), fraction = segment - index;
    const level = anchors[index] + (anchors[index + 1] - anchors[index]) * fraction;
    const fineMotion = Math.sin(i * (1.07 + hash % 7 / 17) + hash % 19)
      * Math.sin(Math.PI * i / 30) * roi * (bot.risk === 'Высокий' ? .027 : .015);
    return round(roi * level + fineMotion);
  });
  return { roi, trades, wins, winRate: round(wins / trades * 100), drawdown: maxDrawdown(series), series };
}
export type BotPresentation = ReturnType<typeof botPresentation>;

export function presentationPeriod(series: readonly number[], days: 7 | 30) {
  if (days === 30) return [...series];
  const part = series.slice(-8), start = 100 + part[0];
  return part.map(value => round(((100 + value) / start - 1) * 100));
}

export function validBotBudget(value: string, minimum: number): boolean {
  return /^\d+(?:\.\d{1,2})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) >= minimum;
}
