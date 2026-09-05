import { MotionConfig } from 'framer-motion';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { Header } from './crypto-card-final/components/Header';
import { Hero } from './crypto-card-final/components/Hero';
import { PaymentSection } from './crypto-card-final/components/PaymentSection';
import { AtmSection } from './crypto-card-final/components/AtmSection';
import { SubscriptionsSection } from './crypto-card-final/components/SubscriptionsSection';
import { CurrencySection } from './crypto-card-final/components/CurrencySection';
import { HowItWorksSection } from './crypto-card-final/components/HowItWorksSection';
import { GlobalUseSection } from './crypto-card-final/components/GlobalUseSection';
import { ControlSecuritySection } from './crypto-card-final/components/ControlSecuritySection';
import { CardChoiceSection } from './crypto-card-final/components/CardChoiceSection';
import { FeesSection } from './crypto-card-final/components/FeesSection';
import { FaqSection } from './crypto-card-final/components/FaqSection';
import { FinalCtaFooter } from './crypto-card-final/components/FinalCtaFooter';
import './crypto-card-final/crypto-card.css';

/** /card remains behind the existing RequireAuth route. No issuing APIs are invented. */
export function CardPage({ reviewOnly = false }: { reviewOnly?: boolean }) {
  return <>
    <Nav active="/card" />
    <MotionConfig reducedMotion="user">
      <div className="crypto-card-page" lang="ru">
        <Header />
        <main>
          <Hero />
          <PaymentSection />
          <AtmSection />
          <SubscriptionsSection />
          <CurrencySection />
          <HowItWorksSection />
          <GlobalUseSection />
          <ControlSecuritySection />
          <CardChoiceSection />
          <FeesSection />
          <FaqSection />
          <FinalCtaFooter reviewOnly={reviewOnly} />
        </main>
      </div>
    </MotionConfig>
    <Footer />
  </>;
}
