import type { CSSProperties } from 'react';

/** Shared style tokens for the /admin panel — same visual language as the
 * rest of the exchange (see SettingsPage's own `styles`), just laid out as
 * a sidebar shell instead of a tab strip since this is a separate section,
 * not one more Settings tab. */
// The rest of the exchange is a dark theme (see index.css's --bg etc.), but
// the admin panel reads real client data (emails, addresses, IPs) that's
// easier to scan on a light surface — so every color token below is
// re-pointed at a light palette right here, at the panel's root. Every
// admin page/component below just uses var(--panel)/var(--text-primary)/etc
// same as before; overriding the custom properties on this one ancestor
// element re-themes the whole section without touching each page.
// Palette ported from a Bolt.new admin-dashboard reference the user
// supplied (canvas/ink grays + a brand-indigo accent) — replaces the
// original ad hoc light grays with that exact reference palette. --buy/
// --sell are re-pointed too (were still inheriting the dark theme's neon
// green/pink) to the reference's more muted positive/danger tones.
// --admin-brand* are NEW tokens (not part of the site-wide theme) for the
// reference's indigo CTA/active-nav color specifically — kept separate
// from --accent because --accent already carries "pending/attention"
// meaning across the KYC/withdrawal status badges below, and repointing
// it to indigo would have made every "pending" badge read as brand-colored
// instead of amber.
const LIGHT_THEME_VARS = {
  '--bg': '#f7f8fa',
  '--panel': '#ffffff',
  '--panel-alt': '#f2f4f7',
  '--panel-alt-hover': '#eaecf0',
  '--border': '#eaecf0',
  '--text-primary': '#0f1115',
  '--text-secondary': '#5b6472',
  '--text-tertiary': '#7a8493',
  '--neutral-dim': '#f2f4f7',
  '--buy': '#039855',
  '--buy-dim': '#ecfdf3',
  '--sell': '#d92d20',
  '--sell-dim': '#fef3f2',
  '--admin-brand': '#4f46e5',
  '--admin-brand-hover': '#4338ca',
  '--admin-brand-dim': '#eef0ff',
  '--admin-brand-on': '#ffffff',
} as CSSProperties;

export const styles: Record<string, CSSProperties> = {
  loadingScreen: { minHeight: '100vh', background: '#ffffff' },
  // `color` is set explicitly here (not just the --text-* variables) because
  // index.css's `body { color: var(--text-primary) }` resolves against the
  // ORIGINAL dark-theme value at body's own scope — a descendant redefining
  // the variable doesn't retroactively change what body already inherited
  // down. Declaring `color` fresh at this root re-anchors inheritance for
  // every child element that doesn't set its own color (table cell text,
  // etc.), which is most of them.
  // fontWeight 500 here (not the browser default 400) is the other half of
  // the same inheritance trick as `color` above — cell text that sets no
  // weight of its own (most of it) now reads as a normal, legible medium
  // weight instead of thin default text on a plain white background.
  page: { ...LIGHT_THEME_VARS, minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-primary)', fontWeight: 500, display: 'grid', gridTemplateColumns: '260px 1fr' },
  sidebar: {
    background: 'var(--panel)',
    borderRight: '1px solid var(--border)',
    padding: '0 12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    position: 'sticky',
    top: 0,
    height: '100vh',
  },
  sidebarBrandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 8px',
    height: 64,
    borderBottom: '1px solid var(--border)',
    marginBottom: 16,
  },
  sidebarBrandMark: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 10,
    background: 'var(--admin-brand)',
    color: 'var(--admin-brand-on)',
    flex: 'none',
  },
  sidebarTitle: {
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: '-0.01em',
    lineHeight: 1.25,
  },
  sidebarSubtitle: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-tertiary)',
  },
  sidebarSectionLabel: {
    padding: '0 12px 8px',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-tertiary)',
  },
  backToExchange: {
    textDecoration: 'none',
    color: 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: 600,
    padding: '8px 12px',
    margin: '0 0 16px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    display: 'block',
  },
  nav: { display: 'flex', flexDirection: 'column', gap: 2 },
  navItem: {
    textDecoration: 'none',
    color: 'var(--text-secondary)',
    fontSize: 13.5,
    fontWeight: 600,
    padding: '10px 12px',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  navItemActive: {
    fontWeight: 700,
  },
  navItemPip: {
    marginLeft: 'auto',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--admin-brand)',
  },
  soundToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 12px',
    fontSize: 12,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  main: { padding: '32px 40px', maxWidth: 1280, minWidth: 0 },
  title: { fontSize: 24, marginBottom: 4, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.02em' },
  subtitle: { fontSize: 14, color: 'var(--text-tertiary)', margin: '0 0 22px' },
  card: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    boxShadow: '0 1px 2px 0 rgba(16,24,40,0.04), 0 1px 3px 0 rgba(16,24,40,0.05)',
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  table: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    boxShadow: '0 1px 2px 0 rgba(16,24,40,0.04), 0 1px 3px 0 rgba(16,24,40,0.05)',
    overflow: 'hidden',
    overflowX: 'auto',
  },
  tableHeader: {
    display: 'grid',
    padding: '12px 16px',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-tertiary)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    background: 'var(--panel-alt)',
    borderBottom: '1px solid var(--border)',
    gap: 8,
  },
  tableRow: {
    display: 'grid',
    padding: '13px 16px',
    fontSize: 14,
    lineHeight: 1.4,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
    gap: 8,
  },
  row: { display: 'flex', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid var(--border)' },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    color: 'var(--text-primary)',
    fontWeight: 500,
    fontSize: 14,
  },
  hint: { fontSize: 12, color: 'var(--text-tertiary)' },
  errorBox: { background: 'var(--sell-dim)', color: 'var(--sell)', padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600 },
  successBox: { background: 'var(--buy-dim)', color: 'var(--buy)', padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600 },
  primaryBtn: {
    background: 'var(--admin-brand)',
    color: 'var(--admin-brand-on)',
    border: 'none',
    borderRadius: 8,
    padding: '9px 18px',
    fontWeight: 700,
    fontSize: 13.5,
    cursor: 'pointer',
  },
  approveBtn: {
    background: 'var(--buy)',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 16px',
    fontWeight: 700,
    fontSize: 12.5,
    cursor: 'pointer',
  },
  rejectBtn: {
    background: 'transparent',
    color: 'var(--sell)',
    border: '1px solid var(--sell)',
    borderRadius: 8,
    padding: '8px 16px',
    fontWeight: 700,
    fontSize: 12.5,
    cursor: 'pointer',
  },
  neutralBtn: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 16px',
    fontWeight: 600,
    fontSize: 12.5,
    cursor: 'pointer',
  },
  badgeDim: { color: 'var(--text-secondary)', background: 'var(--neutral-dim)' },
  badgeAccent: { color: 'var(--accent)', background: 'var(--accent-dim)' },
  badgeBuy: { color: 'var(--buy)', background: 'var(--buy-dim)' },
  badgeSell: { color: 'var(--sell)', background: 'var(--sell-dim)' },

  // Stat-card row (Users page KPI strip — total/verified/active/pending).
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 },
  statCard: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    boxShadow: '0 1px 2px 0 rgba(16,24,40,0.04), 0 1px 3px 0 rgba(16,24,40,0.05)',
    padding: 20,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statLabel: { fontSize: 13, fontWeight: 500, color: 'var(--text-tertiary)' },
  statValue: { fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em', marginTop: 4 },
  statSub: { fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 },

  // Search + filter bar.
  searchBarRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 16 },
  searchInputWrap: { position: 'relative', flex: '1 1 260px', maxWidth: 380 },
  searchInputIcon: { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' },
  searchInput: {
    width: '100%',
    height: 40,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--panel)',
    padding: '0 12px 0 34px',
    fontSize: 14,
    color: 'var(--text-primary)',
  },
  filterBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    height: 40,
    padding: '0 14px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--panel)',
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  filterBtnActive: {
    borderColor: 'var(--admin-brand-dim)',
    background: 'var(--admin-brand-dim)',
    color: 'var(--admin-brand)',
  },
  filterMenu: {
    position: 'absolute',
    right: 0,
    top: '110%',
    zIndex: 20,
    minWidth: 170,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: '0 12px 16px -4px rgba(16,24,40,0.08), 0 4px 6px -2px rgba(16,24,40,0.03)',
    padding: 4,
  },
  filterMenuItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: 6,
    fontSize: 13,
    color: 'var(--text-secondary)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
  },
  filterMenuItemActive: { background: 'var(--admin-brand-dim)', color: 'var(--admin-brand)', fontWeight: 600 },

  // Row actions dropdown + user avatar.
  actionsMenuBtn: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    color: 'var(--text-tertiary)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 700,
    flex: 'none',
  },

  // Pagination.
  paginationRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  pageBtn: {
    height: 32,
    minWidth: 32,
    padding: '0 8px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--panel)',
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  pageBtnActive: { background: 'var(--admin-brand)', borderColor: 'var(--admin-brand)', color: 'var(--admin-brand-on)' },

  // Slide-in detail drawer.
  drawerOverlay: { position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,17,21,0.3)' },
  drawerPanel: {
    position: 'fixed',
    right: 0,
    top: 0,
    zIndex: 51,
    height: '100vh',
    width: 'min(100%, 440px)',
    background: 'var(--panel)',
    boxShadow: '-12px 0 32px -12px rgba(16,24,40,0.18)',
    display: 'flex',
    flexDirection: 'column',
  },
  drawerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: 64, borderBottom: '1px solid var(--border)', flex: 'none' },
  drawerBody: { flex: 1, overflowY: 'auto', padding: '20px 20px 24px' },
  drawerFooter: { flex: 'none', borderTop: '1px solid var(--border)', padding: 16, display: 'grid', gap: 8 },
  drawerSectionLabel: { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '20px 0 10px' },

  // Toasts.
  toastStack: { position: 'fixed', bottom: 20, right: 20, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 8 },
  toast: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--panel)',
    boxShadow: '0 12px 16px -4px rgba(16,24,40,0.08), 0 4px 6px -2px rgba(16,24,40,0.03)',
    fontSize: 13,
    fontWeight: 500,
  },
};
