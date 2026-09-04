import type { Tone } from '../data/market';

export function toneClass(tone: Tone | undefined, onDark = false): string {
  switch (tone) {
    case 'pos': return onDark ? 'text-[#25B278]' : 'text-pos';
    case 'neg': return onDark ? 'text-[#E0705C]' : 'text-neg';
    case 'warn': return onDark ? 'text-accent-bright' : 'text-accent';
    default: return onDark ? 'text-white' : 'text-ink';
  }
}

export function changeTone(value: string): Tone {
  if (value.trim().startsWith('+')) return 'pos';
  if (value.trim().startsWith('-')) return 'neg';
  return 'neutral';
}
