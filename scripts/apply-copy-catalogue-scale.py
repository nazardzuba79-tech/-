from pathlib import Path

p = Path('frontend/src/pages/copy-trading-bolt/components.tsx')
s = p.read_text()

imp = "import './LockedTraderList.css';\n"
if "from './lockedCatalogue'" not in s:
    assert imp in s
    s = s.replace(imp, imp + "import { lockedCatalogueTraders } from './lockedCatalogue';\n", 1)

start = s.index('function LockedTraderList(')
end = s.index('export function Marketplace(', start)
replacement = r'''function LockedTraderList({ traders }: { traders: Trader[] }) {
  const whitelistNotice = (trader: Trader) => toast.warning(
    'Только пользователи из белого списка могут подписаться на этого Мастера трейдинга.',
    { description: `Свяжитесь с Мастером трейдинга ${trader.name}, чтобы получить приглашение.`, duration: 5500 }
  );
  return <>
    <div className="locked-trader-list" role="table" aria-label="Закрытый каталог Мастеров трейдинга">
      <div className="locked-trader-list-head" role="row">
        <span>Мастер трейдинга</span><span>Доступ</span><span>Действие</span>
      </div>
      {traders.map((trader) => (
        <div
          className="locked-trader-row"
          role="button"
          tabIndex={0}
          key={trader.id}
          data-trader-id={trader.id}
          onClick={() => whitelistNotice(trader)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              whitelistNotice(trader);
            }
          }}
        >
          <div className="locked-trader-identity">
            <Avatar trader={trader} />
            <div>
              <div className="locked-trader-name"><span>{trader.name}</span><span className="locked-trader-lock" title="Только по приглашению"><LockKeyhole size={14} /></span></div>
              <div className="locked-trader-subtitle">Master Trader · {trader.region}</div>
            </div>
          </div>
          <div className="locked-access"><LockKeyhole size={14} /><span>Только по приглашению</span></div>
          <div className="locked-trader-action"><button className="locked-copy-button" type="button" onClick={(event) => { event.stopPropagation(); whitelistNotice(trader); }}>Копировать</button></div>
        </div>
      ))}
    </div>
    <p className="locked-list-note">Профили закрыты. Для подключения свяжитесь с выбранным Мастером трейдинга и получите приглашение.</p>
  </>;
}

type PaginationItem = number | 'gap-left' | 'gap-right';
function paginationWindow(current: number, total: number): PaginationItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 4) [2, 3, 4, 5].forEach(page => pages.add(page));
  if (current >= total - 3) [total - 4, total - 3, total - 2, total - 1].forEach(page => pages.add(page));
  const sorted = [...pages].filter(page => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: PaginationItem[] = [];
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];
    if (previous && page - previous > 1) result.push(previous === 1 ? 'gap-left' : 'gap-right');
    result.push(page);
  });
  return result;
}

'''
s = s[:start] + replacement + s[end:]

old_start = s.index('  // Both operator identities have permanent slots')
old_end = s.index('  useEffect(() => { setPage(1); }, [tab, query, sortBy, period]);', old_start)
old_end += len('  useEffect(() => { setPage(1); }, [tab, query, sortBy, period]);')
logic = r'''  // Featured traders keep the existing rich cards. The invitation-only
  // directory is a separate lightweight roster with no performance payloads.
  const dynamicRoster = useMemo(() => [nazara, ksenia, ...marketplaceTraders], [nazara, ksenia]);
  const lockedRoster = lockedCatalogueTraders;
  const tabRoster = useMemo(() => {
    switch (tab) {
      case 'favorites': return dynamicRoster.filter((t) => favorites.has(t.id));
      case 'following': return dynamicRoster.filter((t) => following.has(t.id));
      case 'all': return lockedRoster;
      default: return dynamicRoster;
    }
  }, [tab, favorites, following, dynamicRoster, lockedRoster]);

  const lockedVisible = useMemo(() => searchTraders(lockedRoster, query), [lockedRoster, query]);
  const visibleTraders = useMemo(() => {
    if (tab === 'all') return lockedVisible;
    let result = searchTraders(tabRoster, query).map(item => preserveModeledSource(item, { ...item, drawdown: item.id === nazara.id
      ? synthetic ? selectSyntheticPeriod(synthetic, period).maximumDrawdown : item.drawdown
      : item.id === ksenia.id ? kseniaSynthetic ? selectSyntheticPeriod(kseniaSynthetic, period).maximumDrawdown : item.drawdown : selectDemoPerformance(item, period).maximumDrawdown }));
    if (tab === 'leaderboard' || sortBy === 'Top Performance') {
      const featured = [nazara.id, ksenia.id].flatMap(id => result.filter(item => item.id === id));
      result = [...featured, ...sortTraders(result.filter(item => item.id !== nazara.id && item.id !== ksenia.id), sortBy, period)];
    } else {
      result = sortTraders(result, sortBy, period);
    }
    return result;
  }, [tabRoster, query, sortBy, period, tab, nazara.id, synthetic, ksenia, kseniaSynthetic, lockedVisible]);

  const featuredPageCount = Math.min(PAGE_SIZE, visibleTraders.length);
  const ordinaryPages = Math.max(1, Math.ceil(visibleTraders.length / PAGE_SIZE));
  const lockedPages = Math.max(1, Math.ceil(lockedVisible.length / PAGE_SIZE));
  const totalPages = tab === 'leaderboard' ? 1 + lockedPages : tab === 'all' ? lockedPages : ordinaryPages;
  const currentPage = Math.min(page, totalPages);
  const lockedListMode = tab === 'all' || (tab === 'leaderboard' && currentPage > 1);
  const pageTraders = tab === 'all'
    ? lockedVisible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : tab === 'leaderboard' && currentPage > 1
      ? lockedVisible.slice((currentPage - 2) * PAGE_SIZE, (currentPage - 1) * PAGE_SIZE)
      : visibleTraders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const totalVisibleCount = tab === 'leaderboard' ? featuredPageCount + lockedVisible.length : visibleTraders.length;
  const startIdx = totalVisibleCount === 0 ? 0 : tab === 'leaderboard' && currentPage > 1
    ? featuredPageCount + (currentPage - 2) * PAGE_SIZE + 1
    : (currentPage - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(startIdx + Math.max(0, pageTraders.length - 1), totalVisibleCount);
  const paginationItems = useMemo(() => paginationWindow(currentPage, totalPages), [currentPage, totalPages]);

  useEffect(() => { setPage(1); }, [tab, query, sortBy, period]);'''
s = s[:old_start] + logic + s[old_end:]

old = '''          <div className="market-search-sort">\n            <div className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск трейдеров" /></div>\n            <div className={`sort-button ${sortOpen ? 'sort-open' : ''}`}'''
new = '''          <div className="market-search-sort">\n            <div className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск трейдеров" /></div>\n            {tab !== 'all' && <div className={`sort-button ${sortOpen ? 'sort-open' : ''}`}'''
assert old in s
s = s.replace(old, new, 1)

target = '''            </div>\n          </div>\n        </div>\n\n        <div className="ranking-controls">'''
repl = '''            </div>}\n          </div>\n        </div>\n\n        {tab !== 'all' && <div className="ranking-controls">'''
assert target in s
s = s.replace(target, repl, 1)

target = '''          <div className="period-group">{PERIODS.map((p) => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{PERIOD_LABEL_RU[p]}</button>)}</div>\n        </div>\n        <p className="ranking-copy">Трейдеры с оптимальным соотношением прибыли и риска.</p>'''
repl = '''          <div className="period-group">{PERIODS.map((p) => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{PERIOD_LABEL_RU[p]}</button>)}</div>\n        </div>}\n        {tab !== 'all' && <p className="ranking-copy">Трейдеры с оптимальным соотношением прибыли и риска.</p>}'''
assert target in s
s = s.replace(target, repl, 1)

s = s.replace('''          <span className="results-count">Трейдеров: {visibleTraders.length}</span>''', '''          <span className="results-count">Трейдеров: {totalVisibleCount}</span>''', 1)
s = s.replace('''          ? <LockedTraderList traders={pageTraders} period={period} />''', '''          ? <LockedTraderList traders={pageTraders} />''', 1)

old = '''              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => <button key={p} className={`page-number ${p === currentPage ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>)}'''
new = '''              {paginationItems.map((item) => typeof item === 'number'\n                ? <button key={item} className={`page-number ${item === currentPage ? 'active' : ''}`} onClick={() => setPage(item)}>{item}</button>\n                : <span key={item} className="page-gap" aria-hidden="true">…</span>)}'''
assert old in s
s = s.replace(old, new, 1)

if 'const [detailsReady, setDetailsReady]' not in s:
    marker = """export function Profile({ trader, onBack, synthetic }: { trader: Trader; onBack: () => void; synthetic?: SyntheticCopyTradingResponse | null }) {\n  const [activeTab, setActiveTab] = useState<ProfileTab>('statistics');"""
    assert marker in s
    s = s.replace(marker, """export function Profile({ trader, onBack, synthetic }: { trader: Trader; onBack: () => void; synthetic?: SyntheticCopyTradingResponse | null }) {\n  const [detailsReady, setDetailsReady] = useState(false);\n  const [activeTab, setActiveTab] = useState<ProfileTab>('statistics');""", 1)
    marker = """  const heroFollowers = liveSynthetic ? liveSynthetic.followers.filter(follower => follower.active).length : trader.copiers;\n\n  return ("""
    assert marker in s
    s = s.replace(marker, """  const heroFollowers = liveSynthetic ? liveSynthetic.followers.filter(follower => follower.active).length : trader.copiers;\n\n  useEffect(() => {\n    setDetailsReady(false);\n    let secondFrame = 0;\n    const firstFrame = window.requestAnimationFrame(() => {\n      secondFrame = window.requestAnimationFrame(() => setDetailsReady(true));\n    });\n    return () => { window.cancelAnimationFrame(firstFrame); if (secondFrame) window.cancelAnimationFrame(secondFrame); };\n  }, [trader.id]);\n\n  return (""", 1)
    old = """      {activeTab === 'statistics' ? <>\n        <div className=\"profile-analytics-workspace\">"""
    new = """      {!detailsReady ? <div className=\"profile-detail-loading\" role=\"status\" aria-live=\"polite\"><span>Загрузка аналитики…</span></div> : activeTab === 'statistics' ? <>\n        <div className=\"profile-analytics-workspace\">"""
    assert old in s
    s = s.replace(old, new, 1)

p.write_text(s)

css = Path('frontend/src/pages/copy-trading-bolt/LockedTraderList.css')
c = css.read_text()
c = c.replace('grid-template-columns: minmax(260px, 1.7fr) minmax(110px, .7fr) minmax(110px, .7fr) minmax(120px, .8fr) minmax(120px, .8fr) 52px minmax(118px, .72fr);', 'grid-template-columns: minmax(280px, 1.7fr) minmax(180px, .8fr) minmax(118px, .55fr);')
c = c.replace('  min-height: 74px;', '  min-height: 66px;', 1)
if '.locked-access {' not in c:
    c += '''\n.copytrading-bolt-root .locked-access {\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  color: #aeb4bd;\n  font-size: 12px;\n  white-space: nowrap;\n}\n.copytrading-bolt-root .locked-access svg { color: #ff9f1a; }\n.copytrading-bolt-root .page-gap { color: #707680; padding: 0 4px; font-size: 13px; }\n.copytrading-bolt-root .profile-detail-loading {\n  min-height: 260px;\n  display: grid;\n  place-items: center;\n  color: #7f8792;\n  font-size: 12px;\n  border: 1px solid #20242a;\n  border-radius: 12px;\n  background: #0a0c0f;\n}\n'''
css.write_text(c)
