import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveCatalogueEdge } from './src/lib/depositCatalogueEdge';
import { voltexContent } from './contentPlugin';

// Deposit catalogue activation is chosen at build time and never falls back
// at runtime, so a malformed origin must stop the build rather than ship a
// Deposit dialog that silently reads Render (or nothing).
const depositEdge = process.env.VITE_DEPOSIT_CATALOGUE_URL;
if (process.env.VITE_STOCKS_ENABLED === 'true' && process.env.VITE_STOCKS_WIDGET_PREVIEW !== 'true') {
  const stockOrigin = new URL(process.env.VITE_STOCKS_ORIGIN ?? '');
  if ((stockOrigin.protocol !== 'https:' && !(stockOrigin.protocol === 'http:' && stockOrigin.hostname === '127.0.0.1')) || stockOrigin.username || stockOrigin.password || stockOrigin.search || stockOrigin.hash) throw new Error('Stocks requires a dedicated https origin (loopback allowed for QA)');
}
if (depositEdge !== undefined && depositEdge.trim() !== '' && resolveCatalogueEdge(depositEdge) === null) {
  throw new Error('VITE_DEPOSIT_CATALOGUE_URL must be an https URL (http only for 127.0.0.1) without credentials, query or hash');
}
if (process.env.VITE_MANUAL_DEPOSIT_CATALOGUE === 'true' && !depositEdge?.trim()) {
  console.warn('[deposit] VITE_MANUAL_DEPOSIT_CATALOGUE=true without VITE_DEPOSIT_CATALOGUE_URL: the Deposit dialog reads the catalogue from the API (Render).');
}

export default defineConfig({
  // Academy and Help pages are compiled from frontend/content/ at build time.
  plugins: [react(), ...voltexContent()],
  // The market edge origin (lib/marketEdge.ts). Empty = production default.
  // A compile-time constant rather than import.meta, so modules that read it
  // stay importable from the CommonJS Jest suites.
  define: {
    __VOLTEX_STOCKS_WIDGET_PREVIEW__: process.env.VITE_STOCKS_WIDGET_PREVIEW === 'true',
    __VOLTEX_STOCKS_ENABLED__: process.env.VITE_STOCKS_ENABLED === 'true',
    __VOLTEX_STOCKS_ORIGIN__: JSON.stringify(process.env.VITE_STOCKS_ORIGIN ?? ''),
    __VOLTEX_MARKET_EDGE_URL__: JSON.stringify(process.env.VITE_MARKET_EDGE_URL ?? ''),
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
