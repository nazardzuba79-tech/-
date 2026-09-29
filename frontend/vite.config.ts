import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The market edge origin (lib/marketEdge.ts). Empty = production default.
  // A compile-time constant rather than import.meta, so modules that read it
  // stay importable from the CommonJS Jest suites.
  define: {
    __VOLTEX_MARKET_EDGE_URL__: JSON.stringify(process.env.VITE_MARKET_EDGE_URL ?? ''),
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
