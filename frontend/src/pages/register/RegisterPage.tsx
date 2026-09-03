import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { useLanguage } from '../../lib/i18n';
import { RegisterVisual } from './RegisterVisual';
import { RegisterPanel } from './RegisterPanel';
import './register.css';

/**
 * /register — the approved two-column registration screen.
 *
 * Left: institutional atmosphere and a restrained product fragment on live
 * market data. Right: the form. Below lg the visual column drops entirely
 * and the form takes the full width, which is the only thing a phone
 * visitor is here for.
 *
 * The language control is the app's own LanguageSwitcher wired to the real
 * seven-language dictionary, not the prototype's RU/EN <select>, which
 * changed its own value and nothing else.
 */
export function RegisterPage() {
  const { t } = useLanguage();

  return (
    <div className="vx-register flex min-h-screen w-full flex-col">
      <header className="relative z-10 flex items-center gap-4 border-b border-white/6 px-5 py-3.5 sm:px-8">
        <Link to="/" aria-label={t('register.backHomeAria')}>
          <Logo />
        </Link>
        <div className="ml-auto flex items-center gap-4">
          <span className="hidden text-[12px] text-home-muted sm:inline">{t('register.haveAccount')}</span>
          <Link
            to="/login"
            className="whitespace-nowrap text-[12.5px] font-medium text-gold-400 transition-colors duration-150 ease-out hover:text-gold-500"
          >
            {t('auth.login')}
          </Link>
          <LanguageSwitcher variant="pill" />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,52fr)_minmax(0,48fr)]">
        <RegisterVisual />

        <div className="relative flex flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:py-12">
          {/* Below lg the visual column is gone, so the form column carries
              a single soft wash of its own rather than sitting on flat
              black. */}
          <div
            aria-hidden="true"
            className="vx-breathe pointer-events-none absolute -left-[24%] -top-[6%] h-[420px] w-[520px] bg-[radial-gradient(50%_50%_at_50%_50%,rgba(30,62,116,0.30),transparent_70%)] lg:hidden"
          />

          <div className="relative w-full max-w-[430px]">
            <RegisterPanel />
            <Link
              to="/"
              className="mt-6 inline-flex items-center gap-1.5 text-[11.5px] text-faint transition-colors duration-150 ease-out hover:text-white"
            >
              <ArrowLeftIcon size={12} />
              {t('register.backHome')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
