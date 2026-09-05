import type { CardCopy } from './cardCopy.ru';
export function getCardFaq(c: CardCopy) {
  return [
    { question: c.faqAccessQ, answer: c.faqAccessA },
    { question: c.faqEligibilityQ, answer: c.eligibilityLead },
    { question: c.faqDifferenceQ, answer: c.faqDifferenceA },
    { question: c.faqFeesQ, answer: c.freeBoth },
    { question: c.faqCashbackQ, answer: c.faqCashbackA },
    { question: c.faqSubscriptionsQ, answer: c.faqSubscriptionsA },
    { question: c.faqUseQ, answer: c.globalLead },
  ];
}
