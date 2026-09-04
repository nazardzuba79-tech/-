/** @type {import('tailwindcss').Config} */
export default {
  // Scoped to the Arctic Blue Settings/Profile port only — every other page
  // in the app uses hand-rolled inline styles / index.css, so the utility
  // classes Tailwind generates here (and only here, since content only
  // scans these files) never appear anywhere else in the DOM. corePlugins
  // preflight is off on top of that, so no global element reset leaks out
  // to pages that don't opt in by using Tailwind classes.
  // Opt-in areas only. Everything else in the app uses hand-rolled inline
  // styles / index.css, so the utilities generated here appear nowhere else
  // in the DOM, and `preflight: false` below means no global element reset
  // ever leaks to Trade, Futures or Admin.
  //
  // Page entry files are listed alongside their component directories: a
  // page's own responsive grid lives in the entry file, and leaving it out
  // silently drops those classes from the build.
  content: [
    './src/pages/SettingsPage.tsx',
    './src/pages/settings-arctic/**/*.{ts,tsx}',
    './src/pages/home/**/*.{ts,tsx}',
    './src/pages/register/**/*.{ts,tsx}',
    './src/pages/WalletPage.tsx',
    './src/pages/wallet-v3/**/*.{ts,tsx}',
  ],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        // --- Homepage palette (src/pages/home only) ---
        // The approved design's own values. Deliberately literal rather
        // than pointing at CSS custom properties: the homepage is the one
        // surface that must not shift if a terminal token is retuned.
        // The numeric steps are the homepage's dark surfaces; DEFAULT/2/3/4
        // are the Wallet workspace's light text ramp. Different key shapes,
        // so the two palettes coexist in one theme without either shifting.
        ink: {
          DEFAULT: '#111318',
          2: '#3b4351',
          3: '#667085',
          4: '#98a2b3',
          950: '#05070a',
          900: '#080b10',
          880: '#0b0f15',
          860: '#0e131a',
          850: '#121821',
          800: '#171e28',
          // The registration card's own surface, one step above ink-800.
          760: '#1d2531',
        },
        gold: {
          400: '#f0c45a',
          500: '#e0a93f',
          600: '#c08f2f',
          // Wallet workspace gold — the approved V3 values.
          DEFAULT: '#d9a441',
          light: '#e0a93f',
          deep: '#a87a22',
          wash: '#fbf4e6',
        },
        // --- Wallet V3 light workspace (src/pages/wallet-v3 only) ---
        base: '#f6f7f9',
        surface: { 0: '#ffffff', 1: '#f8f9fb' },
        panel: { DEFAULT: '#ffffff', 2: '#fafbfc', 3: '#f2f4f7' },
        hair: { DEFAULT: '#e4e7ec', strong: '#d0d5dd', soft: '#edeff3' },
        pos: '#168a65',
        neg: '#d94a56',
        up: '#2ebd85',
        down: '#f0616d',
        faint: '#5b6675',
        // Hairline used for the registration card's borders and field edges.
        line: '#1b2431',
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
        // Wallet V3.
        panel: '0 1px 2px 0 rgba(16,24,40,0.04)',
        lift: '0 2px 6px -1px rgba(16,24,40,0.07)',
        modal: '0 24px 64px -16px rgba(16,24,40,0.22), 0 2px 6px -1px rgba(16,24,40,0.06)',
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        // Wallet V3's own small radii, under distinct names so the shared
        // scale the homepage/settings/register already use is untouched.
        w: '6px',
        wsm: '4px',
        wlg: '8px',
      },
      fontSize: {
        '2xs': ['10px', '14px'],
      },
      transitionTimingFunction: {
        exp: 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
    },
  },
  plugins: [],
};
