import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { LanguageProvider, LANGUAGES, useLanguage } from '../../src/lib/i18n';
import { LicencesContent } from '../../src/pages/licenses/LicencesPage';
import { reviewDocuments } from './reviewDocuments';
import '../../src/index.css';

// Separate Vite dev entry, intentionally absent from production build inputs.
// Production contains neither these candidate records nor the source collage.
function Review() {
  const { lang, setLang } = useLanguage();
  return <div className="licences-page"><nav style={{ padding: '20px 32px', display: 'flex', gap: 12, flexWrap: 'wrap' }} aria-label="Language">{LANGUAGES.map(language => <button key={language.code} type="button" style={{ minHeight:44, padding:'0 12px', border:'1px solid #394557', borderRadius:6, background:'#0e141e', color:lang === language.code ? '#e4cf9f' : '#aeb8c6' }} aria-pressed={lang === language.code} onClick={() => setLang(language.code)}>{language.label}</button>)}</nav><LicencesContent documents={reviewDocuments} review /></div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><LanguageProvider><BrowserRouter><Review /></BrowserRouter></LanguageProvider></React.StrictMode>);
