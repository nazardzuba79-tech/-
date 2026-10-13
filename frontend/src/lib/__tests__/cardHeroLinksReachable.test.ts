import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 2026-10-13 audit: on /card at desktop widths the hero artwork's <image>
 * (an SVG with overflow: visible whose viewBox starts inside the photo)
 * covered the hero links, so «Узнать больше» could not be clicked. The
 * decorative scene must not take pointer events; the rule lives in
 * index.css because crypto-card.css and WatchCardVisual are frozen.
 */
test('the /card hero artwork takes no pointer events, so the hero links stay clickable', () => {
  const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
  const rule = css.match(/\.crypto-card-page \.vc-card-hero-artwork svg \{([^}]*)\}/);
  expect(rule).not.toBeNull();
  expect(rule![1]).toMatch(/pointer-events:\s*none/);
  // the hero still renders the artwork with overflow visible (the bleed is the design), so the rule is what keeps the links reachable
  const watch = readFileSync(resolve(__dirname, '../../pages/crypto-card-final/components/WatchCardVisual.tsx'), 'utf8');
  expect(watch).toContain("overflow: 'visible'");
  const hero = readFileSync(resolve(__dirname, '../../pages/crypto-card-final/components/Hero.tsx'), 'utf8');
  expect(hero).toContain('className="vc-card-hero-artwork vc-relative"');
  expect(hero).toContain('href="#possibilities"');
});
