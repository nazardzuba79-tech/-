from pathlib import Path

p=Path('frontend/src/pages/copy-trading-bolt/components.tsx')
s=p.read_text()

old='''  LineChart,\n  Search,'''
new='''  LineChart,\n  LockKeyhole,\n  Search,'''
assert old in s
s=s.replace(old,new,1)

old="import { LiveMetric } from './LiveMetric';\n"
new="import { LiveMetric } from './LiveMetric';\nimport './LockedTraderList.css';\n"
assert old in s
s=s.replace(old,new,1)

marker='''export function Marketplace({ onOpen, nazara = nazarTrader, synthetic, ksenia = kseniaTraderShell, kseniaSynthetic, availability }: { onOpen: (trader: Trader) => void; nazara?: Trader; synthetic?: SyntheticCopyTradingResponse | null; ksenia?: Trader; kseniaSynthetic?: SyntheticCopyTradingResponse | null; availability?: CopyMarketplaceState }) {'''
assert marker in s
locked='''function LockedTraderList({ traders, period }: { traders: Trader[]; period: Period }) {
  const whitelistNotice = (trader: Trader) => toast.warning(
    'Только пользователи из белого списка могут подписаться на этого Мастера трейдинга.',
    { description: `Свяжитесь с Мастером трейдинга ${trader.name}, чтобы получить приглашение.`, duration: 5500 }
  );
  return <>
    <div className="locked-trader-list" role="table" aria-label="Закрытый каталог Мастеров трейдинга">
      <div className="locked-trader-list-head" role="row">
        <span>Мастер трейдинга</span><span>{PERIOD_LABEL_RU[period]} ROI</span><span>Винрейт</span><span>Макс. просадка</span><span>Подписчики</span><span>★</span><span>Действие</span>
      </div>
      {traders.map((trader) => {
        const roi = getRoiForPeriod(trader, period);
        return <div className="locked-trader-row" role="row" key={trader.id} data-trader-id={trader.id}>
          <div className="locked-trader-identity">
            <Avatar trader={trader} />
            <div>
              <div className="locked-trader-name"><span>{trader.name}</span><span className="locked-trader-lock" title="Только по приглашению"><LockKeyhole size={14} /></span></div>
              <div className="locked-trader-subtitle">{trader.strategy} · {trader.region}</div>
            </div>
          </div>
          <div className={`locked-trader-metric ${roiClass(roi)}`}><LiveMetric value={formatPercent(roi)} /></div>
          <div className="locked-trader-metric"><LiveMetric value={formatPercent(trader.winRate)} /></div>
          <div className="locked-trader-metric"><LiveMetric value={formatPercent(trader.drawdown)} /></div>
          <div className="locked-trader-metric"><LiveMetric value={Number.isFinite(trader.copiers) ? Math.round(trader.copiers).toLocaleString('ru-RU') : '—'} /></div>
          <div><FavoriteButton trader={trader} /></div>
          <div className="locked-trader-action"><button className="locked-copy-button" type="button" onClick={() => whitelistNotice(trader)}>Копировать</button></div>
        </div>;
      })}
    </div>
    <p className="locked-list-note">Профили этого каталога закрыты. Подключение доступно только по приглашению Мастера трейдинга.</p>
  </>;
}

'''
s=s.replace(marker,locked+marker,1)

old='''  const currentPage = Math.min(page, totalPages);\n  const pageTraders = visibleTraders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);'''
new='''  const currentPage = Math.min(page, totalPages);\n  const pageTraders = visibleTraders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);\n  // Preserve rich featured cards on leaderboard page 1. The mass catalogue is\n  // lightweight and non-navigable: All Traders uses it immediately, and the\n  // leaderboard switches to it from page 2 onward.\n  const lockedListMode = tab === 'all' || (tab === 'leaderboard' && currentPage > 1);'''
assert old in s
s=s.replace(old,new,1)

old='''        <div className="trader-grid">\n          {pageTraders.map((trader) => <TraderCard key={trader.id} trader={trader} period={period} onOpen={onOpen} synthetic={trader.id === ksenia?.id ? kseniaSynthetic : synthetic} />)}\n        </div>'''
new='''        {lockedListMode\n          ? <LockedTraderList traders={pageTraders} period={period} />\n          : <div className="trader-grid">\n              {pageTraders.map((trader) => <TraderCard key={trader.id} trader={trader} period={period} onOpen={onOpen} synthetic={trader.id === ksenia?.id ? kseniaSynthetic : synthetic} />)}\n            </div>}'''
assert old in s
s=s.replace(old,new,1)

p.write_text(s)
