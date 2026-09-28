import ReactDOM from 'react-dom/client';
import { LanguageProvider } from '../lib/i18n';
import { ReviewApp } from './ReviewApp';
import '../index.css';
import '../pages/trade-terminal/TradeTerminal.css';
import './review.css';

export function mount() {
  ReactDOM.createRoot(document.getElementById('root')!).render(<LanguageProvider><ReviewApp /></LanguageProvider>);
}
