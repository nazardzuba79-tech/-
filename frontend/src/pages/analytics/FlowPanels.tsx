import type { AnalyticsSnapshot, GatewaySection } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { Metric, formatQuantity, formatSignedPercent, formatUsd } from './presentation';
import { Panel, StatRow, Tone } from './approvedPrimitives';
import { valueOf } from './approvedData';

type EtfFlowPoint = { timestamp: number; flowUsd: number; priceUsd: number | null; funds: { ticker: string; flowUsd: number }[] };
type EtfFlowsValue = { baseAsset: string; points: EtfFlowPoint[] };
type ExchangeBalanceRow = {
  exchange: string; totalBalance: number; change1d: number | null; changePercent1d: number | null;
  change7d: number | null; changePercent7d: number | null; change30d: number | null; changePercent30d: number | null;
};
type ExchangeFlowsValue = {
  baseAsset: string; rows: ExchangeBalanceRow[]; aggregateChange1d: number | null;
  aggregateChange7d: number | null; aggregateChange30d: number | null;
};
type WhaleTransferEvent = {
  transactionHash: string; amountUsd: number; assetQuantity: number | null; assetSymbol: string;
  from: string; to: string; blockchain: string; observedAt: number;
};
type WhaleActivityValue = { baseAsset: string; windowHours: 24; eventCount: number; totalUsd: number; events: WhaleTransferEvent[] };
type PremiumSnapshot = AnalyticsSnapshot & {
  sections: AnalyticsSnapshot['sections'] & {
    etfFlows?: GatewaySection<EtfFlowsValue>;
    exchangeFlows?: GatewaySection<ExchangeFlowsValue>;
    whaleActivity?: GatewaySection<WhaleActivityValue>;
  };
};

function compactAddress(value: string) {
  if (value.length <= 24) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function day(value: number) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function sumLast(points: EtfFlowPoint[], days: number): number | null {
  if (!points.length) return null;
  const rows = points.slice(-days);
  return rows.length ? rows.reduce((sum, point) => sum + point.flowUsd, 0) : null;
}

export function CapitalFlowPanels({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { lang, t } = useLanguage();
  const premium = snapshot as PremiumSnapshot | null;
  const etfSection = premium?.sections.etfFlows;
  const exchangeSection = premium?.sections.exchangeFlows;
  const whaleSection = premium?.sections.whaleActivity;
  const hasAny = Boolean(etfSection?.available || exchangeSection?.available || whaleSection?.available);
  if (!hasAny) return null;

  const etf = valueOf(etfSection);
  const exchange = valueOf(exchangeSection);
  const whale = valueOf(whaleSection);
  const title = lang === 'ru' ? 'Потоки капитала и on-chain' : 'Capital flows & on-chain';

  return <>
    <div className="ap-section-label"><h2>{title}</h2><span>{snapshot?.selectedAsset ?? ''}</span></div>
    <div className="ap-grid ap-grid-3">
      {etfSection?.available && etf ? <Panel title={t('analytics.etfFlows')} section={etfSection}>
        <div className="ap-metrics-3">
          <Metric label={lang === 'ru' ? 'Последний день' : 'Latest day'} value={formatUsd(etf.points.at(-1)?.flowUsd)} />
          <Metric label="7D" value={formatUsd(sumLast(etf.points, 7))} />
          <Metric label="30D" value={formatUsd(sumLast(etf.points, 30))} />
        </div>
        <div className="ap-table-scroll"><table><thead><tr><th>{lang === 'ru' ? 'Дата' : 'Date'}</th><th>{lang === 'ru' ? 'Поток' : 'Flow'}</th><th>{lang === 'ru' ? 'Цена' : 'Price'}</th></tr></thead>
          <tbody>{etf.points.slice(-7).reverse().map(point => <tr key={point.timestamp}><td>{day(point.timestamp)}</td><td><Tone value={point.flowUsd}>{formatUsd(point.flowUsd)}</Tone></td><td>{formatUsd(point.priceUsd)}</td></tr>)}</tbody></table></div>
      </Panel> : null}

      {exchangeSection?.available && exchange ? <Panel title={lang === 'ru' ? 'Изменение резервов бирж' : 'Exchange balance changes'} section={exchangeSection}>
        <div className="ap-metrics-3">
          <Metric label="1D" value={exchange.aggregateChange1d == null ? null : `${formatQuantity(exchange.aggregateChange1d)} ${exchange.baseAsset}`} />
          <Metric label="7D" value={exchange.aggregateChange7d == null ? null : `${formatQuantity(exchange.aggregateChange7d)} ${exchange.baseAsset}`} />
          <Metric label="30D" value={exchange.aggregateChange30d == null ? null : `${formatQuantity(exchange.aggregateChange30d)} ${exchange.baseAsset}`} />
        </div>
        {exchange.rows.slice(0, 6).map(row => <StatRow key={row.exchange} label={row.exchange}
          value={<span>{formatQuantity(row.totalBalance)} {exchange.baseAsset} · <Tone value={row.changePercent1d}>{formatSignedPercent(row.changePercent1d)}</Tone></span>} />)}
      </Panel> : null}

      {whaleSection?.available && whale ? <Panel title={t('analytics.whaleActivity')} section={whaleSection}>
        <div className="ap-metrics-3">
          <Metric label="24H" value={formatUsd(whale.totalUsd)} />
          <Metric label={lang === 'ru' ? 'Транзакции' : 'Transfers'} value={formatQuantity(whale.eventCount)} />
          <Metric label={lang === 'ru' ? 'Крупнейшая' : 'Largest'} value={formatUsd(Math.max(0, ...whale.events.map(event => event.amountUsd)))} />
        </div>
        <div className="ap-table-scroll"><table><thead><tr><th>{lang === 'ru' ? 'Сумма' : 'Value'}</th><th>{lang === 'ru' ? 'Откуда' : 'From'}</th><th>{lang === 'ru' ? 'Куда' : 'To'}</th></tr></thead>
          <tbody>{whale.events.slice(0, 6).map(event => <tr key={event.transactionHash}><td><strong>{formatUsd(event.amountUsd)}</strong><small className="ap-cell-note">{event.blockchain}</small></td><td>{compactAddress(event.from)}</td><td>{compactAddress(event.to)}</td></tr>)}</tbody></table></div>
      </Panel> : null}
    </div>
  </>;
}
