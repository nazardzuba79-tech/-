import type { CapacitorConfig } from '@capacitor/cli';

// Wraps the same React app the website already runs — no separate mobile
// codebase to maintain. Bundles the built dist/ output into the app (so
// the UI itself loads instantly, offline-shell style) while every API
// call still goes out to the real backend, same as the website — see
// src/lib/api.ts's baseUrl.
const config: CapacitorConfig = {
  appId: 'com.voltex.exchange',
  appName: 'VOLTEX',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
