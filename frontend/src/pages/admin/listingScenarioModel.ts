/** Private chart laboratory only. No imports from market feeds, orders or wallets.
 * Version 1 is immutable: changing the model requires a new version, not repainting saved runs. */
export const LAB_SCENARIOS = [
  { id: 'calm', name: 'Спокойный тренд', description: 'Небольшие движения, короткие тени и спокойные паузы.' },
  { id: 'impulse', name: 'Импульсное движение', description: 'Редкие сильные движения между спокойными участками.' },
  { id: 'pullback', name: 'Тренд с откатами', description: 'Волны движения с промежуточными коррекциями.' },
  { id: 'compression', name: 'Сжатие и пробой', description: 'Сужение диапазона и последующий выход из него.' },
  { id: 'range', name: 'Боковой диапазон', description: 'Колебания вокруг средней цены без обязательного роста.' },
  { id: 'false-breakout', name: 'Ложный пробой с возвратом', description: 'Выход из диапазона с последующим возвратом.' },
  { id: 'wicks', name: 'Длинные тени', description: 'Короткие отклонения цены и свечи с выраженными тенями.' },
  { id: 'volatility', name: 'Всплеск волатильности и затухание', description: 'Резкие колебания сменяются более спокойными.' },
  { id: 'recovery', name: 'Снижение и восстановление', description: 'Коррекция и восстановительная волна; результат не фиксирован.' },
  { id: 'stress', name: 'Стресс-сценарий', description: 'Продолжительное снижение с короткими отскоками.' },
] as const;
export type LabScenario = typeof LAB_SCENARIOS[number]['id'];
export type LabInterval = 15 | 60 | 240;
export interface LabRun {
  version: 1; source: 'admin-simulation'; tradable: false;
  id: string; scenario: LabScenario; seed: string; initialPrice: number;
  start: number; hours: number;
}
export interface LabBar {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}
export interface LabState { version: 1; next: number; runs: LabRun[] }
export const LAB_STORAGE_KEY = 'voltex.admin.scenario-lab.v1';
export const emptyLabState = (): LabState => ({ version: 1, next: 0, runs: [] });
export function isLabScenario(value: unknown): value is LabScenario {
  return LAB_SCENARIOS.some(row => row.id === value);
}
export function scenarioAt(ordinal: number): LabScenario {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new Error('Некорректный номер сценария.');
  return LAB_SCENARIOS[ordinal % LAB_SCENARIOS.length].id;
}
export function validateLabRun(value: unknown): LabRun {
  if (!value || typeof value !== 'object') throw new Error('Настройки симуляции повреждены.');
  const r = value as LabRun;
  if (r.version !== 1 || r.source !== 'admin-simulation' || r.tradable !== false
    || typeof r.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(r.id)
    || !isLabScenario(r.scenario) || typeof r.seed !== 'string' || !r.seed.trim()
    || r.seed.length > 64 || /[\u0000-\u001f\u007f]/.test(r.seed)
    || !Number.isFinite(r.initialPrice) || r.initialPrice < 0.00000001 || r.initialPrice > 1000000
    || !Number.isSafeInteger(r.start) || r.start < 0 || r.start > 4102444800 || r.start % 14400 !== 0
    || ![24, 48, 168].includes(r.hours)) throw new Error('Проверьте параметры симуляции.');
  return { version: 1, source: 'admin-simulation', tradable: false, id: r.id, scenario: r.scenario,
    seed: r.seed, initialPrice: r.initialPrice, start: r.start, hours: r.hours };
}
export function restoreLabState(raw: string | null): LabState {
  if (raw === null) return emptyLabState();
  if (raw.length > 32768) throw new Error('Сохранённые примеры повреждены.');
  const s = JSON.parse(raw) as LabState;
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.next) || s.next < 0 || s.next > 1000000000
    || !Array.isArray(s.runs) || s.runs.length > 20) throw new Error('Сохранённые примеры повреждены.');
  const runs = s.runs.map(validateLabRun);
  if (new Set(runs.map(r => r.id)).size !== runs.length) throw new Error('Повторяющиеся номера примеров.');
  return { version: 1, next: s.next, runs };
}
export function addLabRun(state: LabState, input: Omit<LabRun, 'version' | 'source' | 'tradable' | 'scenario'>,
  selection: LabScenario | 'auto'): LabState {
  const current = restoreLabState(JSON.stringify(state));
  if (current.next >= 1000000000) throw new Error('Достигнут предел очереди примеров.');
  if (current.runs.some(r => r.id === input.id)) throw new Error('Пример с таким номером уже существует.');
  const run = validateLabRun({ ...input, version: 1, source: 'admin-simulation', tradable: false,
    scenario: selection === 'auto' ? scenarioAt(current.next) : selection });
  return { version: 1, next: current.next + (selection === 'auto' ? 1 : 0), runs: [run, ...current.runs].slice(0, 20) };
}

// Deterministic, addressable pseudo-random draws. No runtime entropy or clock reads.
function random(seed: string, minute: number, lane: number): number {
  const text = `${seed}|${minute}|${lane}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}
function normal(seed: string, minute: number): number {
  return Math.sqrt(-2 * Math.log(random(seed, minute, 1))) * Math.cos(2 * Math.PI * random(seed, minute, 2));
}
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Canonical one-minute OHLC from eight sub-minute samples. elapsedMinutes exposes only a prefix.
 * All scenarios are hypothetical regimes, not fitted prices, exchange trades or promised returns. */
export function simulateLabMinutes(input: LabRun, elapsedMinutes = input.hours * 60): LabBar[] {
  const run = validateLabRun(input);
  if (!Number.isInteger(elapsedMinutes) || elapsedMinutes < 0 || elapsedMinutes > run.hours * 60)
    throw new Error('Некорректная длительность предпросмотра.');
  const bars: LabBar[] = [];
  let logPrice = 0;
  const phaseLength = 150 + Math.floor(random(run.seed, -1, 0) * 150);
  for (let m = 0; m < elapsedMinutes; m++) {
    const h = m / 60, phase = (m % phaseLength) / phaseLength;
    let drift = 0.00004, sigma = 0.0015, correction = 0, jump = 0, wick = 1;
    switch (run.scenario) {
      case 'calm': sigma = 0.00065; break;
      case 'impulse':
        sigma = 0.0011;
        if (random(run.seed, m, 3) < 0.035) jump = (random(run.seed, m, 4) < 0.6 ? 1 : -1) * (0.008 + random(run.seed, m, 5) * 0.016);
        break;
      case 'pullback': drift = 0.00008 + 0.0005 * Math.sin(m / 55); sigma = 0.0012; break;
      case 'compression':
        sigma = phase < 0.75 ? 0.0003 : 0.003;
        drift = phase < 0.75 ? 0 : (random(run.seed, Math.floor(m / phaseLength), 7) < 0.55 ? 0.0005 : -0.0005);
        if (phase < 0.75) correction = -logPrice * 0.0005;
        break;
      case 'range': drift = 0; correction = -logPrice * 0.035; break;
      case 'false-breakout':
        drift = 0; sigma = 0.001;
        correction = ((phase > 0.55 && phase < 0.72 ? 0.06 : 0) - logPrice) * 0.04;
        break;
      case 'wicks': drift = 0; correction = -logPrice * 0.01; sigma = 0.0008; wick = 5; break;
      case 'volatility':
        sigma = 0.0006 + 0.006 * Math.exp(-Math.pow((phase - 0.3) / 0.16, 2));
        drift = 0; correction = -logPrice * 0.002; break;
      case 'recovery':
        correction = ((h < 12 ? -0.025 * h : -0.3 + Math.min(0.36, (h - 12) * 0.012)) - logPrice) * 0.02;
        drift = 0; sigma = 0.0018; break;
      case 'stress': drift = -0.00035; sigma = 0.0025;
        if (random(run.seed, m, 8) < 0.02) jump = 0.009;
        break;
    }
    const open = run.initialPrice * Math.exp(logPrice);
    const move = drift + correction + jump + sigma * normal(run.seed, m);
    const delta = random(run.seed, m, 9) < 0.07 ? move * 0.04 : move;
    const target = clamp(logPrice + delta, -12, 12);
    let high = open, low = open, close = open, volume = 0;
    const excursion = sigma * wick * (0.4 + random(run.seed, m, 10) * 2.8);
    const polarity = random(run.seed, m, 11) < 0.5 ? -1 : 1;
    for (let k = 1; k <= 8; k++) {
      const f = k / 8;
      const bridge = k === 8 ? 0 : Math.sin(Math.PI * f) * excursion * polarity
        + Math.sin(2 * Math.PI * f) * excursion * (random(run.seed, m, 12) - 0.5);
      close = run.initialPrice * Math.exp(k === 8 ? target : clamp(logPrice + (target - logPrice) * f + bridge, -12, 12));
      high = Math.max(high, close); low = Math.min(low, close);
      // Hypothetical activity in arbitrary units, never a claimed traded quantity.
      volume += (10 + 20 * random(run.seed, m, 20 + k)) * (1 + Math.abs(move) / 0.0015);
    }
    bars.push({ time: run.start + m * 60, open, high, low, close, volume });
    logPrice = target;
  }
  return bars;
}

/** UTC-aligned aggregation: no separate generator per timeframe and no future data. */
export function aggregateLabBars(bars: readonly LabBar[], minutes: LabInterval): LabBar[] {
  if (![15, 60, 240].includes(minutes)) throw new Error('Выберите 15 минут, 1 час или 4 часа.');
  const result: LabBar[] = [];
  let previous = -Infinity;
  for (const b of bars) {
    if (!Number.isSafeInteger(b.time) || b.time <= previous || b.time % 60 !== 0
      || ![b.open, b.high, b.low, b.close].every(n => Number.isFinite(n) && n > 0)
      || !Number.isFinite(b.volume) || b.volume < 0 || b.low > Math.min(b.open, b.close)
      || b.high < Math.max(b.open, b.close)) throw new Error('Некорректные свечи симуляции.');
    previous = b.time;
    const time = Math.floor(b.time / (minutes * 60)) * minutes * 60;
    const last = result[result.length - 1];
    if (!last || last.time !== time) result.push({ ...b, time });
    else { last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low); last.close = b.close; last.volume += b.volume; }
  }
  return result;
}
