/** Presentation catalogue only. These are synthetic scenarios, not account
 * performance, backtests, forecasts or an execution engine. Never feed these
 * values into balances, financial calculations or trading endpoints. */
export type BotCategory = 'grid' | 'dca' | 'trend' | 'portfolio';
export type BotDefinition = {
  id: string; name: string; mark: string; symbol: string; category: BotCategory;
  strategy: string; description: string; detail: string; minimum: number;
  risk: 'Умеренный' | 'Высокий'; baseRoi: number;
};

export const BOT_CATALOGUE: readonly BotDefinition[] = [
  { id: 'atlas', name: 'Atlas Grid', mark: 'AG', symbol: 'BTC / USDT', category: 'grid', strategy: 'Спотовая сетка', minimum: 2500, risk: 'Умеренный', baseRoi: 154,
    description: 'Покупает ниже и продаёт выше внутри выбранного ценового диапазона.',
    detail: 'Сетка из 24 уровней распределяет покупки и продажи внутри диапазона. При выходе цены за его границы новые заявки приостанавливаются.' },
  { id: 'ether', name: 'Ether DCA', mark: 'ED', symbol: 'ETH / USDT', category: 'dca', strategy: 'Регулярные покупки', minimum: 5000, risk: 'Умеренный', baseRoi: 120,
    description: 'Распределяет покупки ETH во времени и усредняет цену входа.',
    detail: 'Плановые покупки частями с ограничением общего бюджета. Целевой уровень выхода задаётся отдельно от графика накопления.' },
  { id: 'sol', name: 'SOL Momentum', mark: 'SM', symbol: 'SOL / USDT', category: 'trend', strategy: 'Следование тренду', minimum: 7500, risk: 'Высокий', baseRoi: 217,
    description: 'Следует сильному движению SOL и сопровождает позицию трейлингом.',
    detail: 'Сценарий входа объединяет направление тренда и объём. Трейлинг-стоп сопровождает позицию; резкие развороты могут привести к убыткам.' },
  { id: 'delta', name: 'Delta Balance', mark: 'DB', symbol: 'BTC + ETH', category: 'portfolio', strategy: 'Баланс позиций', minimum: 10000, risk: 'Высокий', baseRoi: 134,
    description: 'Сочетает спотовые и фьючерсные позиции в одной стратегии.',
    detail: 'Распределяет экспозицию между двумя рынками. Хеджирование не исключает риски финансирования, комиссий и исполнения.' },
  { id: 'range', name: 'Range Trader', mark: 'RT', symbol: 'XRP / USDT', category: 'grid', strategy: 'Адаптивная сетка', minimum: 12500, risk: 'Умеренный', baseRoi: 178,
    description: 'Работает с короткими колебаниями XRP на боковом рынке.',
    detail: '36 уровней сетки с пересмотром границ диапазона. Перед изменением параметров проверяются открытые позиции и доступный бюджет.' },
  { id: 'balance', name: 'Smart Rebalance', mark: 'SR', symbol: 'BTC · ETH · SOL · BNB · XRP', category: 'portfolio', strategy: 'Ребалансировка', minimum: 15000, risk: 'Умеренный', baseRoi: 166,
    description: 'Поддерживает выбранные доли пяти активов в портфеле.',
    detail: 'Возвращает веса активов к целевым при отклонении на пять процентных пунктов. Рыночный риск портфеля сохраняется.' },
  { id: 'breakout', name: 'Breakout Pro', mark: 'BP', symbol: 'BNB / USDT', category: 'trend', strategy: 'Пробой уровней', minimum: 25000, risk: 'Высокий', baseRoi: 201,
    description: 'Ищет выход из диапазона с подтверждением торговым объёмом.',
    detail: 'Вход после пробоя локального диапазона, ограничение позиции стоп-лоссом. Ложные пробои могут привести к серии убыточных сделок.' },
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
  const roi = round(Math.max(120, Math.min(217, bot.baseRoi + variation)));
  const trades = 110 + hash % 310;
  const wins = Math.round(trades * (0.57 + (hash % 160) / 1000));
  const series = Array.from({ length: 31 }, (_, i) => {
    if (i === 0) return 0;
    if (i === 30) return roi;
    const trend = roi * i / 30;
    const wave = Math.sin(i * 1.7 + hash % 17) * (bot.risk === 'Высокий' ? 18 : 10);
    return round(trend + wave * Math.sin(i / 30 * Math.PI));
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
