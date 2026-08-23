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
const LIGHT_THEME_VARS = {
  '--bg': '#ffffff',
  '--panel': '#ffffff',
  '--panel-alt': '#f3f4f6',
  '--panel-alt-hover': '#e9eaed',
  '--border': '#e3e5e9',
  '--text-primary': '#14171d',
  '--text-secondary': '#4b5563',
  '--text-tertiary': '#6b7280',
  '--neutral-dim': 'rgba(20, 23, 29, 0.06)',
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
  page: { ...LIGHT_THEME_VARS, minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-primary)', fontWeight: 500, display: 'grid', gridTemplateColumns: '220px 1fr' },
  sidebar: {
    background: 'var(--panel-alt)',
    borderRight: '1px solid var(--border)',
    padding: '24px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    position: 'sticky',
    top: 0,
    height: '100vh',
  },
  sidebarTitle: {
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: 15,
    letterSpacing: '-0.01em',
    padding: '0 12px 16px',
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
  },
  navItemActive: {
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    fontWeight: 700,
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
  main: { padding: '32px 40px', maxWidth: 1200, minWidth: 0 },
  title: { fontSize: 22, marginBottom: 22, fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  card: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: 'var(--shadow-sm)',
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  table: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: 'var(--shadow-sm)',
    overflow: 'hidden',
    overflowX: 'auto',
  },
  tableHeader: {
    display: 'grid',
    padding: '12px 16px',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-secondary)',
    letterSpacing: '0.01em',
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
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 20,
    padding: '9px 18px',
    fontWeight: 700,
    fontSize: 13.5,
    cursor: 'pointer',
  },
  approveBtn: {
    background: 'var(--buy)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 20,
    padding: '8px 16px',
    fontWeight: 700,
    fontSize: 12.5,
    cursor: 'pointer',
  },
  rejectBtn: {
    background: 'transparent',
    color: 'var(--sell)',
    border: '1px solid var(--sell)',
    borderRadius: 20,
    padding: '8px 16px',
    fontWeight: 700,
    fontSize: 12.5,
    cursor: 'pointer',
  },
  neutralBtn: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: '8px 16px',
    fontWeight: 600,
    fontSize: 12.5,
    cursor: 'pointer',
  },
  badgeDim: { color: 'var(--text-secondary)', background: 'var(--neutral-dim)' },
  badgeAccent: { color: 'var(--accent)', background: 'var(--accent-dim)' },
  badgeBuy: { color: 'var(--buy)', background: 'var(--buy-dim)' },
  badgeSell: { color: 'var(--sell)', background: 'var(--sell-dim)' },
};
