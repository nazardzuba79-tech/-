import type { ReactNode } from 'react';

type Tone = 'success' | 'warning' | 'brand' | 'neutral' | 'danger';

// Same tone map as the archive's status-badge.tsx (oklch literals copied
// verbatim), plus a 'danger' tone the archive didn't need but this page
// does (revoked API keys, rejected KYC).
const tones: Record<Tone, string> = {
  success: 'bg-success-soft text-[oklch(0.5_0.13_155)] ring-1 ring-inset ring-[oklch(0.72_0.14_155/0.25)]',
  warning: 'bg-warning-soft text-[oklch(0.55_0.12_70)] ring-1 ring-inset ring-[oklch(0.79_0.13_78/0.3)]',
  brand: 'bg-brand-soft text-[oklch(0.5_0.16_245)] ring-1 ring-inset ring-[oklch(0.62_0.16_245/0.22)]',
  neutral: 'bg-secondary text-muted-foreground ring-1 ring-inset ring-border',
  danger: 'bg-danger-soft text-danger ring-1 ring-inset ring-[oklch(0.577_0.245_27.325/0.22)]',
};

export function StatusBadge({
  tone = 'neutral',
  children,
  icon,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${tones[tone]} ${className}`}>
      {icon}
      {children}
    </span>
  );
}
