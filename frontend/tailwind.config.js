/** @type {import('tailwindcss').Config} */
export default {
  // Scoped to the Arctic Blue Settings/Profile port only — every other page
  // in the app uses hand-rolled inline styles / index.css, so the utility
  // classes Tailwind generates here (and only here, since content only
  // scans these files) never appear anywhere else in the DOM. corePlugins
  // preflight is off on top of that, so no global element reset leaks out
  // to pages that don't opt in by using Tailwind classes.
  content: ['./src/pages/SettingsPage.tsx', './src/pages/settings-arctic/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
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
