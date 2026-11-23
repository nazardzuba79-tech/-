import { isBrowserInactive, addBrowserActivityListener, removeBrowserActivityListener } from '../lib/browserActivity';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Star, X } from 'lucide-react';
import { request } from '../lib/api';
import { Nav } from '../components/Nav';
import { Sparkline } from './trading-bots/BotSparkline';
import { BotHistoryPanel, useBotHistory } from './trading-bots/BotHistoryPanel';
import { monthlyPercent } from '../lib/monthlyCopyPerformance';
import { BotStrategyIcon } from './trading-bots/BotStrategyIcon';
import { BOT_CATALOGUE, botPresentation, nextPresentationWeek, presentationPeriod, presentationWeek, validBotBudget } from '../lib/tradingBotsPresentation';
import type { BotCategory, BotCreator, BotDefinition, BotPresentation } from '../lib/tradingBotsPresentation';
import './trading-bots/TradingBots.css';

const usd = (n: number) => '$' + n.toLocaleString('en-US');
const percent = (n: number) => n.toFixed(2) + '%';
const FAVORITES_KEY = 'voltex.bot-catalogue.favorites.v1';
function loadFavorites(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && BOT_CATALOGUE.some(b => b.id === id)))] : [];
  } catch { return []; }
}
function usePresentationWeek() {
  const [week, setWeek] = useState(() => presentationWeek(Date.now()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      if (isBrowserInactive()) return;
      const now = Date.now();
      setWeek(presentationWeek(now));
      timer = setTimeout(refresh, nextPresentationWeek(now) - now + 50);
    };
    refresh();
    window.addEventListener('focus', refresh);
    addBrowserActivityListener(refresh);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); removeBrowserActivityListener(refresh); };
  }, []);
  return week;
}
function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
function CreatorLine({ bot, profile }: { bot: BotDefinition; profile?: BotCreator }) {
  const name = profile?.displayName || bot.creatorName;
  return <div className="vb-creator">
    {profile?.avatarUrl && <img src={profile.avatarUrl} alt="" width="20" height="20"/>}
    {name ? <><span>Автор</span> <bdi>{name}</bdi></> : 'Каталог VOLTEX'}
  </div>;
}
function BotModal({ bot, profile, stats, history, onClose }: { history: ReturnType<typeof useBotHistory>; bot: BotDefinition; profile?: BotCreator; stats: BotPresentation; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [period, setPeriod] = useState<7 | 30>(30);
  const [budget, setBudget] = useState(String(bot.minimum));
  const [saved, setSaved] = useState(false);
  const series = presentationPeriod(stats.series, period);
  const valid = validBotBudget(budget, bot.minimum);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => { element?.close(); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="bots-content vb-modal" aria-labelledby="vb-dialog-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <div className="vb-modal-head"><BotStrategyIcon id={bot.id}/><div><h2 id="vb-dialog-title">{bot.name}</h2><p className="vb-pair">{bot.symbol} · {bot.strategy}</p><CreatorLine bot={bot} profile={profile}/></div><button type="button" className="vb-close" onClick={onClose} aria-label="Закрыть"><X size={20}/></button></div>
    <span className={`vb-risk ${bot.risk === 'Высокий' ? 'high' : ''}`}>{bot.risk} риск</span>
    <p className="vb-modal-note">{bot.detail}</p>
    {bot.id === 'range' ? <BotHistoryPanel history={history} modelRoi={stats.roi}/> : <>
    <div className="vb-roi-row"><div><span className="vb-label">Модельная доходность · {period} дней</span><strong className="vb-roi">+{percent(series[series.length - 1])}</strong></div><div className="vb-periods">{([7, 30] as const).map(days => <button type="button" key={days} aria-pressed={period === days} onClick={() => setPeriod(days)}>{days}д</button>)}</div></div>
    <Sparkline series={series} name={bot.name} large/>
    <dl className="vb-metrics vb-modal-metrics"><Metric label="Макс. просадка · 30д" value={percent(stats.drawdown)}/><Metric label="Прибыльные сделки · 30д" value={percent(stats.winRate)}/><Metric label="Сделок · 30д" value={stats.trades}/></dl>
    </>}
    <form className="vb-config" onSubmit={e => { e.preventDefault(); if (valid) setSaved(true); }}>
      <label htmlFor="vb-budget">Планируемая инвестиция</label><div className="vb-field"><input id="vb-budget" value={budget} onChange={e => { setBudget(e.target.value); setSaved(false); }} inputMode="decimal" aria-describedby="vb-budget-hint" aria-invalid={!valid}/><span>USD</span></div>
      <p id="vb-budget-hint" className="vb-budget-hint">Минимальная сумма — {usd(bot.minimum)}.</p>
      <button className="vb-modal-action" type="submit" disabled={!valid}>Копировать</button>
      {saved && <div className="vb-plan" role="status"><strong>{bot.name} · {usd(Number(budget))}</strong></div>}
    </form>
  </dialog>, document.body);
}

export function TradingBotsPage() {
  const week = usePresentationWeek();
  const history = useBotHistory();
  const verified = history.data?.status === 'verified' ? history.data.periods['30D'] : null;
  const [creators, setCreators] = useState<Record<string, BotCreator>>({});
  useEffect(() => {
    const controller = new AbortController();
    request<{ creators: Record<string, BotCreator> }>('/trading-bots/creators', { signal: controller.signal })
      .then(({ creators }) => { if (creators && !controller.signal.aborted) setCreators(creators); })
      .catch(() => { /* The catalogue attribution remains available offline. */ });
    return () => controller.abort();
  }, []);
  const [category, setCategory] = useState<BotCategory | 'all'>('all');
  const [tab, setTab] = useState<'all' | 'favorites'>('all');
  const [sort, setSort] = useState('default');
  const [favorites, setFavorites] = useState(loadFavorites);
  const [selected, setSelected] = useState<BotDefinition | null>(null);
  const entries = useMemo(() => BOT_CATALOGUE.map(bot => ({ bot, stats: botPresentation(bot, week) })), [week]);
  const selectedEntry = entries.find(entry => entry.bot === selected);
  const visible = entries.filter(({ bot }) => (category === 'all' || bot.category === category) && (tab === 'all' || favorites.includes(bot.id)));
  const unknownMetric = (bot: BotDefinition) => bot.id === 'range' && !history.data;
  if (sort === 'roi') visible.sort((a, b) => Number(unknownMetric(a.bot)) - Number(unknownMetric(b.bot)) || (b.bot.id === 'range' && verified ? verified.roi : b.stats.roi) - (a.bot.id === 'range' && verified ? verified.roi : a.stats.roi));
  if (sort === 'drawdown') visible.sort((a, b) => Number(unknownMetric(a.bot)) - Number(unknownMetric(b.bot)) || (a.bot.id === 'range' && verified ? verified.drawdown : a.stats.drawdown) - (b.bot.id === 'range' && verified ? verified.drawdown : b.stats.drawdown));
  if (sort === 'minimum') visible.sort((a, b) => a.bot.minimum - b.bot.minimum);
  const toggleFavorite = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter(value => value !== id) : [...favorites, id];
    setFavorites(next);
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); } catch { /* The catalogue works when storage is disabled. */ }
  };
  return <div className="trading-bots-page"><Nav active="/trading-bots" hideTicker/>
    <main className="bots-content vb-content">
      <div className="vb-crumb"><Link to="/trade">Торговля</Link><span>/</span><span>Торговые боты</span></div>
      <section className="vb-intro"><div><div className="vb-eyebrow"><span/>VOLTEX AUTOMATION</div><h1>Торговые боты</h1><p>Авторские стратегии, разные рынки и прозрачная аналитика сценариев.<br/>Сравнивайте динамику, просадку и параметры перед выбором.</p></div><div className="vb-collection"><span>07</span><p><strong>стратегий в коллекции</strong>Разные методы анализа.<br/>Разные профили риска.</p></div></section>
      <div className="vb-subnav"><div className="vb-section-tabs"><button type="button" aria-pressed={tab === 'all'} onClick={() => setTab('all')}>Все боты <span>{entries.length}</span></button><button type="button" aria-pressed={tab === 'favorites'} onClick={() => setTab('favorites')}>Избранные <span>{favorites.length}</span></button></div><span className="vb-data-note">{verified ? 'Результаты за 30 дней' : 'Модельные результаты · 30 дней'}</span></div>
      <div className="vb-filterbar"><div className="vb-filters" aria-label="Тип стратегии">{([['all', 'Все стратегии'], ['grid', 'Grid'], ['dca', 'DCA'], ['trend', 'Трендовые'], ['portfolio', 'Портфельные']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)}>{label}</button>)}</div><select aria-label="Сортировка ботов" value={sort} onChange={e => setSort(e.target.value)}><option value="default">Коллекция VOLTEX</option><option value="roi">По доходности</option><option value="drawdown">По меньшей просадке</option><option value="minimum">По минимальной сумме</option></select></div>
      <section className="vb-bots" aria-label="Коллекция торговых ботов">
        {visible.map(({ bot, stats }) => {
          const featured = bot.id === 'range' && tab === 'all' && category === 'all' && sort === 'default';
          const header = <div className="vb-bot-head"><BotStrategyIcon id={bot.id}/><div><h2>{bot.name}</h2><p className="vb-pair">{bot.symbol} · {bot.strategy}</p><CreatorLine bot={bot} profile={creators[bot.id]}/></div><button type="button" className="vb-heart" aria-label={`${favorites.includes(bot.id) ? 'Убрать из избранного' : 'В избранное'}: ${bot.name}`} aria-pressed={favorites.includes(bot.id)} onClick={() => toggleFavorite(bot.id)}><Star size={18} fill={favorites.includes(bot.id) ? 'currentColor' : 'none'}/></button></div>;
          const footer = <div className="vb-foot"><div><small>Мин. инвестиция</small><span>{usd(bot.minimum)}</span></div><button type="button" className="vb-open" onClick={() => setSelected(bot)}>Подробнее <ArrowUpRight size={14}/></button></div>;
          const live = bot.id === 'range' ? verified : null;
          const result = unknownMetric(bot) ? <p role="status">{history.error ? 'Доходность временно недоступна.' : 'Загрузка доходности…'}</p> : <><div className="vb-roi-row"><div><span className="vb-label">{live && history.data?.status === 'verified' ? `Доходность · 30д на ${history.data.asOf.slice(0, 10)}` : 'Модельная доходность · 30д'}</span><strong className="vb-roi">{monthlyPercent(live?.roi ?? stats.roi).text}</strong></div><span className={`vb-risk ${bot.risk === 'Высокий' ? 'high' : ''}`}>{bot.risk} риск</span></div><Sparkline series={live?.series ?? stats.series} name={bot.name} verified={!!live}/><dl className="vb-metrics"><Metric label="Макс. просадка" value={percent(live?.drawdown ?? stats.drawdown)}/><Metric label="Прибыльные сделки" value={live ? (live.winRate === null ? '—' : percent(live.winRate)) : percent(stats.winRate)}/><Metric label="Сделок за 30 дней" value={live?.trades ?? stats.trades}/></dl></>;
          return <article className={`vb-bot${featured ? ' vb-featured' : ''}`} key={bot.id} data-bot={bot.id}>{featured ? <><div><div className="vb-feature-kicker">STRATEGY SPOTLIGHT · THOMAS QUANT AI</div>{header}<p className="vb-description">{bot.description}</p>{footer}</div><div className="vb-feature-right">{result}</div></> : <>{header}<p className="vb-description">{bot.description}</p>{result}{footer}</>}</article>;
        })}
        {!visible.length && <p className="vb-empty">Добавьте подходящие стратегии в избранное с помощью звёздочки.</p>}
      </section>
      <footer className="vb-bottom"><strong>VOLTEX Bot Studio</strong></footer>
    </main>
    {selectedEntry && <BotModal key={selectedEntry.bot.id} bot={selectedEntry.bot} profile={creators[selectedEntry.bot.id]} history={history} stats={selectedEntry.stats} onClose={() => setSelected(null)}/>}
  </div>;
}
