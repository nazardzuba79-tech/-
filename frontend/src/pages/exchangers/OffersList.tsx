import type { ReactNode } from 'react';
import { Crown } from 'lucide-react';
import { formatCrypto, formatRub } from '../../../../src/shared/exchangers/amount';
import type { AssetId, Offer } from '../../../../src/shared/exchangers/types';
import { ExchangerMonogram } from './AssetGlyph';
import { OfferAction } from './OfferAction';
import { MARK_INFO, UNKNOWN, displayDecimals, formatCount, formatLimits, formatReserve, rateDecimals, reserveCovers } from './model';

function Unknown() {
  return <span className="vx-ex-unknown">{UNKNOWN}</span>;
}

function ExchangerName({ offer, best }: { offer: Offer; best: boolean }) {
  return (
    <div className="vx-ex-name">
      <ExchangerMonogram name={offer.exchanger.name} />
      <div>
        <p className="vx-ex-name-title" title={offer.exchanger.name}>{offer.exchanger.name}</p>
        {best ? (
          <span className="vx-ex-best"><Crown size={12} aria-hidden="true" />Лучший курс с учётом комиссий</span>
        ) : (
          <p className="vx-ex-muted">
            {offer.exchanger.rating !== null ? `Рейтинг BestChange: ${formatCount(offer.exchanger.rating)}` : 'Рейтинг: нет данных'}
          </p>
        )}
      </div>
    </div>
  );
}

function Rate({ offer, assetId }: { offer: Offer; assetId: AssetId }) {
  return (
    <div className="vx-ex-num">
      <p className="vx-ex-strong">{formatRub(offer.rubPerUnit, rateDecimals(offer.rubPerUnit))}</p>
      <p className="vx-ex-muted">{`за 1 ${assetId}`}</p>
      <p className="vx-ex-muted">
        {offer.rankRubPerUnit !== null
          ? `с комиссиями: ${formatRub(offer.rankRubPerUnit, rateDecimals(offer.rankRubPerUnit))}`
          : `с комиссиями: ${UNKNOWN.toLowerCase()}`}
      </p>
    </div>
  );
}

function Receive({ offer, assetId }: { offer: Offer; assetId: AssetId }) {
  if (offer.receiveAmount === null) return <Unknown />;
  return (
    <div className="vx-ex-num">
      <p className="vx-ex-strong">{formatCrypto(offer.receiveAmount, displayDecimals(assetId), assetId)}</p>
      <p className="vx-ex-muted">по основному курсу, без доп. комиссий</p>
    </div>
  );
}

function Reserve({ offer, assetId }: { offer: Offer; assetId: AssetId }) {
  if (offer.reserve === null) return <Unknown />;
  const covers = reserveCovers(offer);
  return (
    <div className="vx-ex-num">
      <p>{`${formatReserve(offer.reserve, assetId)} ${assetId}`}</p>
      {covers === false && <p className="vx-ex-bad">меньше суммы обмена</p>}
    </div>
  );
}

function Limits({ offer }: { offer: Offer }) {
  if (offer.minRub === null && offer.maxRub === null) return <Unknown />;
  return (
    <div className="vx-ex-num">
      <p>{formatLimits(offer.minRub, offer.maxRub)}</p>
      {offer.fitsAmount === false && <p className="vx-ex-bad">сумма вне лимитов</p>}
      {offer.fitsAmount === null && <p className="vx-ex-muted">лимиты указаны не полностью</p>}
    </div>
  );
}

function Reviews({ offer }: { offer: Offer }) {
  const r = offer.exchanger.reviews;
  if (!r) return <Unknown />;
  return (
    <p className="vx-ex-num vx-ex-reviews" title="Положительные / нейтральные / жалобы">
      <span className="vx-ex-good">{formatCount(r.positive)}</span>
      <span className="vx-ex-muted"> / </span>
      <span className="vx-ex-muted">{formatCount(r.neutral)}</span>
      <span className="vx-ex-muted"> / </span>
      <span className={r.claim > 0 ? 'vx-ex-bad' : 'vx-ex-muted'}>{formatCount(r.claim)}</span>
      <span className="vx-ex-sr"> — положительные, нейтральные отзывы и жалобы</span>
    </p>
  );
}

function Tag({ children, caution, title }: { children: ReactNode; caution?: boolean; title?: string }) {
  return <span title={title} className={`vx-ex-tag${caution ? ' is-caution' : ''}`}>{children}</span>;
}

function Conditions({ offer }: { offer: Offer }) {
  if (offer.marks.length === 0) return <span className="vx-ex-muted">Без отметок</span>;
  return (
    <div className="vx-ex-tags">
      {offer.marks.map((mark) => (
        <Tag key={mark} caution={MARK_INFO[mark].tone === 'caution'} title={MARK_INFO[mark].description}>
          {MARK_INFO[mark].label}
        </Tag>
      ))}
    </div>
  );
}

const COLUMNS = ['Обменник', 'Курс', 'Вы получите', 'Резерв', 'Лимиты', 'Отзывы', 'Условия'] as const;

interface Props {
  offers: Offer[];
  assetId: AssetId;
  bestOfferId: string | null;
  directionUrl: string | null;
}

/** Table on wide screens, vertical cards below 1024 px (v0 offers-list). */
export function OffersList({ offers, assetId, bestOfferId, directionUrl }: Props) {
  return (
    <>
      <div className="vx-ex-card vx-ex-table-wrap">
        <table className="vx-ex-table">
          <caption className="vx-ex-sr">Предложения обменников</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => <th key={c} scope="col">{c}</th>)}
              <th scope="col"><span className="vx-ex-sr">Переход</span></th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => {
              const best = offer.id === bestOfferId;
              return (
                <tr key={offer.id} className={best ? 'is-best' : undefined}>
                  <td><ExchangerName offer={offer} best={best} /></td>
                  <td><Rate offer={offer} assetId={assetId} /></td>
                  <td><Receive offer={offer} assetId={assetId} /></td>
                  <td><Reserve offer={offer} assetId={assetId} /></td>
                  <td><Limits offer={offer} /></td>
                  <td><Reviews offer={offer} /></td>
                  <td><Conditions offer={offer} /></td>
                  <td><OfferAction offer={offer} directionUrl={directionUrl} highlighted={best} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="vx-ex-cards" aria-label="Предложения обменников">
        {offers.map((offer) => {
          const best = offer.id === bestOfferId;
          return (
            <li key={offer.id} className={`vx-ex-card vx-ex-offer${best ? ' is-best' : ''}`}>
              <ExchangerName offer={offer} best={best} />
              <div className="vx-ex-offer-main">
                <div>
                  <p className="vx-ex-cell-label">Вы получите</p>
                  <Receive offer={offer} assetId={assetId} />
                </div>
                <div>
                  <p className="vx-ex-cell-label">Курс</p>
                  <Rate offer={offer} assetId={assetId} />
                </div>
              </div>
              <dl className="vx-ex-offer-facts">
                <div>
                  <dt>Резерв</dt>
                  <dd><Reserve offer={offer} assetId={assetId} /></dd>
                </div>
                <div>
                  <dt>Отзывы</dt>
                  <dd><Reviews offer={offer} /></dd>
                </div>
                <div className="is-wide">
                  <dt>Лимиты</dt>
                  <dd><Limits offer={offer} /></dd>
                </div>
                <div className="is-wide">
                  <dt>Условия</dt>
                  <dd><Conditions offer={offer} /></dd>
                </div>
              </dl>
              <OfferAction offer={offer} directionUrl={directionUrl} highlighted={best} />
            </li>
          );
        })}
      </ul>
      <p className="vx-ex-footnote">
        Отзывы: положительные / нейтральные / жалобы. Комиссия сети за вывод монет в курс может не входить, итоговую сумму
        обменник подтверждает в заявке.
      </p>
    </>
  );
}
