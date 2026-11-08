import type { AssetId } from '../../../../src/shared/exchangers/types';

/** Round coin mark (from the v0 asset-glyph): «₽» for roubles, the ticker's first letters otherwise. Decorative. */
export function AssetGlyph({ id, size = 'md' }: { id: AssetId | 'RUB'; size?: 'sm' | 'md' }) {
  return (
    <span aria-hidden="true" className={`vx-ex-glyph vx-ex-glyph--${id.toLowerCase()} vx-ex-glyph--${size}`}>
      {id === 'RUB' ? '₽' : id.slice(0, 3)}
    </span>
  );
}

/** Two-letter monogram of an exchanger name. No logos: BestChange supplies none. */
export function ExchangerMonogram({ name }: { name: string }) {
  const initials = name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return <span aria-hidden="true" className="vx-ex-monogram">{initials || '•'}</span>;
}
