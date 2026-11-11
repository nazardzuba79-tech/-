import { ExternalLink } from 'lucide-react';
import type { Offer } from '../../../../src/shared/exchangers/types';
import { OUTBOUND_LINK, offerAction } from './model';

export const EXCHANGER_NOTE = 'Откроется сайт обменника через BestChange. Условия, проверку личности и комиссии устанавливает обменник.';
export const DIRECTION_NOTE = 'Откроется страница направления на BestChange со списком обменников.';

/**
 * The offer's outbound link. The URL is re-checked here (model.offerAction):
 * «Перейти к обменнику» only for this exchanger's BestChange click link,
 * «Выбрать на BestChange» to the direction page otherwise. Nothing of the
 * visitor's (token, account, deposit address) is ever added to either.
 */
export function OfferAction({ offer, directionUrl, highlighted }: { offer: Offer; directionUrl: string | null; highlighted?: boolean }) {
  const action = offerAction(offer, directionUrl);
  if (action.kind === 'none') {
    return (
      <div className="vx-ex-action">
        <span className="vx-ex-btn vx-ex-btn--ghost is-disabled" aria-disabled="true">Ссылка недоступна</span>
        <span className="vx-ex-action-note">BestChange не передал ссылку для этого предложения.</span>
      </div>
    );
  }
  const exchanger = action.kind === 'exchanger';
  return (
    <div className="vx-ex-action">
      <a
        href={action.href}
        target={OUTBOUND_LINK.target}
        rel={OUTBOUND_LINK.rel}
        referrerPolicy={OUTBOUND_LINK.referrerPolicy}
        className={`vx-ex-btn ${highlighted ? 'vx-ex-btn--primary' : 'vx-ex-btn--outline'}`}
      >
        {exchanger ? 'Перейти к обменнику' : 'Выбрать на BestChange'}
        <ExternalLink size={14} aria-hidden="true" />
        <span className="vx-ex-sr">{`${offer.exchanger.name}, откроется в новой вкладке`}</span>
      </a>
      <span className="vx-ex-action-note">{exchanger ? EXCHANGER_NOTE : DIRECTION_NOTE}</span>
    </div>
  );
}
