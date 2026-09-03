/** @type {import('tailwindcss').Config} */
export default {
  // Scoped to the Arctic Blue Settings/Profile port only — every other page
  // in the app uses hand-rolled inline styles / index.css, so the utility
  // classes Tailwind generates here (and only here, since content only
  // scans these files) never appear anywhere else in the DOM. corePlugins
  // preflight is off on top of that, so no global element reset leaks out
  // to pages that don't opt in by using Tailwind classes.
  // Two opt-in areas only. Everything else in the app uses hand-rolled
  // inline styles / index.css, so the utilities generated here appear
  // nowhere else in the DOM, and `preflight: false` below means no global
  // element reset ever leaks to Trade, Futures, Admin or Wallet.
  content: [
    './src/pages/SettingsPage.tsx',
    './src/pages/settings-arctic/**/*.{ts,tsx}',
    './src/pages/home/**/*.{ts,tsx}',
  ],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        // --- Homepage palette (src/pages/home only) ---
        // The approved design's own values. Deliberately literal rather
        // than pointing at CSS custom properties: the homepage is the one
        // surface that must not shift if a terminal token is retuned.
        ink: {
          950: '#05070a',
          900: '#080b10',
          880: '#0b0f15',
          860: '#0e131a',
          850: '#121821',
          800: '#171e28',
        },
        gold: {
          400: '#f0c45a',
          500: '#e0a93f',
          600: '#c08f2f',
        },
        up: '#2ebd85',
        down: '#f0616d',
        faint: '#5b6675',
        // Same names shadcn/the archive uses, pointed at the CSS custom
        // properties SettingsPage.tsx already scopes via ARCTIC_THEME_VARS
        // — one set of values, two consumers (existing inline styles +
        // these Tailwind utilities).
        border: 'var(--border)',
        background: 'var(--bg)',
        card: 'var(--panel)',
        foreground: 'var(--text-primary)',
        'muted-foreground': 'var(--text-tertiary)',
        muted: 'var(--panel-alt)',
        'home-muted': '#8b97a8',
        secondary: 'var(--panel-alt)',
        'primary-foreground': 'var(--on-accent)',
        brand: 'var(--accent)',
        'brand-soft': 'var(--accent-dim)',
        // Distinct from --buy/--buy-dim on purpose: those drive the live
        // trading UI (order book, ticker up-color) site-wide and must stay
        // untouched; these two are the archive's own success/warning
        // tokens (oklch values copied verbatim from its globals.css),
        // used only for badges/icons on this page.
        success: 'var(--success)',
        'success-soft': 'var(--success-soft)',
        warning: 'var(--warning)',
        'warning-soft': 'var(--warning-soft)',
        danger: 'var(--sell)',
        'danger-soft': 'var(--sell-dim)',
      },
      boxShadow: {
        premium: 'var(--shadow-sm)',
        'premium-lg': 'var(--shadow-md)',
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
      },
    },
  },
  plugins: [],
};
