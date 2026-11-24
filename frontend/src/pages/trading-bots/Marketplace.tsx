import { useState } from 'react';
import { ArrowUpRight, Award, BookOpen, Layers3, LineChart, SlidersHorizontal } from 'lucide-react';
import type { BotDefinition, BotPresentation, BotCreator } from '../../lib/tradingBotsPresentation';
import { monthlyPercent } from '../../lib/monthlyCopyPerformance';
import type { BotHistory } from '../../../../src/shared/thomasPerformance';
import { MODEL_FIRST_YEAR, MODEL_SECOND_YEAR, summedModelPercent } from './BotModelPerformance';
import { BotStrategyIcon } from './BotStrategyIcon';

export type Entry = { bot: BotDefinition; stats: BotPresentation };
export function summary(entry: Entry, history?: BotHistory) {
  const thomas = entry.bot.id === 'range';
  const verified = thomas && history?.status === 'verified' ? history : undefined;
  const modelMonths = thomas && history?.status === 'unavailable';
  const latestYear = [...MODEL_SECOND_YEAR, entry.stats.roi];
  const known = !thomas || !!history;
  return {
    roi: verified?.periods['30D'].roi ?? (known ? entry.stats.roi : null),
    year: verified?.periods['1Y'].roi ?? (modelMonths ? summedModelPercent(latestYear) : null),
    all:
      verified?.periods.ALL.roi ??
      (modelMonths ? summedModelPercent([...MODEL_FIRST_YEAR, ...latestYear]) : null),
    dd: known ? (verified?.periods['30D'].drawdown ?? entry.stats.drawdown) : null,
    win: verified ? verified.periods['30D'].winRate : known ? entry.stats.winRate : null,
    trades: known ? (verified?.periods['30D'].trades ?? entry.stats.trades) : null,
  };
}
export const pct = (v: number | null) => (v === null ? '—' : monthlyPercent(v).text);

export function MarketHero() {
  return (
    <section className="qm-hero">
      <div className="qm-hero-copy">
        <h1>
          <span>VOLTEX</span> Quant <br />
          Marketplace
        </h1>
        <h2>Интеллектуальные стратегии. Новый уровень автоматизированной торговли.</h2>
        <p>
          Исследуйте авторские торговые стратегии, сравнивайте показатели эффективности и выбирайте подход,
          соответствующий вашим инвестиционным целям.
        </p>
        <div className="qm-hero-actions">
          <a href="#quant-ranking">
            Сравнить стратегии <ArrowUpRight size={16} />
          </a>
          <a href="#quant-academy">
            <BookOpen size={15} /> Руководство
          </a>
        </div>
      </div>
      <div className="qm-hero-art">
        <img alt="" src="/media/quant/signal-knot.webp" width="1120" height="580" />
      </div>
    </section>
  );
}

// Keep rankings compact while retaining both source decimal places when present.
function rankedPercent(value: number | null, signed = false) {
  if (value === null) return '—';
  const rounded = Number(value.toFixed(2));
  return (signed && rounded > 0 ? '+' : '') + rounded + '%';
}

export function Ranking({
  entries,
  history,
  creators,
  vip,
  open,
}: {
  entries: Entry[];
  history?: BotHistory;
  creators: Record<string, BotCreator>;
  vip: boolean;
  open: (b: BotDefinition) => void;
}) {
  const [search, setSearch] = useState(''),
    [type, setType] = useState(''),
    [risk, setRisk] = useState(''),
    [period, setPeriod] = useState<'roi' | 'year' | 'all'>('roi'),
    [floor, setFloor] = useState(0),
    [sort, setSort] = useState('return');
  const verified = history?.status === 'verified';
  const ranked = entries
    .filter((e) => !verified || e.bot.id === 'range')
    .map((e) => ({ ...e, s: summary(e, history) }))
    .filter((e) => e.s[period] !== null)
    .sort((a, b) => b.s[period]! - a.s[period]!)
    .map((e, i) => ({ ...e, rank: i + 1 }))
    .filter(
      (e) =>
        (!risk || e.bot.risk === risk) &&
        (!type || e.bot.category === type) &&
        (!floor || e.s[period]! >= floor) &&
        [
          e.bot.name,
          e.bot.symbol,
          e.bot.symbol.replace(/\s/g, ''),
          creators[e.bot.id]?.displayName || e.bot.creatorName,
        ]
          .join(' ')
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    );
  if (sort === 'risk') ranked.sort((a, b) => (a.s.dd ?? Infinity) - (b.s.dd ?? Infinity));
  if (sort === 'minimum') ranked.sort((a, b) => a.bot.minimum - b.bot.minimum);
  return (
    <section className="qm-ranking" id="quant-ranking">
      <h2>Рейтинг торговых стратегий</h2>
      <p>
        {verified
          ? 'Рейтинг по подтверждённой истории за выбранный период.'
          : 'Модельные результаты. Год и весь период показывают сумму месячных процентов.'}
      </p>
      <div className="qm-tools">
        <input
          aria-label="Поиск стратегии"
          placeholder="Название, автор или пара"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Тип в рейтинге" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Все типы</option>
          <option value="trend">Трендовые</option>
          <option value="grid">Grid</option>
          <option value="dca">DCA</option>
          <option value="portfolio">Портфельные</option>
        </select>
        <select aria-label="Риск" value={risk} onChange={(e) => setRisk(e.target.value)}>
          <option value="">Любой риск</option>
          <option>Умеренный</option>
          <option>Высокий</option>
        </select>
        <select
          aria-label="Период рейтинга"
          value={period}
          onChange={(e) => setPeriod(e.target.value as typeof period)}
        >
          <option value="roi">30 дней</option>
          <option value="year">Год</option>
          <option value="all">Всё время</option>
        </select>
        <select
          aria-label="Порог результата"
          value={floor}
          onChange={(e) => setFloor(Number(e.target.value))}
        >
          <option value={0}>Любой результат</option>
          <option value={150}>От 150%</option>
          <option value={175}>От 175%</option>
        </select>
        <select aria-label="Порядок рейтинга" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="return">По результату</option>
          <option value="risk">По просадке</option>
          <option value="minimum">По порогу входа</option>
        </select>
      </div>
      <div className="qm-table-scroll" tabIndex={0} aria-label="Таблица рейтинга">
        <table>
          <thead>
            <tr>
              {[
                'Место',
                'Стратегия',
                'Автор',
                'Пара',
                '30 дней',
                'Год',
                'Весь период',
                'Просадка',
                'Прибыльные сделки',
                'Мин. сумма',
                'Профиль',
              ].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ bot, s, rank }) => (
              <tr key={bot.id}>
                <td>
                  <span className={'qm-medal m' + rank}>
                    {rank <= 3 && <Award size={15} />} {rank}
                  </span>
                </td>
                <th>
                  <BotStrategyIcon id={bot.id} />
                  {bot.name}
                </th>
                <td>
                  {creators[bot.id]?.displayName || bot.creatorName || '—'}{' '}
                  {bot.id === 'range' && vip && <b>VIP</b>}
                </td>
                <td>{bot.symbol}</td>
                <td className="qm-return">{rankedPercent(s.roi, true)}</td>
                <td>{rankedPercent(s.year, true)}</td>
                <td>{rankedPercent(s.all, true)}</td>
                <td>{rankedPercent(s.dd)}</td>
                <td>{rankedPercent(s.win)}</td>
                <td>${bot.minimum.toLocaleString('ru-RU')}</td>
                <td>
                  <button onClick={() => open(bot)} aria-label={'Подробнее о ' + bot.name}>
                    <ArrowUpRight size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ranked.length && <p role="status">Нет стратегий с такими параметрами.</p>}
    </section>
  );
}

export function Academy() {
  const lessons = [
    [
      Layers3,
      'Как работают алгоритмические стратегии',
      'Grid распределяет уровни покупки и продажи внутри диапазона. DCA делит вход на последовательные части. При выходе из диапазона или длительном снижении риск сохраняется.',
    ],
    [
      LineChart,
      'Количественный анализ и управление риском',
      'Доходность сравнивают за одинаковые периоды. Максимальная просадка показывает падение от локального пика. Высокая доля удачных сделок сама по себе не учитывает размер убытков.',
    ],
    [
      SlidersHorizontal,
      'Как выбрать торговую стратегию',
      'Сначала выберите допустимую просадку и размер позиции. Затем сравните стратегии одного типа и проверьте источник данных, горизонт и поведение кривой при откатах.',
    ],
  ] as const;
  return (
    <section className="qm-academy" id="quant-academy">
      <h2>VOLTEX Quant Academy</h2>
      <div>
        {lessons.map(([Icon, title, body]) => (
          <details key={title}>
            <summary>
              <Icon size={24} />
              <strong>{title}</strong>
              <span className="qm-read-link">Читать ↗</span>
            </summary>
            <p>{body}</p>
          </details>
        ))}
      </div>
      <h3>Частые вопросы</h3>
      {[
        [
          'Что показывает кривая стратегии?',
          'Каждая точка соответствует результату выбранного периода. Выберите точку на графике, чтобы узнать её значение.',
        ],
        [
          'Кому доступен Bot Studio?',
          'Создавать и публиковать описания стратегий могут владельцы авторского профиля с подтверждённым VIP-статусом.',
        ],
        [
          'Как рассчитаны показатели?',
          'Модель иллюстрирует сценарий. Для подтверждённой истории доходность рассчитывается по дневным данным с учётом движения капитала.',
        ],
        [
          'Можно ли потерять средства?',
          'Да. Рыночное движение, проскальзывание и комиссии могут привести к убыткам.',
        ],
      ].map(([q, a]) => (
        <details className="qm-faq" key={q}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
    </section>
  );
}
