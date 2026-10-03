import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { onSessionChange } from '../../lib/api';
import {
  LAB_SCENARIOS, LAB_STORAGE_KEY, addLabRun, aggregateLabBars, emptyLabState,
  restoreLabState, scenarioAt, simulateLabMinutes,
  type LabBar, type LabInterval, type LabRun, type LabScenario, type LabState,
} from './listingScenarioModel';
import './listingScenarioLab.css';

const INTERVALS: { value: LabInterval; label: string }[] = [
  { value: 15, label: '15 минут' }, { value: 60, label: '1 час' }, { value: 240, label: '4 часа' },
];
const price = (n: number) => n < 0.00000001 ? n.toExponential(6) : n.toLocaleString('ru-RU', { maximumFractionDigits: 10 });
const utcTime = (seconds: number) => new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(seconds * 1000));
const scenarioName = (id: LabScenario) => LAB_SCENARIOS.find(row => row.id === id)!.name;

function loadState(): { state: LabState; error: string | null } {
  try { return { state: restoreLabState(window.sessionStorage.getItem(LAB_STORAGE_KEY)), error: null }; }
  catch { return { state: emptyLabState(), error: 'Не удалось прочитать локальные примеры. Закрытые настройки браузера или повреждённые данные: ничего не перезаписано.' }; }
}

function ScenarioChart({ bars, interval }: { bars: readonly LabBar[]; interval: LabInterval }) {
  if (!bars.length) return <p>До начала примера свечей нет.</p>;
  const width = Math.max(680, bars.length * 6 + 100), left = 20, right = width - 90;
  const high = Math.max(...bars.map(b => b.high)), low = Math.min(...bars.map(b => b.low));
  const span = Math.max(high - low, high * 0.00001);
  const y = (n: number) => 30 + (high - n) / span * 220;
  const step = (right - left) / bars.length;
  const maxVolume = Math.max(1, ...bars.map(b => b.volume));
  const intervalName = INTERVALS.find(row => row.value === interval)!.label;
  return <div className="listing-lab-chart-scroll" tabIndex={0} aria-label="Прокрутка графика симуляции">
    <svg width={width} height={370} viewBox={`0 0 ${width} 370`} role="img" aria-label={`Симуляция: свечи, ${intervalName}`} data-lab-chart>
      <rect width={width} height={370} fill="#fbfaf6" />
      {Array.from({ length: 5 }, (_, i) => {
        const n = high - span * i / 4, level = y(n);
        return <g key={i}><line x1={left} x2={right} y1={level} y2={level} stroke="#e4e3df" />
          <text x={right + 8} y={level + 4} fill="#525861" fontSize="11">{price(n)}</text></g>;
      })}
      <text x={left + 10} y={22} fill="#6b570b" fontSize="13" fontWeight="600">СИМУЛЯЦИЯ · {intervalName} · UTC</text>
      <text x={left + 10} y={277} fill="#525861" fontSize="11">Модельная активность · условные единицы</text>
      {bars.map((b, i) => {
        const x = left + (i + 0.5) * step, up = b.close >= b.open, color = up ? '#17725d' : '#b73e48';
        const body = Math.max(1, Math.abs(y(b.close) - y(b.open)));
        return <g key={b.time} data-lab-bar={b.time}>
          <title>{`${utcTime(b.time)} UTC. Открытие ${price(b.open)}; максимум ${price(b.high)}; минимум ${price(b.low)}; закрытие ${price(b.close)}. Модельная активность ${b.volume.toFixed(0)}.`}</title>
          <line x1={x} x2={x} y1={y(b.high)} y2={y(b.low)} stroke={color} />
          <rect x={x - step * 0.33} y={Math.min(y(b.open), y(b.close))} width={Math.max(1, step * 0.66)} height={body} fill={color} />
          <rect x={x - step * 0.33} y={337 - b.volume / maxVolume * 48} width={Math.max(1, step * 0.66)} height={b.volume / maxVolume * 48} fill={color} opacity={0.4} />
          {i % Math.max(1, Math.ceil(bars.length / 6)) === 0 && <text x={x} y={356} textAnchor="start" fontSize="10" fill="#525861">{utcTime(b.time)}</text>}
        </g>;
      })}
    </svg>
  </div>;
}

function LabWorkspace() {
  const [loaded] = useState(loadState);
  const [state, setState] = useState<LabState>(loaded.state);
  const [error, setError] = useState<string | null>(loaded.error);
  const [storageBlocked, setStorageBlocked] = useState(Boolean(loaded.error));
  const [selection, setSelection] = useState<LabScenario | 'auto'>('auto');
  const [initialPrice, setInitialPrice] = useState('1');
  const [seed, setSeed] = useState('');
  const [hours, setHours] = useState(48);
  const [selectedId, setSelectedId] = useState<string | null>(loaded.state.runs[0]?.id ?? null);
  const [interval, setInterval] = useState<LabInterval>(15);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const current = state.runs.find(r => r.id === selectedId) ?? null;
  const minutes = current ? Math.min(elapsed ?? current.hours * 60, current.hours * 60) : 0;
  const minuteBars = useMemo(() => current ? simulateLabMinutes(current, minutes) : [], [current, minutes]);
  const bars = useMemo(() => aggregateLabBars(minuteBars, interval), [minuteBars, interval]);
  const nextScenario = scenarioAt(state.next);

  function create(event: FormEvent) {
    event.preventDefault();
    if (storageBlocked) return;
    try {
      const raw = initialPrice.trim().replace(',', '.');
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) throw new Error('Начальная цена должна быть положительным десятичным числом.');
      const id = globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${state.next}-${state.runs.length}`;
      const input: Omit<LabRun, 'version' | 'source' | 'tradable' | 'scenario'> = {
        id, seed: seed.trim() || id, initialPrice: Number(raw),
        start: Math.floor(Date.now() / 14400000) * 14400, hours,
      };
      const next = addLabRun(state, input, selection);
      // Store the assigned scenario once; a failed save must not consume the rotation slot.
      window.sessionStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(next));
      setState(next); setSelectedId(id); setElapsed(null); setError(null);
    } catch (e) { setError(e instanceof Error ? (e.name === 'QuotaExceededError' || e.name === 'SecurityError'
      ? 'Браузер не разрешил сохранить пример. Очередь не изменена.' : /[А-Яа-яЁё]/.test(e.message) ? e.message : 'Не удалось сохранить пример. Очередь не изменена.') : 'Не удалось создать пример.'); }
  }

  function resetStorage() {
    if (!window.confirm('Удалить только локальные примеры симулятора в этой вкладке? Опубликованные листинги не изменятся.')) return;
    try { window.sessionStorage.removeItem(LAB_STORAGE_KEY); setState(emptyLabState()); setSelectedId(null); setError(null); setStorageBlocked(false); }
    catch { setError('Браузер не разрешает доступ к локальному хранилищу.'); }
  }

  return <div data-scenario-lab>
    <p className="listing-lab-warning">Симуляция, не рыночные данные. Этот инструмент не публикует листинги, не меняет NRX/VTA, не создаёт заявки и не обращается к балансам.</p>
    <p className="listing-lab-muted">Авточередь и последние 20 примеров сохраняются только в этой вкладке браузера, переживают обновление страницы и очищаются при смене сессии. Между устройствами не синхронизируются.</p>
    <form onSubmit={create} className="listing-lab-form">
      <label>Сценарий<select value={selection} data-lab-selection onChange={e => setSelection(e.target.value as LabScenario | 'auto')}>
        <option value="auto">Автоматически по очереди</option>
        {LAB_SCENARIOS.map((row, i) => <option key={row.id} value={row.id}>{i + 1}. {row.name}</option>)}
      </select></label>
      <label>Начальная условная цена<input value={initialPrice} onChange={e => setInitialPrice(e.target.value)} inputMode="decimal" data-lab-price /></label>
      <label>Продолжительность<select value={hours} onChange={e => setHours(Number(e.target.value))} data-lab-hours>
        <option value={24}>1 день</option><option value={48}>2 дня</option><option value={168}>7 дней</option>
      </select></label>
      <label>Код генерации (необязательно)<input value={seed} maxLength={64} onChange={e => setSeed(e.target.value)} placeholder="Пусто — создать автоматически" data-lab-seed /></label>
      <p className="listing-lab-muted">{selection === 'auto' ? `Следующий: ${scenarioName(nextScenario)}. После десятого очередь начинается заново.` : LAB_SCENARIOS.find(row => row.id === selection)?.description} Ручной выбор не сдвигает автоматическую очередь.</p>
      <button type="submit" disabled={storageBlocked} data-lab-start>Создать пример</button>
    </form>
    {error && <p role="alert" className="listing-lab-error">{error}</p>}
    {(state.runs.length > 0 || storageBlocked) && <button type="button" onClick={resetStorage} className="listing-lab-reset">Очистить локальные примеры</button>}
    {current && <section className="listing-lab-result" aria-label="Результат симуляции">
      <label>Сохранённый пример<select value={current.id} data-lab-run onChange={e => { setSelectedId(e.target.value); setElapsed(null); }}>
        {state.runs.map((r, i) => <option key={r.id} value={r.id}>{i + 1}. {scenarioName(r.scenario)} · {utcTime(r.start)} UTC · {price(r.initialPrice)}</option>)}
      </select></label>
      <h3 data-lab-scenario>{scenarioName(current.scenario)}</h3>
      <p className="listing-lab-muted">Код: <code data-lab-saved-seed>{current.seed}</code>. Сценарий и параметры этого примера зафиксированы. Изменения формы создают новый пример, не переписывая старый.</p>
      <div className="listing-lab-intervals" role="group" aria-label="Интервал свечей">
        {INTERVALS.map(row => <button key={row.value} type="button" aria-pressed={interval === row.value} data-lab-interval={row.value} onClick={() => setInterval(row.value)}>{row.label}</button>)}
      </div>
      <label className="listing-lab-progress">Показать первые {Math.floor(minutes / 60)} ч {minutes % 60} мин
        <input type="range" min={15} max={current.hours * 60} step={15} value={minutes} onChange={e => setElapsed(Number(e.target.value))} data-lab-progress />
      </label>
      <p className="listing-lab-muted" data-lab-count>{bars.length} свечей. {minutes % interval !== 0 ? 'Последняя свеча неполная и содержит только показанный отрезок.' : 'Все показанные свечи завершены.'} Время на графике — UTC.</p>
      <ScenarioChart bars={bars} interval={interval} />
      <p className="listing-lab-muted">Все три интервала собраны из одного минутного потока. Объёмы — условная модельная активность, не фактические сделки. Это не прогноз доходности.</p>
    </section>}
  </div>;
}

export function ListingScenarioLab() {
  const [open, setOpen] = useState(false), [epoch, setEpoch] = useState(0);
  useEffect(() => onSessionChange(() => {
    try { window.sessionStorage.removeItem(LAB_STORAGE_KEY); } catch { /* The next open reports inaccessible storage. */ }
    setOpen(false); setEpoch(n => n + 1);
  }), []);
  return <section className="listing-lab" aria-label="Лаборатория сценариев">
    <button type="button" className="listing-lab-toggle" aria-expanded={open} aria-controls="listing-scenario-workspace" onClick={() => setOpen(v => !v)} data-open-scenario-lab>
      {open ? 'Скрыть лабораторию сценариев' : 'Лаборатория: 10 сценариев симуляции'}
    </button>
    {open && <div id="listing-scenario-workspace"><LabWorkspace key={epoch} /></div>}
  </section>;
}
