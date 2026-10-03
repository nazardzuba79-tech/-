// Local fixture only: not an application route or a production build entry.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/lib/i18n';
import { Nav } from '../src/components/Nav';
import { HomeHeader } from '../src/pages/home/HomeHeader';
import '../src/index.css';
import '../src/pages/home/home.css';
import '../src/pages/home/home-tailwind-utilities.css';

const home = new URLSearchParams(location.search).has('home');
const terminal = new URLSearchParams(location.search).has('terminal');
createRoot(document.getElementById('root')!).render(
  <LanguageProvider><BrowserRouter>
    {home ? <div className="vx-home"><HomeHeader/></div> : terminal ? <div className="trade-terminal terminal-studio futures-reference"><Nav active="/futures" hideTicker quoteAsset="USDT"/></div> : <Nav active="/tools" hideTicker quoteAsset="USDT"/>}
    <main style={{ padding: 24, color: '#a3adbc' }}>VOLTEX · Navigation preview</main>
  </BrowserRouter></LanguageProvider>,
);
