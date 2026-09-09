/**
 * The translation key set.
 *
 * Derived from Russian rather than hand-written, so the key list cannot
 * drift from the dictionary that defines it. Kept in its own module so the
 * six on-demand locales can import the TYPE without importing the Russian
 * dictionary's VALUES — a value import here would pull ru.ts into every
 * locale chunk and quietly undo the split.
 */
import type { RU } from './ru';

export type Key = keyof typeof RU;
