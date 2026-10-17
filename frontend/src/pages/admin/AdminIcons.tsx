/** Hand-drawn SVG icon set for the admin panel reskin — lucide-react isn't
 * a project dependency (see SettingsPage.tsx/BottomNav.tsx for the same
 * pattern elsewhere in this app), so these are drawn on the same 24x24
 * stroke grid lucide uses instead of pulling the package in. */
export type IconProps = { size?: number; strokeWidth?: number };

function base(size = 18, strokeWidth = 2) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

export function HexagonIcon({ size, strokeWidth = 2.2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M12 2.5 21 7.5v9L12 21.5 3 16.5v-9z" />
    </svg>
  );
}
export function LayoutDashboardIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="3" width="8" height="9" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="12" width="8" height="9" rx="1.5" />
      <rect x="3" y="16" width="8" height="5" rx="1.5" />
    </svg>
  );
}
export function WalletIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="16" cy="14" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function UsersIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3 20c1-3.7 3.5-5.7 6-5.7s5 2 6 5.7" />
      <circle cx="17.5" cy="9.5" r="2.3" />
      <path d="M16.3 14.6c2 .3 3.6 2.1 4.2 5.4" />
    </svg>
  );
}
export function ShieldCheckIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
export function ArrowUpCircleIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16V8M8.5 11.5 12 8l3.5 3.5" />
    </svg>
  );
}
export function ArrowDownCircleIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8.5 12.5 12 16l3.5-3.5" />
    </svg>
  );
}
export function BoxesIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3 6.5 6v6L12 15l5.5-3V6z" />
      <path d="M6.5 6 12 9l5.5-3M12 9v6" />
      <path d="M4 15l4 2.3v4M20 15l-4 2.3v4M8 21.3l4-2.3 4 2.3" />
    </svg>
  );
}
export function ScrollTextIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 3h11a2 2 0 0 1 2 2v13.5a2.5 2.5 0 0 1-2.5 2.5H8" />
      <path d="M6 3a2 2 0 0 0-2 2v13a2.5 2.5 0 0 0 2.5 2.5H8" />
      <path d="M8 8h7M8 12h7" />
    </svg>
  );
}
export function SettingsIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </svg>
  );
}
export function LogOutIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
export function XIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
export function SearchIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
export function BellIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 10a6 6 0 1 1 12 0c0 4 1.3 5.5 1.3 5.5H4.7S6 14 6 10z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}
export function ChevronRightIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
export function ChevronLeftIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}
export function ChevronDownIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
export function CheckCircle2Icon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.3l2.3 2.3 4.7-4.9" />
    </svg>
  );
}
export function MenuIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
export function SlidersHorizontalIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}
export function DownloadIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3v12M7.5 11 12 15.5 16.5 11" />
      <path d="M4 18.5h16" />
    </svg>
  );
}
export function MoreHorizontalIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function EyeIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}
export function PauseCircleIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6M14 9v6" />
    </svg>
  );
}
export function BanIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M6 6l12 12" />
    </svg>
  );
}
export function ExternalLinkIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 5h10v10" />
      <path d="M19 5 5 19" />
      <path d="M12 5H6.5A1.5 1.5 0 0 0 5 6.5V19h12.5a1.5 1.5 0 0 0 1.5-1.5V12" />
    </svg>
  );
}
export function LogInIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M14 21h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
      <path d="M8 7l-5 5 5 5M3 12h12" />
    </svg>
  );
}
export function ArrowUpRightIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M7 17L17 7M8 7h9v9" />
    </svg>
  );
}
export function ArrowDownRightIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M7 7l10 10M17 8v9H8" />
    </svg>
  );
}
export function AlertTriangleIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3.5 22 20.5H2z" />
      <path d="M12 9.5v4.2" />
      <circle cx="12" cy="17" r="0.2" fill="currentColor" />
    </svg>
  );
}
export function ClockIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}
export function ActivityIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 12h4l2.5-7L14 19l2.5-7H21" />
    </svg>
  );
}
