import type { ReactNode } from 'react';

/** 16-unit stroke icons for the workspace toolbar, drawn for VOLTEX in the toolbar's own line weight. */
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const ICONS = {
  compare: svg(<><path d="M1.5 11.5 5 6l3 3 5.5-6" /><path d="M1.5 14 5.5 10l2.5 2 6.5-5.5" strokeDasharray="2 2" /></>),
  layout: svg(<><rect x="1.5" y="2.5" width="13" height="11" rx="1.2" /><path d="M8 2.5v11M1.5 8h13" /></>),
  tools: svg(<><path d="M2.5 13.5 10 6l-1-1 1.5-1.5a2.2 2.2 0 0 1 3 3L12 8l-1-1-7.5 7.5z" /><path d="M4 11l1 1" /></>),
  presets: svg(<><path d="M4 2.5h8v11l-4-3-4 3z" /></>),
  calendar: svg(<><rect x="2" y="3" width="12" height="11" rx="1.2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></>),
  reset: svg(<><path d="M13 8A5 5 0 1 1 11.5 4.5" /><path d="M11.5 1.5v3h3" /></>),
  fit: svg(<><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" /></>),
  latest: svg(<><path d="M3 3l6 5-6 5zM12 3v10" /></>),
  camera: svg(<><path d="M2 5.5h2.5L6 3.5h4l1.5 2H14v8H2z" /><circle cx="8" cy="9.5" r="2.5" /></>),
  fullscreen: svg(<><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" /><path d="M6 6 2.5 2.5M10 6l3.5-3.5M6 10l-3.5 3.5M10 10l3.5 3.5" /></>),
  exitFullscreen: svg(<><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" /></>),
  star: svg(<path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />),
  starFilled: <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" /></svg>,
  close: svg(<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />),
  eye: svg(<><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></>),
  eyeOff: svg(<><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /><path d="m2.5 13.5 11-11" /></>),
  check: svg(<path d="m3 8.3 3.1 3.1L13 4.6" />),
  plus: svg(<path d="M8 3v10M3 8h10" />),
  ruler: svg(<><path d="M2 11.5 11.5 2l2.5 2.5L4.5 14z" /><path d="M5 9l1.2 1.2M7.2 6.8l1.2 1.2M9.4 4.6l1.2 1.2" /></>),
  trash: svg(<><path d="M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.7 9h5.6l.7-9" /></>),
  keyboard: svg(<><rect x="1.5" y="4" width="13" height="8" rx="1.2" /><path d="M4 7h1M7 7h1M10 7h1M4 9.5h8" /></>),
  more: svg(<><circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none" /></>),
  expand: svg(<><path d="M9 2h5v5M7 14H2V9M14 2 9 7M2 14l5-5" /></>),
  trade: svg(<><path d="M2 12 6 7l3 3 5-6" /><path d="M11 4h3v3" /></>),
  chart: svg(<><path d="M4 2.5v11M9 4v8M13 6v4" /><rect x="2.5" y="5" width="3" height="5" rx=".5" fill="currentColor" stroke="none" /></>),
  data: svg(<><rect x="2" y="2.5" width="12" height="11" rx="1.2" /><path d="M2 6h12M6 6v7.5" /></>),
  analytics: svg(<><path d="M2 13.5h12" /><path d="M3.5 11 7 6.5l2.5 2.5L13 4" /></>),
} as const;
