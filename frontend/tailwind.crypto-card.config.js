/** The approved archive's own utility layer. Never scans or restyles other pages. */
export default {
  content: ['./src/pages/crypto-card-final/**/*.{ts,tsx}'],
  prefix: 'vc-',
  important: '.crypto-card-page',
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: { voltex: {
        black: '#0A0A0B', panel: '#111218', panel2: '#17181F',
        line: 'rgba(255,255,255,.09)', lineStrong: 'rgba(255,255,255,.16)',
        text: '#F5F4EF', muted: '#B0B4BD', mutedDark: '#8E9199',
        gold: '#C9A24B', goldLight: '#E6C878', goldSoft: 'rgba(201,162,75,.14)',
        cream: '#F6F3EC', creamPanel: '#FFFFFF', creamText: '#15151A', creamMuted: '#3F3E3A',
      } },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], display: ['Fraunces', 'Georgia', 'serif'] },
      letterSpacing: { wide2: '.14em', wide3: '.22em' },
      boxShadow: {
        card: '0 30px 80px -20px rgba(0,0,0,.55)',
        goldGlow: '0 0 0 1px rgba(201,162,75,.25), 0 20px 60px -10px rgba(201,162,75,.18)',
      },
      // Two opacity stops used by the archive, not in Tailwind's default scale.
      opacity: { 12: '.12', 45: '.45' },
    },
  },
  plugins: [],
};
